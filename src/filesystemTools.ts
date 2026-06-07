import path from "node:path";
import { MistralToolDefinition } from "./mcp.ts";

export type FileOperationApprovalRequest = {
  action:
    | "copy"
    | "delete"
    | "deno_permission"
    | "deno_repl"
    | "find"
    | "list"
    | "mkdir"
    | "move"
    | "overwrite"
    | "read"
    | "stat"
    | "write";
  code?: string;
  destinationPath?: string;
  permission?: DenoPermissionRequest;
  sourcePath?: string;
  subject: "file" | "folder" | "path";
  targetPath?: string;
  workingDirectory?: string;
};

export type FileOperationApprovalHandler = (
  request: FileOperationApprovalRequest,
) => Promise<boolean>;

export const FILESYSTEM_TOOL_NAMES = {
  copy: "missy_filesystem_copy",
  delete: "missy_filesystem_delete",
  denoRepl: "missy_deno_repl",
  find: "missy_filesystem_find",
  list: "missy_filesystem_list",
  mkdir: "missy_filesystem_mkdir",
  move: "missy_filesystem_move",
  read: "missy_filesystem_read",
  stat: "missy_filesystem_stat",
  writeText: "missy_filesystem_write_text",
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
        "Run TypeScript in a local Deno REPL for compound filesystem tasks such as recursive search, folder creation, copying, moving, or renaming. The REPL starts without local permissions; when Deno requests read/write/run/net/env/etc. access, Missy forwards that specific permission request to Discord for approval and reruns with only the approved scoped permission.",
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
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.find,
      description:
        "Request Discord approval, then recursively search a local folder for files by filename text and/or extension. Use before moving or copying unknown local files.",
      parameters: {
        type: "object",
        properties: {
          extensions: {
            type: "array",
            description:
              "Optional file extensions to match, such as .safetensors, .ckpt, .gguf, .pt, or .bin.",
            items: { type: "string" },
          },
          limit: {
            type: "integer",
            description: "Maximum matches to return. Defaults to 100.",
          },
          path: {
            type: "string",
            description:
              "Local folder to search recursively. Use ~ for the bot process user's home directory.",
          },
          query: {
            type: "string",
            description: "Optional case-insensitive filename substring.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.stat,
      description:
        "Request Discord approval, then inspect metadata for any local filesystem path, including absolute Windows paths such as D:\\.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Local path to inspect. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.list,
      description:
        "Request Discord approval, then list files and folders in any local directory, including absolute Windows paths such as D:\\.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Local directory path. Use ~ for the bot process user's home directory.",
          },
          limit: {
            type: "integer",
            description: "Maximum entries to return. Defaults to 100.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.read,
      description:
        "Request Discord approval, then read any local text file. Avoid reading secrets unless the user explicitly asks.",
      parameters: {
        type: "object",
        properties: {
          maxBytes: {
            type: "integer",
            description: "Maximum bytes to read. Defaults to 20000.",
          },
          path: {
            type: "string",
            description:
              "Local file path. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.copy,
      description:
        "Request Discord approval, then copy any local file or folder to a new destination that does not already exist.",
      parameters: {
        type: "object",
        properties: {
          destinationPath: {
            type: "string",
            description:
              "New destination path. It must not already exist. Use ~ for the bot process user's home directory.",
          },
          sourcePath: {
            type: "string",
            description:
              "Existing source file or folder path. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["sourcePath", "destinationPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.mkdir,
      description:
        "Request Discord approval, then create any local directory, including parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path to create. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.writeText,
      description:
        "Request Discord approval, then create or overwrite any local text file.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text content to write." },
          overwrite: {
            type: "boolean",
            description:
              "Whether to overwrite an existing file. Defaults to false.",
          },
          path: {
            type: "string",
            description:
              "Local file path. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.move,
      description:
        "Request Discord approval, then move or rename any local file or folder.",
      parameters: {
        type: "object",
        properties: {
          destinationPath: {
            type: "string",
            description:
              "Destination local path. It must not already exist; choose the final filename or folder name. Use ~ for the bot process user's home directory.",
          },
          sourcePath: {
            type: "string",
            description:
              "Existing local source file or folder path. Use ~ for the bot process user's home directory.",
          },
        },
        required: ["sourcePath", "destinationPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FILESYSTEM_TOOL_NAMES.delete,
      description:
        "Request Discord approval, then delete any local file or folder. Folders require recursive=true.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Local path to delete. Use ~ for the bot process user's home directory.",
          },
          recursive: {
            type: "boolean",
            description:
              "Required to delete non-empty folders. Defaults to false.",
          },
        },
        required: ["path"],
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

function actionFromToolName(
  toolName: string,
  args: Record<string, unknown>,
): FileOperationApprovalRequest["action"] | "unknown" {
  if (toolName === FILESYSTEM_TOOL_NAMES.denoRepl) {
    return "deno_repl";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.copy) {
    return "copy";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.delete) {
    return "delete";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.find) {
    return "find";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.list) {
    return "list";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.mkdir) {
    return "mkdir";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.move) {
    return "move";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.read) {
    return "read";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.stat) {
    return "stat";
  }
  if (toolName === FILESYSTEM_TOOL_NAMES.writeText) {
    return args.overwrite === true ? "overwrite" : "write";
  }

  return "unknown";
}

function logFilesystemTool(
  event: "attempted" | "succeeded" | "failed",
  toolName: string,
  args: Record<string, unknown>,
  error?: unknown,
): void {
  const sourcePath = typeof args.sourcePath === "string"
    ? resolveLocalPath(args.sourcePath)
    : undefined;
  const destinationPath = typeof args.destinationPath === "string"
    ? resolveLocalPath(args.destinationPath)
    : undefined;
  const targetPath = typeof args.path === "string"
    ? resolveLocalPath(args.path)
    : undefined;

  console.info(JSON.stringify({
    action: actionFromToolName(toolName, args),
    at: new Date().toISOString(),
    code: typeof args.code === "string" ? args.code : undefined,
    destinationPath,
    error: error instanceof Error ? error.message : undefined,
    event: `filesystem_tool_${event}`,
    sourcePath,
    targetPath,
    toolName,
  }));
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = String(args[name] ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
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

function clampBytes(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, 200_000))
    : fallback;
}

function clampTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1_000, Math.min(parsed, 120_000))
    : 30_000;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await Deno.stat(value);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function serializeFileInfo(value: string, info: Deno.FileInfo) {
  return {
    accessedAt: info.atime?.toISOString(),
    createdAt: info.birthtime?.toISOString(),
    isDirectory: info.isDirectory,
    isFile: info.isFile,
    isSymlink: info.isSymlink,
    modifiedAt: info.mtime?.toISOString(),
    path: value,
    size: info.size,
  };
}

async function copyPath(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const sourceInfo = await Deno.stat(sourcePath);

  if (sourceInfo.isDirectory) {
    await Deno.mkdir(destinationPath);

    for await (const entry of Deno.readDir(sourcePath)) {
      await copyPath(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
      );
    }

    return;
  }

  await Deno.copyFile(sourcePath, destinationPath);
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
      "This filesystem operation requires a Discord approval prompt.",
    );
  }

  return await requestApproval(request);
}

async function requireApproval(
  requestApproval: FileOperationApprovalHandler | undefined,
  request: FileOperationApprovalRequest,
): Promise<void> {
  const approved = await requestApprovalOrThrow(requestApproval, request);

  if (!approved) {
    throw new Error(`The user did not approve filesystem ${request.action}.`);
  }
}

async function statTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  await requireApproval(requestApproval, {
    action: "stat",
    subject: "path",
    targetPath: resolvedPath,
  });
  const info = await Deno.stat(resolvedPath);
  return serializeFileInfo(resolvedPath, info);
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

async function findTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const limit = Math.max(1, Math.min(Number(args.limit) || 100, 500));
  const query = String(args.query ?? "").trim().toLowerCase();
  const extensions = Array.isArray(args.extensions)
    ? args.extensions
      .filter((extension): extension is string => typeof extension === "string")
      .map((extension) => extension.trim().toLowerCase().replace(/^\*?\./, "."))
      .filter(Boolean)
    : [];
  await requireApproval(requestApproval, {
    action: "find",
    subject: "folder",
    targetPath: resolvedPath,
  });

  const matches: ReturnType<typeof serializeFileInfo>[] = [];
  let skippedDirectories = 0;

  async function walk(currentPath: string): Promise<void> {
    let entries: Deno.DirEntry[] = [];

    try {
      for await (const entry of Deno.readDir(currentPath)) {
        entries.push(entry);
      }
    } catch {
      skippedDirectories++;
      return;
    }

    entries = entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (matches.length >= limit) return;

      const entryPath = path.join(currentPath, entry.name);
      const lowerName = entry.name.toLowerCase();
      const extensionMatches = extensions.length === 0 ||
        extensions.some((extension) => lowerName.endsWith(extension));
      const queryMatches = !query || lowerName.includes(query);

      if (entry.isFile && extensionMatches && queryMatches) {
        matches.push(serializeFileInfo(entryPath, await Deno.stat(entryPath)));
      }

      if (entry.isDirectory) {
        await walk(entryPath);
      }
    }
  }

  await walk(resolvedPath);
  return {
    matches,
    path: resolvedPath,
    skippedDirectories,
    truncated: matches.length >= limit,
  };
}

async function listTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const limit = Math.max(1, Math.min(Number(args.limit) || 100, 500));
  await requireApproval(requestApproval, {
    action: "list",
    subject: "folder",
    targetPath: resolvedPath,
  });
  const entries = [];

  for await (const entry of Deno.readDir(resolvedPath)) {
    entries.push({
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
      isSymlink: entry.isSymlink,
      name: entry.name,
      path: path.join(resolvedPath, entry.name),
    });

    if (entries.length >= limit) {
      break;
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return { entries, path: resolvedPath };
}

async function readTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const maxBytes = clampBytes(args.maxBytes, 20_000);
  await requireApproval(requestApproval, {
    action: "read",
    subject: "file",
    targetPath: resolvedPath,
  });
  const file = await Deno.open(resolvedPath, { read: true });

  try {
    const buffer = new Uint8Array(maxBytes);
    const bytesRead = await file.read(buffer);

    if (!bytesRead) {
      return { path: resolvedPath, text: "" };
    }

    return {
      path: resolvedPath,
      text: new TextDecoder().decode(buffer.slice(0, bytesRead)),
      truncated: bytesRead === maxBytes,
    };
  } finally {
    file.close();
  }
}

async function copyTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const sourcePath = resolveLocalPath(requiredString(args, "sourcePath"));
  const destinationPath = resolveLocalPath(
    requiredString(args, "destinationPath"),
  );

  await requireApproval(requestApproval, {
    action: "copy",
    destinationPath,
    sourcePath,
    subject: "path",
  });
  await Deno.stat(sourcePath);

  if (await pathExists(destinationPath)) {
    throw new Error("Destination already exists.");
  }

  await Deno.stat(path.dirname(destinationPath));
  await copyPath(sourcePath, destinationPath);

  return { destinationPath, sourcePath };
}

async function mkdirTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  await requireApproval(requestApproval, {
    action: "mkdir",
    subject: "folder",
    targetPath: resolvedPath,
  });
  await Deno.mkdir(resolvedPath, { recursive: true });
  return { path: resolvedPath };
}

async function writeTextTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const resolvedPath = resolveLocalPath(requiredString(args, "path"));
  const content = String(args.content ?? "");
  const overwrite = args.overwrite === true;
  await requireApproval(requestApproval, {
    action: overwrite ? "overwrite" : "write",
    subject: "file",
    targetPath: resolvedPath,
  });
  const exists = await pathExists(resolvedPath);

  if (exists && !overwrite) {
    throw new Error("File already exists. Set overwrite=true to replace it.");
  }

  await Deno.mkdir(path.dirname(resolvedPath), { recursive: true });
  await Deno.writeTextFile(resolvedPath, content);

  return { approved: true, path: resolvedPath };
}

async function moveTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const sourcePath = resolveLocalPath(requiredString(args, "sourcePath"));
  const destinationPath = resolveLocalPath(
    requiredString(args, "destinationPath"),
  );

  const approved = await requestApprovalOrThrow(requestApproval, {
    action: "move",
    destinationPath,
    sourcePath,
    subject: "path",
  });

  if (!approved) {
    return { approved: false, message: "The user did not approve the move." };
  }

  if (await pathExists(destinationPath)) {
    throw new Error("Destination already exists.");
  }

  await Deno.stat(path.dirname(destinationPath));
  await Deno.rename(sourcePath, destinationPath);
  return { approved: true, destinationPath, sourcePath };
}

async function deleteTool(
  args: Record<string, unknown>,
  requestApproval?: FileOperationApprovalHandler,
): Promise<unknown> {
  const targetPath = resolveLocalPath(requiredString(args, "path"));
  const approved = await requestApprovalOrThrow(requestApproval, {
    action: "delete",
    subject: "path",
    targetPath,
  });

  if (!approved) {
    return { approved: false, message: "The user did not approve deletion." };
  }

  await Deno.remove(targetPath, { recursive: args.recursive === true });
  return { approved: true, path: targetPath };
}

export async function callFilesystemTool(
  toolName: string,
  rawArguments: unknown,
  requestApproval?: FileOperationApprovalHandler,
): Promise<string> {
  const args = parseArgs(rawArguments);
  let result: unknown;

  logFilesystemTool("attempted", toolName, args);

  try {
    switch (toolName) {
      case FILESYSTEM_TOOL_NAMES.copy:
        result = await copyTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.delete:
        result = await deleteTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.denoRepl:
        result = await denoReplTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.find:
        result = await findTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.list:
        result = await listTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.mkdir:
        result = await mkdirTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.move:
        result = await moveTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.read:
        result = await readTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.stat:
        result = await statTool(args, requestApproval);
        break;
      case FILESYSTEM_TOOL_NAMES.writeText:
        result = await writeTextTool(args, requestApproval);
        break;
      default:
        throw new Error(`Unknown filesystem tool: ${toolName}`);
    }
  } catch (error) {
    logFilesystemTool("failed", toolName, args, error);
    throw error;
  }

  logFilesystemTool("succeeded", toolName, args);
  return JSON.stringify(result);
}
