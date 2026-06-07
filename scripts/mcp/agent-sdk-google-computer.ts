type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_MODEL = "gpt-5.4";
const GOOGLE_CONNECTORS = [
  {
    aliases: ["drive", "google_drive", "googledrive"],
    authEnv: "GOOGLE_DRIVE_AUTHORIZATION",
    connectorId: "connector_googledrive",
    serverLabel: "google_drive",
  },
  {
    aliases: ["gmail", "email", "mail"],
    authEnv: "GMAIL_AUTHORIZATION",
    connectorId: "connector_gmail",
    serverLabel: "gmail",
  },
  {
    aliases: ["calendar", "google_calendar", "googlecalendar"],
    authEnv: "GOOGLE_CALENDAR_AUTHORIZATION",
    connectorId: "connector_googlecalendar",
    serverLabel: "google_calendar",
  },
] as const;

const tools: ToolDefinition[] = [
  {
    name: "desktop_list",
    description:
      "List files and folders under the local Desktop. This is read-only and accepts only relative paths.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional relative folder path under the Desktop. Defaults to the Desktop root.",
        },
      },
    },
  },
  {
    name: "desktop_read",
    description:
      "Read a text file under the local Desktop. This is read-only and accepts only relative paths.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path under the Desktop.",
        },
        maxBytes: {
          type: "integer",
          description: "Maximum bytes to read. Defaults to 20000.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "google_query",
    description:
      "Ask an OpenAI Agents SDK assistant to use linked Google connector tools for Drive, Gmail, or Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The Google Workspace task or question to answer.",
        },
        services: {
          type: "array",
          description:
            "Optional Google services to use: drive, gmail, calendar.",
          items: {
            type: "string",
            enum: ["drive", "gmail", "calendar"],
          },
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "computer_task",
    description:
      "Ask an OpenAI Agents SDK assistant to inspect this computer through a conservative local PowerShell harness.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The local computer task. By default this is limited to read-only inspection commands.",
        },
      },
      required: ["prompt"],
    },
  },
];

function getEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function modelName(): string {
  return getEnv("MISSY_AGENT_MODEL") ?? DEFAULT_MODEL;
}

function requireOpenAiApiKey(): void {
  if (!getEnv("OPENAI_API_KEY")) {
    throw new Error("OPENAI_API_KEY is required for the Agent SDK MCP server.");
  }
}

function normalizeServices(rawServices: unknown): Set<string> | undefined {
  if (!Array.isArray(rawServices) || rawServices.length === 0) {
    return undefined;
  }

  return new Set(
    rawServices
      .filter((service): service is string => typeof service === "string")
      .map((service) => service.toLowerCase().trim()),
  );
}

function isSelectedConnector(
  connector: (typeof GOOGLE_CONNECTORS)[number],
  selectedServices: Set<string> | undefined,
): boolean {
  if (!selectedServices) {
    return true;
  }

  return connector.aliases.some((alias) => selectedServices.has(alias));
}

async function runGoogleQuery(args: Record<string, unknown>): Promise<string> {
  requireOpenAiApiKey();

  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("google_query requires a non-empty prompt.");
  }

  const selectedServices = normalizeServices(args.services);
  const { Agent, hostedMcpTool, run } = await import("npm:@openai/agents");
  const hostedTools = GOOGLE_CONNECTORS
    .filter((connector) => isSelectedConnector(connector, selectedServices))
    .map((connector) => {
      const authorization = getEnv(connector.authEnv) ??
        getEnv("GOOGLE_CONNECTOR_AUTHORIZATION");

      if (!authorization) {
        return undefined;
      }

      return hostedMcpTool({
        authorization,
        connectorId: connector.connectorId,
        requireApproval: "never",
        serverLabel: connector.serverLabel,
      });
    })
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  if (hostedTools.length === 0) {
    throw new Error(
      "No Google connector authorization token is configured. Set GOOGLE_CONNECTOR_AUTHORIZATION or a service-specific GOOGLE_DRIVE_AUTHORIZATION, GMAIL_AUTHORIZATION, or GOOGLE_CALENDAR_AUTHORIZATION value.",
    );
  }

  const agent = new Agent({
    name: "Missy Google Agent",
    model: modelName(),
    instructions:
      "Use the connected Google tools to answer the user's request. Keep answers concise, cite filenames, event titles, or email subjects when useful, and do not invent access you do not have.",
    tools: hostedTools,
  });

  const result = await run(agent, prompt);
  return String(result.finalOutput ?? "");
}

function computerRoot(): string {
  return getEnv("MISSY_AGENT_COMPUTER_ROOT") ?? Deno.cwd();
}

function desktopRoot(): string {
  const configuredRoot = getEnv("MISSY_DESKTOP_ROOT");
  if (configuredRoot) {
    return configuredRoot;
  }

  const userProfile = getEnv("USERPROFILE");
  if (userProfile) {
    return `${userProfile}\\Desktop`;
  }

  const home = getEnv("HOME");
  if (home) {
    return `${home}/Desktop`;
  }

  return `${Deno.cwd()}\\Desktop`;
}

function assertRelativePath(path: string): void {
  if (!path.trim()) {
    return;
  }

  if (
    path.includes("..") ||
    path.includes(":") ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /[<>|?*]/.test(path)
  ) {
    throw new Error("Only relative paths under the Desktop are allowed.");
  }
}

function resolveDesktopPath(rawPath: unknown): string {
  const relativePath = String(rawPath ?? "").trim();
  assertRelativePath(relativePath);

  if (!relativePath) {
    return desktopRoot();
  }

  return `${desktopRoot()}\\${relativePath}`;
}

async function runDesktopList(args: Record<string, unknown>): Promise<string> {
  const targetPath = resolveDesktopPath(args.path);
  const entries = [];

  for await (const entry of Deno.readDir(targetPath)) {
    entries.push(`${entry.isDirectory ? "[dir]" : "[file]"} ${entry.name}`);
  }

  entries.sort((a, b) => a.localeCompare(b));

  if (entries.length === 0) {
    return "Desktop folder is empty.";
  }

  return entries.join("\n");
}

async function runDesktopRead(args: Record<string, unknown>): Promise<string> {
  const targetPath = resolveDesktopPath(args.path);
  const maxBytes = Number.isFinite(Number(args.maxBytes))
    ? Math.max(1, Math.min(Number(args.maxBytes), 100_000))
    : 20_000;
  const file = await Deno.open(targetPath, { read: true });

  try {
    const buffer = new Uint8Array(maxBytes);
    const bytesRead = await file.read(buffer);

    if (!bytesRead) {
      return "";
    }

    const text = decoder.decode(buffer.slice(0, bytesRead));
    const truncated = bytesRead === maxBytes ? "\n\n[truncated]" : "";
    return `${text}${truncated}`;
  } finally {
    file.close();
  }
}

function computerAccessEnabled(): boolean {
  return getEnv("MISSY_AGENT_ENABLE_COMPUTER") === "1";
}

function assertReadOnlyCommand(command: string): void {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();
  const allowedPrefixes = [
    "get-childitem",
    "get-content",
    "get-date",
    "get-location",
    "git diff",
    "git log",
    "git show",
    "git status",
    "pwd",
    "resolve-path",
    "rg ",
    "select-string",
    "test-path",
    "whoami",
  ];

  if (!allowedPrefixes.some((prefix) => lower.startsWith(prefix))) {
    throw new Error(
      `Blocked local command. Allowed read-only commands: ${allowedPrefixes.join(", ")}`,
    );
  }

  if (/[;&|<>]/.test(normalized) || /\.\./.test(normalized)) {
    throw new Error("Blocked local command with control operators or parent paths.");
  }

  if (/[a-z]:\\/i.test(normalized)) {
    throw new Error("Blocked local command with an absolute Windows path.");
  }

  const blockedTerms = [
    "add-content",
    "clear-content",
    "copy-item",
    "del ",
    "erase ",
    "git checkout",
    "git clean",
    "git reset",
    "move-item",
    "new-item",
    "remove-item",
    "ren ",
    "rename-item",
    "set-content",
  ];

  if (blockedTerms.some((term) => lower.includes(term))) {
    throw new Error("Blocked local command that appears to modify the computer.");
  }
}

function commandFromShellInput(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const record = input as Record<string, unknown>;
  const candidates = [
    record.command,
    record.cmd,
    record.script,
    record.input,
  ];
  const command = candidates.find((candidate): candidate is string =>
    typeof candidate === "string"
  );

  if (command) {
    return command;
  }

  if (Array.isArray(record.args)) {
    return record.args.filter((arg) => typeof arg === "string").join(" ");
  }

  return "";
}

async function runReadOnlyPowerShell(command: string) {
  assertReadOnlyCommand(command);

  const root = computerRoot().replace(/'/g, "''");
  const script = `Set-Location -LiteralPath '${root}'; ${command}`;
  const process = new Deno.Command("powershell", {
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await process.output();

  return {
    output: [
      {
        stderr: decoder.decode(output.stderr),
        stdout: decoder.decode(output.stdout),
        outcome: {
          exitCode: output.code,
          type: "exit",
        },
      },
    ],
  };
}

async function runComputerTask(args: Record<string, unknown>): Promise<string> {
  requireOpenAiApiKey();

  if (!computerAccessEnabled()) {
    throw new Error(
      "Computer access is disabled. Set MISSY_AGENT_ENABLE_COMPUTER=1 to enable the local read-only shell harness.",
    );
  }

  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("computer_task requires a non-empty prompt.");
  }

  const { Agent, run, shellTool } = await import("npm:@openai/agents");
  const shell: any = {
    run: async (input: unknown) => {
      const command = commandFromShellInput(input);
      if (!command) {
        throw new Error("The shell tool did not provide a command.");
      }

      return await runReadOnlyPowerShell(command);
    },
  };
  const agent = new Agent({
    name: "Missy Local Computer Agent",
    model: modelName(),
    instructions:
      `Inspect the local Windows computer only through read-only PowerShell commands rooted at ${computerRoot()}. Do not attempt to write files, delete files, install software, change settings, access secrets, or bypass the command allowlist.`,
    tools: [
      shellTool({
        shell,
      }),
    ],
  });

  const result = await run(agent, prompt);
  return String(result.finalOutput ?? "");
}

async function callTool(
  name: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  const normalizedArgs = args && typeof args === "object"
    ? args as Record<string, unknown>
    : {};

  if (name === "google_query") {
    return {
      content: [{ type: "text", text: await runGoogleQuery(normalizedArgs) }],
    };
  }

  if (name === "desktop_list") {
    return {
      content: [{ type: "text", text: await runDesktopList(normalizedArgs) }],
    };
  }

  if (name === "desktop_read") {
    return {
      content: [{ type: "text", text: await runDesktopRead(normalizedArgs) }],
    };
  }

  if (name === "computer_task") {
    return {
      content: [{ type: "text", text: await runComputerTask(normalizedArgs) }],
    };
  }

  throw new Error(`Unknown tool: ${String(name)}`);
}

function respond(id: JsonRpcRequest["id"], result: unknown): void {
  Deno.stdout.writeSync(
    encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
  );
}

function respondError(id: JsonRpcRequest["id"], error: JsonRpcError): void {
  Deno.stdout.writeSync(
    encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`),
  );
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined) {
    return;
  }

  try {
    if (request.method === "initialize") {
      respond(request.id, {
        capabilities: { tools: {} },
        protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
        serverInfo: {
          name: "missy-agent-sdk-google-computer",
          version: "0.1.0",
        },
      });
      return;
    }

    if (request.method === "tools/list") {
      respond(request.id, { tools });
      return;
    }

    if (request.method === "tools/call") {
      respond(
        request.id,
        await callTool(request.params?.name, request.params?.arguments),
      );
      return;
    }

    respondError(request.id, {
      code: -32601,
      message: `Unsupported method: ${request.method}`,
    });
  } catch (error) {
    respondError(request.id, {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

let buffer = "";

for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk, { stream: true });
  let newlineIndex = buffer.indexOf("\n");

  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (line) {
      try {
        await handleRequest(JSON.parse(line) as JsonRpcRequest);
      } catch (error) {
        console.error("Invalid MCP request", error);
      }
    }

    newlineIndex = buffer.indexOf("\n");
  }
}
