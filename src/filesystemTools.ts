import path from "node:path";
import { MistralToolDefinition } from "./mcp.ts";

export type FileOperationApprovalRequest = {
  action: "deno_permission" | "read";
  code?: string;
  permission?: DenoPermissionRequest;
  subject: "file" | "path";
  targetPath?: string;
  workingDirectory?: string;
};

export type FileOperationApprovalHandler = (
  request: FileOperationApprovalRequest,
) => Promise<boolean>;

export const FILESYSTEM_TOOL_NAMES = {
  denoRepl: "missy_deno_repl",
} as const;

type DenoPermissionName =
  | "env"
  | "ffi"
  | "net"
  | "read"
  | "run"
  | "sys"
  | "write";

type DenoPermissionRequest = {
  name: DenoPermissionName;
  target?: string;
};

const MAX_DENO_REPL_CODE_LENGTH = 1_500;
const MAX_DENO_REPL_PERMISSION_ROUNDS = 8;
const DENO_PERMISSION_NAMES: readonly DenoPermissionName[] = [
  "env",
  "ffi",
  "net",
  "read",
  "run",
  "sys",
  "write",
];

export const filesystemTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.denoRepl,
      description:
        "Run TypeScript in a local Deno REPL for compound local tasks. The REPL starts without local permissions; when Deno requests read/write/run/net/env/etc. access, Missy forwards that specific permission request to Discord for approval and reruns with only the approved scoped permission.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "TypeScript/JavaScript code to evaluate with deno repl --eval. Use console.log or console.table for useful output. Prefer Deno APIs over shelling out.",
          },
          cwd: {
            type: "string",
            description:
              "Optional working directory for the REPL. Defaults to the current bot process directory.",
          },
          timeoutMs: {
            type: "integer",
            description:
              "Optional timeout in milliseconds. Defaults to 30000, max 120000.",
          },
        },
        required: ["code"],
      },
    },
  },
];

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function homeDirectory(): string | undefined {
  return Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || undefined;
}

function expandHomePath(value: string): string {
  const home = homeDirectory();

  if (!home) {
    return value;
  }

  if (value === "~") {
    return home;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }

  return value;
}

export function resolveLocalPath(value: string): string {
  return path.resolve(expandHomePath(value));
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = String(args[name] ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function clampTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1_000, Math.min(parsed, 120_000))
    : 30_000;
}

function denoPermissionKey(permission: DenoPermissionRequest): string {
  return `${permission.name}:${permission.target ?? ""}`;
}

function denoPermissionFlag(permission: DenoPermissionRequest): string {
  const flagName = `--allow-${permission.name}`;

  if (!permission.target) {
    return flagName;
  }

  return `${flagName}=${permission.target}`;
}

function denoDenyFlags(
  permissions: readonly DenoPermissionRequest[],
): string[] {
  const approvedNames = new Set(
    permissions.map((permission) => permission.name),
  );

  return DENO_PERMISSION_NAMES
    .filter((name) => !approvedNames.has(name))
    .map((name) => `--deny-${name}`);
}

function parseDenoPermissionRequest(
  output: string,
): DenoPermissionRequest | undefined {
  const plainOutput = output.replace(/\x1b\[[0-9;]*m/g, "");
  const match = plainOutput.match(
    /Requires\s+([a-z]+)\s+access(?:\s+to\s+"([^"]+)")?/i,
  );

  if (!match?.[1]) {
    return undefined;
  }

  const name = match[1].toLowerCase();

  if (!DENO_PERMISSION_NAMES.includes(name as DenoPermissionName)) {
    return undefined;
  }

  return {
    name: name as DenoPermissionName,
    target: match[2],
  };
}

function denoReplChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (
    const name of [
      "HOME",
      "PATH",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "WINDIR",
    ]
  ) {
    const value = Deno.env.get(name);

    if (value) {
      env[name] = value;
    }
  }

  return env;
}

async function runDenoReplEval(
  code: string,
  cwd: string,
  timeoutMs: number,
  permissions: readonly DenoPermissionRequest[],
): Promise<{
  code: number | null;
  denoPermissions: readonly DenoPermissionRequest[];
  inputCode: string;
  cwd: string;
  signal: Deno.Signal | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}> {
  const denoArgs = [
    "repl",
    "--quiet",
    "--no-config",
    "--permission-set",
    ...denoDenyFlags(permissions),
    ...permissions.map(denoPermissionFlag),
    "--eval",
    code,
  ];
  const process = new Deno.Command("cmd", {
    args: [
      "/d",
      "/c",
      "deno",
      ...denoArgs,
    ],
    clearEnv: true,
    cwd,
    env: denoReplChildEnv(),
    stderr: "piped",
    stdout: "piped",
  }).spawn();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;

    try {
      process.kill();
    } catch {
      // The command may have exited between the timeout and kill.
    }
  }, timeoutMs);

  try {
    const output = await process.output();
    const decoder = new TextDecoder();

    return {
      code: output.code,
      denoPermissions: permissions,
      inputCode: code,
      cwd,
      signal: output.signal,
      stderr: decoder.decode(output.stderr).slice(0, 20_000),
      stdout: decoder.decode(output.stdout).slice(0, 40_000),
      timedOut,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestApprovalOrThrow(
  requestApproval: FileOperationApprovalHandler | undefined,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  if (!requestApproval) {
    throw new Error(
      "This Deno REPL permission requires a Discord approval prompt.",
    );
  }

  return await requestApproval(request);
}

async function denoReplTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const code = requiredString(args, "code");

  if (code.length > MAX_DENO_REPL_CODE_LENGTH) {
    throw new Error(
      `Deno REPL code is too long. Keep code under ${MAX_DENO_REPL_CODE_LENGTH} characters so permission approval prompts can show exactly what will run.`,
    );
  }

  const cwd = typeof args.cwd === "string" && args.cwd.trim()
    ? resolveLocalPath(args.cwd)
    : Deno.cwd();
  const timeoutMs = clampTimeoutMs(args.timeoutMs);

  const permissions: DenoPermissionRequest[] = [];
  const deniedPermissions: DenoPermissionRequest[] = [];

  for (let round = 0; round < MAX_DENO_REPL_PERMISSION_ROUNDS; round++) {
    const result = await runDenoReplEval(code, cwd, timeoutMs, permissions);
    const combinedOutput = `${result.stderr}\n${result.stdout}`;
    const requestedPermission = parseDenoPermissionRequest(combinedOutput);

    if (result.timedOut || !requestedPermission) {
      return {
        ...result,
        deniedPermissions,
      };
    }

    if (
      permissions.some((permission) =>
        denoPermissionKey(permission) === denoPermissionKey(requestedPermission)
      )
    ) {
      return {
        ...result,
        deniedPermissions,
      };
    }

    const approved = await requestApprovalOrThrow(requestApproval, {
      action: "deno_permission",
      code,
      permission: requestedPermission,
      subject: "path",
      targetPath: cwd,
      workingDirectory: cwd,
    });

    if (!approved) {
      deniedPermissions.push(requestedPermission);
      return {
        ...result,
        deniedPermissions,
      };
    }

    permissions.push(requestedPermission);
  }

  throw new Error(
    `Deno REPL requested more than ${MAX_DENO_REPL_PERMISSION_ROUNDS} permission rounds.`,
  );
}

function logDenoReplTool(
  event: "attempted" | "succeeded" | "failed",
  args: Record<string, unknown>,
  error?: unknown,
): void {
  console.info(JSON.stringify({
    action: "deno_repl",
    at: new Date().toISOString(),
    code: typeof args.code === "string" ? args.code : undefined,
    error: error instanceof Error ? error.message : undefined,
    event: `deno_repl_tool_${event}`,
    toolName: FILESYSTEM_TOOL_NAMES.denoRepl,
  }));
}

export async function callFilesystemTool(
  toolName: string,
  rawArguments: unknown,
  requestApproval?: FileOperationApprovalHandler,
): Promise<string> {
  if (toolName !== FILESYSTEM_TOOL_NAMES.denoRepl) {
    throw new Error(`Unknown embedded local tool: ${toolName}`);
  }

  const args = parseArgs(rawArguments);
  logDenoReplTool("attempted", args);

  try {
    const result = await denoReplTool(args, requestApproval);
    logDenoReplTool("succeeded", args);
    return JSON.stringify(result);
  } catch (error) {
    logDenoReplTool("failed", args, error);
    throw error;
  }
}
