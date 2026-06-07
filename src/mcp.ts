export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  servers?: Record<string, McpServerConfig>;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type MistralToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolRegistryEntry = {
  serverName: string;
  toolName: string;
};

export type McpToolRegistry = {
  tools: MistralToolDefinition[];
  entries: Map<string, ToolRegistryEntry>;
};

const configFile = new URL("../mcp.json", import.meta.url);
const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TOOL_TIMEOUT_MS = 20_000;

const connections = new Map<string, McpConnection>();

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function parseJsonArguments(rawArguments: unknown): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments as Record<string, unknown>;
}

async function loadConfig(): Promise<McpConfig> {
  try {
    const raw = await Deno.readTextFile(configFile);
    return JSON.parse(raw) as McpConfig;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {};
    }

    throw error;
  }
}

async function saveConfig(config: McpConfig): Promise<void> {
  await Deno.writeTextFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`MCP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

class McpConnection {
  private nextId = 1;
  private process: Deno.ChildProcess | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private startingPromise: Promise<void> | undefined;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private buffer = "";

  constructor(
    private readonly name: string,
    private readonly config: McpServerConfig,
  ) {}

  async listTools(): Promise<McpTool[]> {
    const result = await this.request("tools/list", {});
    const tools = (result as { tools?: McpTool[] }).tools ?? [];
    return tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request("tools/call", {
      name: toolName,
      arguments: args,
    });

    return JSON.stringify(result);
  }

  close(): void {
    this.rejectAll(new Error(`MCP ${this.name} connection was closed`));

    try {
      this.writer?.releaseLock();
    } catch {
      // Ignore cleanup errors while replacing MCP server config.
    }

    try {
      this.process?.kill();
    } catch {
      // The process may already have exited.
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && this.writer) {
      return;
    }

    if (this.startingPromise) {
      await this.startingPromise;
      return;
    }

    this.startingPromise = this.startConnection();

    try {
      await this.startingPromise;
    } catch (error) {
      this.startingPromise = undefined;
      throw error;
    }
  }

  private async startConnection(): Promise<void> {
    const command = new Deno.Command(this.config.command, {
      args: this.config.args ?? [],
      env: this.config.env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    this.process = command.spawn();
    this.writer = this.process.stdin.getWriter();
    void this.readStdout(this.process.stdout);
    void this.readStderr(this.process.stderr);

    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "missy",
        version: "0.1.0",
      },
    });
    await this.notify("notifications/initialized", {});
  }

  private async readStdout(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();

    try {
      for await (const chunk of stdout) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let newlineIndex = this.buffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = this.buffer.slice(0, newlineIndex).trim();
          this.buffer = this.buffer.slice(newlineIndex + 1);

          if (line) {
            this.handleMessage(line);
          }

          newlineIndex = this.buffer.indexOf("\n");
        }
      }
    } catch (error) {
      this.rejectAll(error);
    }
  }

  private async readStderr(stderr: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();

    for await (const chunk of stderr) {
      const message = decoder.decode(chunk).trim();
      if (message) {
        console.error(`MCP ${this.name}: ${message}`);
      }
    }
  }

  private handleMessage(line: string): void {
    let response: JsonRpcResponse;

    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch (error) {
      console.error(`MCP ${this.name} returned invalid JSON`, error);
      return;
    }

    if (response.id === undefined) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(response.error.message ?? `MCP ${this.name} request failed`),
      );
      return;
    }

    pending.resolve(response.result);
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureStartedForRequest(method);

    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    await this.write({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return await withTimeout(result, DEFAULT_TOOL_TIMEOUT_MS);
  }

  private async ensureStartedForRequest(method: string): Promise<void> {
    if (method === "initialize") {
      return;
    }

    await this.ensureStarted();
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private async write(message: unknown): Promise<void> {
    if (!this.writer) {
      throw new Error(`MCP ${this.name} is not running`);
    }

    const encoded = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
    await this.writer.write(encoded);
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}

function getConnection(
  serverName: string,
  config: McpServerConfig,
): McpConnection {
  const existing = connections.get(serverName);

  if (existing) {
    return existing;
  }

  const connection = new McpConnection(serverName, config);
  connections.set(serverName, connection);
  return connection;
}

export async function addMcpServer(
  serverName: string,
  serverConfig: McpServerConfig,
): Promise<void> {
  const config = await loadConfig();
  config.servers = {
    ...(config.servers ?? {}),
    [serverName]: serverConfig,
  };

  const existing = connections.get(serverName);
  if (existing) {
    existing.close();
    connections.delete(serverName);
  }

  await saveConfig(config);
}

export async function loadMcpTools(): Promise<McpToolRegistry> {
  const config = await loadConfig();
  const tools: MistralToolDefinition[] = [];
  const entries = new Map<string, ToolRegistryEntry>();

  for (
    const [serverName, serverConfig] of Object.entries(
      config.servers ?? {},
    )
  ) {
    try {
      const connection = getConnection(serverName, serverConfig);
      const serverTools = await connection.listTools();

      for (const tool of serverTools) {
        const functionName = sanitizeToolName(`${serverName}_${tool.name}`);
        entries.set(functionName, {
          serverName,
          toolName: tool.name,
        });
        tools.push({
          type: "function",
          function: {
            name: functionName,
            description: tool.description,
            parameters: tool.inputSchema ?? {
              type: "object",
              properties: {},
            },
          },
        });
      }
    } catch (error) {
      console.error(`Could not load MCP server ${serverName}`, error);
    }
  }

  return { tools, entries };
}

export function filterMcpToolRegistry(
  registry: McpToolRegistry,
  include: (
    functionName: string,
    entry: ToolRegistryEntry,
    tool: MistralToolDefinition,
  ) => boolean,
): McpToolRegistry {
  const tools: MistralToolDefinition[] = [];
  const entries = new Map<string, ToolRegistryEntry>();

  for (const tool of registry.tools) {
    const functionName = tool.function.name;
    const entry = registry.entries.get(functionName);

    if (!entry || !include(functionName, entry, tool)) {
      continue;
    }

    tools.push(tool);
    entries.set(functionName, entry);
  }

  return { tools, entries };
}

export async function callMcpTool(
  registry: McpToolRegistry,
  toolName: string,
  rawArguments: unknown,
): Promise<string> {
  const entry = registry.entries.get(toolName);

  if (!entry) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  const config = await loadConfig();
  const serverConfig = config.servers?.[entry.serverName];

  if (!serverConfig) {
    throw new Error(`MCP server is no longer configured: ${entry.serverName}`);
  }

  const connection = getConnection(entry.serverName, serverConfig);
  return await connection.callTool(
    entry.toolName,
    parseJsonArguments(rawArguments),
  );
}
