export type McpOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUrl?: string;
  authUrl?: string;
  scopes?: string[];
};

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  oauth?: McpOAuthConfig;
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

interface McpTransport {
  listTools(): Promise<McpTool[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<string>;
  close(): void;
}

function isHttpServerConfig(config: McpServerConfig): boolean {
  return /^https?:\/\//i.test(config.command);
}

class McpHttpConnection implements McpTransport {
  private sessionId: string | undefined;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(
    private readonly name: string,
    private readonly url: string,
    private readonly env?: Record<string, string>,
    private readonly oauth?: McpOAuthConfig,
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
    this.sessionId = undefined;
    this.accessToken = undefined;
    this.tokenExpiresAt = 0;
  }

  private async ensureAccessToken(): Promise<void> {
    if (!this.oauth) {
      return;
    }

    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return;
    }

    const tokenUrl = this.oauth.tokenUrl ?? "https://oauth2.googleapis.com/token";
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.oauth.clientId,
        client_secret: this.oauth.clientSecret,
        refresh_token: this.oauth.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        event: "mcp_oauth_refresh_failed",
        server: this.name,
        status: response.status,
        body: text.slice(0, 500),
      }));
      throw new Error(
        `OAuth token refresh for MCP ${this.name} failed (${response.status}): ${text}`,
      );
    }

    const parsed = JSON.parse(text) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!parsed.access_token) {
      throw new Error(
        `OAuth token refresh for MCP ${this.name} returned no access_token`,
      );
    }

    console.log(JSON.stringify({
      at: new Date().toISOString(),
      event: "mcp_oauth_refresh_ok",
      server: this.name,
      scope: parsed.scope,
      expiresIn: parsed.expires_in,
    }));

    this.accessToken = parsed.access_token;
    // Refresh 60 seconds early to avoid edge-case expiry
    this.tokenExpiresAt = Date.now() +
      ((parsed.expires_in ?? 3600) - 60) * 1000;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method !== "initialize" && !this.sessionId) {
      await this.initialize();
    }

    await this.ensureAccessToken();

    const id = Math.floor(Math.random() * 1_000_000);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    if (this.env) {
      for (const [key, value] of Object.entries(this.env)) {
        if (key.startsWith("HEADER_")) {
          headers[key.slice(7).replace(/_/g, "-")] = value;
        }
      }
    }

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const response = await withTimeout(
      fetch(this.url, { method: "POST", headers, body }),
      DEFAULT_TOOL_TIMEOUT_MS,
    );

    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    const contentType = response.headers.get("Content-Type") ?? "";

    if (contentType.includes("text/event-stream")) {
      return await this.parseSSEResponse(response);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `MCP HTTP ${this.name} returned ${response.status}: ${text}`,
      );
    }

    const parsed = JSON.parse(text) as JsonRpcResponse;

    if (parsed.error) {
      throw new Error(
        parsed.error.message ?? `MCP HTTP ${this.name} request failed`,
      );
    }

    return parsed.result;
  }

  private async parseSSEResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    const lines = text.split("\n");
    let lastData: string | undefined;

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        lastData = line.slice(6);
      }
    }

    if (!lastData) {
      throw new Error(`MCP HTTP ${this.name} returned empty SSE response`);
    }

    const parsed = JSON.parse(lastData) as JsonRpcResponse;

    if (parsed.error) {
      throw new Error(
        parsed.error.message ?? `MCP HTTP ${this.name} request failed`,
      );
    }

    return parsed.result;
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "missy",
        version: "0.1.0",
      },
    });
  }
}

const httpConnections = new Map<string, McpHttpConnection>();

function getConnection(
  serverName: string,
  config: McpServerConfig,
): McpTransport {
  if (isHttpServerConfig(config)) {
    const existing = httpConnections.get(serverName);
    if (existing) {
      return existing;
    }
    const connection = new McpHttpConnection(
      serverName,
      config.command,
      config.env,
      config.oauth,
    );
    httpConnections.set(serverName, connection);
    return connection;
  }

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

  const existingHttp = httpConnections.get(serverName);
  if (existingHttp) {
    existingHttp.close();
    httpConnections.delete(serverName);
  }

  await saveConfig(config);
}

const OAUTH_LISTENER_PORT = 8914;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_LISTENER_PORT}`;
const OAUTH_TIMEOUT_MS = 120_000;

const DEFAULT_GOOGLE_SCOPES = [
  // Gmail
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  // Google Drive
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  // Google Calendar
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  // People API
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
];

const DEFAULT_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type OAuthSetupResult = {
  consentUrl: string;
  waitForCompletion: () => Promise<void>;
};

export type OAuthFlowOptions = {
  authUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
};

export function buildOAuthConsentUrl(
  clientId: string,
  options: OAuthFlowOptions = {},
): string {
  const authUrl = options.authUrl ?? DEFAULT_AUTH_URL;
  const scopes = options.scopes ?? DEFAULT_GOOGLE_SCOPES;
  const url = new URL(authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function completeOAuthFlow(
  serverName: string,
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  options: OAuthFlowOptions = {},
): Promise<void> {
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
  const code = await listenForOAuthCode();

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!parsed.refresh_token) {
    throw new Error(
      "No refresh_token returned. Ensure access_type=offline and prompt=consent.",
    );
  }

  await addMcpServer(serverName, {
    command: serverUrl,
    oauth: {
      clientId,
      clientSecret,
      refreshToken: parsed.refresh_token,
      ...(options.tokenUrl ? { tokenUrl: options.tokenUrl } : {}),
      ...(options.authUrl ? { authUrl: options.authUrl } : {}),
      ...(options.scopes ? { scopes: options.scopes } : {}),
    },
  });
}

function listenForOAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("OAuth flow timed out after 2 minutes."));
    }, OAUTH_TIMEOUT_MS);

    const controller = new AbortController();

    const server = Deno.serve(
      { port: OAUTH_LISTENER_PORT, signal: controller.signal, onListen: () => {} },
      (request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        clearTimeout(timeout);

        if (error) {
          controller.abort();
          reject(new Error(`OAuth error: ${error}`));
          return new Response(
            "<h1>Authorization failed</h1><p>You can close this tab.</p>",
            { headers: { "Content-Type": "text/html" } },
          );
        }

        if (!code) {
          return new Response(
            "<h1>Missing authorization code</h1>",
            { headers: { "Content-Type": "text/html" }, status: 400 },
          );
        }

        // Resolve then shut down after a small delay to send the response
        setTimeout(() => controller.abort(), 500);
        resolve(code);
        return new Response(
          "<h1>Authorization successful!</h1><p>You can close this tab and return to Discord.</p>",
          { headers: { "Content-Type": "text/html" } },
        );
      },
    );

    // Suppress unhandled rejection when server shuts down via abort
    server.finished.catch(() => {});
  });
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

  const args = parseJsonArguments(rawArguments);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp_tool_call",
    server: entry.serverName,
    tool: entry.toolName,
    functionName: toolName,
    arguments: args,
  }));

  const connection = getConnection(entry.serverName, serverConfig);
  const result = await connection.callTool(entry.toolName, args);

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp_tool_result",
    server: entry.serverName,
    tool: entry.toolName,
    functionName: toolName,
    resultLength: result.length,
  }));

  return result;
}
