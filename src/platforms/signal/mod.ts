import { spawn, type ChildProcess, execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createConnection, type Socket } from "node:net";
import * as path from "node:path";
import type { AppConfig } from "../../core/config.ts";
import type {
  AgentContext,
  AgentPlatform,
  ConfigSchema,
  ConversationMessage,
  InboundMessage,
  MessageAttachment,
  PlatformModule,
} from "../../core/types.ts";

// ─── Constants ─────────────────────────────────────────────────────────────────

const SIGNAL_CLI_DIR = path.join("data", "signal-cli");
const SIGNAL_CLI_CONFIG_DIR = path.join("data", "signal-cli-config");
const SIGNAL_CLI_REPO = "AsamK/signal-cli";

// ─── JSON-RPC client for signal-cli daemon ────────────────────────────────────

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
type NotificationHandler = (params: Record<string, unknown>) => void;

class SignalJsonRpc {
  #conn?: Socket;
  #pending = new Map<
    JsonRpcId,
    {
      resolve(result: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #nextId = 1;
  #handlers = new Map<string, Set<NotificationHandler>>();
  #buffer = "";
  #decoder = new TextDecoder();
  #encoder = new TextEncoder();
  #logger?: AgentContext["logger"];

  constructor(logger?: AgentContext["logger"]) {
    this.#logger = logger;
  }

  async connect(address: string): Promise<void> {
    if (address.includes(":")) {
      // TCP: host:port
      const [host, portStr] = address.split(":");
      const port = parseInt(portStr, 10);
      if (!port || port < 1 || port > 65535) {
        throw new Error(`Invalid TCP port: ${portStr}`);
      }
      this.#conn = createConnection({ host, port });
    } else {
      // UNIX socket path
      this.#conn = createConnection({ path: address });
    }

    await new Promise<void>((resolve, reject) => {
      this.#conn!.once("connect", resolve);
      this.#conn!.once("error", reject);
    });

    this.#logger?.info(`Connected to signal-cli daemon at ${address}`);
    this.#startReadLoop();
  }

  /** Send a JSON-RPC request and wait for the response. */
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = String(this.#nextId++);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`JSON-RPC request timeout: ${method}`));
      }, 30_000);

      this.#pending.set(id, { resolve, reject, timer });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      try {
        this.#send(request);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    await this.#send(notification);
  }

  /** Register a handler for incoming notifications. */
  on(method: string, handler: NotificationHandler): void {
    let handlers = this.#handlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(method, handlers);
    }
    handlers.add(handler);
  }

  close(): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    this.#pending.clear();

    try {
      this.#conn?.destroy();
    } catch {
      // ignore close errors
    }
    this.#conn = undefined;
  }

  #send(message: JsonRpcMessage): void {
    if (!this.#conn) {
      throw new Error("Not connected to signal-cli daemon");
    }

    const line = JSON.stringify(message) + "\n";
    this.#conn.write(line);
  }

  #startReadLoop(): void {
    this.#readLoop().catch((error) => {
      this.#logger?.error("Signal JSON-RPC read loop failed", error);
      this.close();
    });
  }

  async #readLoop(): Promise<void> {
    if (!this.#conn) return;

    try {
      for await (const chunk of this.#conn) {
        this.#buffer += this.#decoder.decode(chunk);

        // Process complete lines
        let newlineIndex: number;
        while ((newlineIndex = this.#buffer.indexOf("\n")) !== -1) {
          const line = this.#buffer.slice(0, newlineIndex).trim();
          this.#buffer = this.#buffer.slice(newlineIndex + 1);

          if (!line) continue;

          try {
            const message = JSON.parse(line) as JsonRpcMessage;
            this.#handleMessage(message);
          } catch (error) {
            this.#logger?.warn("Failed to parse JSON-RPC message", {
              error: String(error),
              line: line.slice(0, 200),
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "aborted") return;
      throw new Error("signal-cli daemon closed the connection");
    }
  }

  #handleMessage(message: JsonRpcMessage): void {
    // Check for response to a pending request
    if ("id" in message && message.id !== undefined && message.id !== null) {
      const pending = this.#pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);

        const response = message as JsonRpcResponse;
        if (response.error) {
          pending.reject(
            new Error(
              `JSON-RPC error ${response.error.code}: ${response.error.message}`,
            ),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Notification
    const notification = message as JsonRpcNotification;
    const handlers = this.#handlers.get(notification.method);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(notification.params);
        } catch (error) {
          this.#logger?.error(
            `Handler error for ${notification.method}`,
            error,
          );
        }
      }
    }
  }
}

// ─── Signal data message types ─────────────────────────────────────────────────

interface SignalAttachment {
  id?: string;
  contentType?: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
}

interface SignalDataMessage {
  timestamp: number;
  message?: string;
  groupInfo?: { groupId: string };
  quote?: SignalQuote;
  mentions?: SignalMention[];
  reaction?: SignalReaction;
  attachments?: SignalAttachment[];
  endSession?: boolean;
  expiresInSeconds?: number;
  profileKeyUpdate?: boolean;
  viewOnce?: boolean;
}

interface SignalQuote {
  id: number;
  author: string;
  text?: string;
  mentions?: SignalMention[];
}

interface SignalMention {
  name: string;
  number: string;
  uuid: string;
  start: number;
  length: number;
}

interface SignalReaction {
  emoji: string;
  targetAuthor: string;
  targetSentTimestamp: number;
  isRemove: boolean;
}

interface SignalEnvelope {
  source: string;
  sourceUuid: string;
  sourceDevice: number;
  timestamp: number;
  dataMessage?: SignalDataMessage;
  syncMessage?: SignalDataMessage & { sentMessage?: SignalDataMessage };
  receiptMessage?: { type: "READ" | "DELIVERY"; timestamp: number[] };
  typingMessage?: { action: "STARTED" | "STOPPED"; timestamp: number; groupId?: string };
}

interface SignalReceiveParams {
  account: string;
  envelope: SignalEnvelope;
}

interface SignalPlatformConfig {
  account?: string;
  socketPath?: string;
  commandPrefix: string;
  displayName: string;
  mentionOnly: boolean;
  respondToAllMessages: boolean;
  maxMessageLength: number;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
}

function parseSignalConfig(config: AppConfig): SignalPlatformConfig {
  const s = (config.data.signal ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    account: (s.account as string) ?? env["SIGNAL_ACCOUNT"],
    socketPath: (s.socketPath as string) ?? env["SIGNAL_SOCKET_PATH"],
    commandPrefix: (s.commandPrefix as string) ?? env["SIGNAL_COMMAND_PREFIX"] ?? "!M!",
    displayName: (s.displayName as string) ?? env["SIGNAL_DISPLAY_NAME"] ?? "Missy",
    mentionOnly: typeof s.mentionOnly === "boolean" ? s.mentionOnly : true,
    respondToAllMessages: typeof s.respondToAllMessages === "boolean" ? s.respondToAllMessages : false,
    maxMessageLength: typeof s.maxMessageLength === "number" ? s.maxMessageLength : 0,
    includeReplyContext: typeof s.includeReplyContext === "boolean" ? s.includeReplyContext : true,
    includeChannelContext: typeof s.includeChannelContext === "boolean" ? s.includeChannelContext : true,
    channelContextCount: typeof s.channelContextCount === "number" ? s.channelContextCount : 10,
    multiMessageDelimiter: (s.multiMessageDelimiter as string) ?? env["SIGNAL_MULTI_MESSAGE_DELIMITER"] ?? "|||",
    multiMessageDelayMs: typeof s.multiMessageDelayMs === "number" ? s.multiMessageDelayMs : 1500,
  };
}

// ─── Platform ─────────────────────────────────────────────────────────────────

class SignalPlatform implements AgentPlatform {
  readonly name = "signal";

  getSystemContext(): string {
    return [
      "<platform>",
      "  <name>Signal</name>",
      "  <description>You are communicating through Signal, a privacy-focused messenger with end-to-end encryption. Users are identified by phone numbers.</description>",
      "  <capabilities>",
      "    <capability>Direct messages and group chats</capability>",
      "    <capability>End-to-end encryption (Signal Protocol)</capability>",
      "    <capability>Message replies with quote context</capability>",
      "    <capability>Emoji reactions</capability>",
      "    <capability>Typing indicators and read receipts</capability>",
      "    <capability>File and image attachments</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">~4000 characters per message</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In groups, you only respond when @mentioned or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  #rpc?: SignalJsonRpc;
  #context?: AgentContext;
  #signalConfig?: SignalPlatformConfig;
  #botAccount?: string;
  #startedAt = 0;
  #daemonProcess?: ChildProcess;
  #daemonAddress = "";
  #sessionIds = new Map<string, string>();
  #sessionStartedAt = new Map<string, number>();
  #conversationContext = new Map<string, ConversationMessage[]>();
  #seenTimestamps = new Set<string>();

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start(context: AgentContext): Promise<void> {
    const config = parseSignalConfig(context.config);
    this.#signalConfig = config;
    if (!config.account) {
      throw new Error(
        "SIGNAL_ACCOUNT is required when the signal platform is enabled.",
      );
    }

    this.#context = context;
    this.#botAccount = config.account;
    this.#startedAt = Date.now();
    this.#loadSessions();

    // 1. Ensure Java is available
    await ensureJava(context.logger);

    // 2. Ensure signal-cli is installed
    const signalCliBin = await ensureSignalCli(context.logger);

    // 3. Resolve daemon address
    this.#daemonAddress = config.socketPath
      ? config.socketPath
      : process.platform === "win32"
      ? "127.0.0.1:7583"
      : resolveUnixSocketPath();

    // 4. Start the daemon
    await this.#startDaemon(signalCliBin, config.account);

    // 5. Connect JSON-RPC
    this.#rpc = new SignalJsonRpc(context.logger);
    await this.#rpc.connect(this.#daemonAddress);

    // 6. Verify account is registered
    await this.#verifyAccount();

    // 7. Register for incoming messages
    this.#rpc.on("receive", (params: unknown) => {
      this.#handleReceive(params as SignalReceiveParams).catch((error) =>
        context.logger.error("Failed to handle Signal message", error),
      );
    });

    context.logger.info(
      `Signal platform started for account ${config.account}`,
    );
  }

  async stop(): Promise<void> {
    // Close JSON-RPC connection
    this.#rpc?.close();
    this.#rpc = undefined;

    // Kill the daemon process
    if (this.#daemonProcess) {
      try {
        this.#daemonProcess.kill("SIGTERM");
        // Give it a moment to shut down gracefully
        await delay(1000);
        if (this.#daemonProcess.exitCode === null) {
          try {
            this.#daemonProcess.kill("SIGKILL");
          } catch {
            // already dead
          }
        }
      } catch {
        // process already exited
      }
      this.#daemonProcess = undefined;
    }

    this.#botAccount = undefined;
    this.#sessionIds.clear();
    this.#sessionStartedAt.clear();
    this.#conversationContext.clear();
    this.#seenTimestamps.clear();
  }

  // ─── Daemon management ───────────────────────────────────────────────────

  async #startDaemon(signalCliBin: string, account: string): Promise<void> {
    const logger = this.#context!.logger;
    const isTcp = this.#daemonAddress.includes(":");

    const args = [
      "--config",
      SIGNAL_CLI_CONFIG_DIR,
      "-a",
      account,
      "daemon",
    ];

    if (isTcp) {
      args.push("--tcp", this.#daemonAddress);
    } else {
      args.push("--socket", this.#daemonAddress);
    }

    logger.info(
      `Starting signal-cli daemon: ${signalCliBin} ${args.join(" ")}`,
    );

    // Ensure config directory exists
    fs.mkdirSync(SIGNAL_CLI_CONFIG_DIR, { recursive: true });

    // Clean up stale socket file from a previous run
    if (!isTcp) {
      try {
        fs.unlinkSync(this.#daemonAddress);
      } catch {
        // doesn't exist, that's fine
      }
    }

    if (process.platform === "win32") {
      this.#daemonProcess = spawn("cmd", ["/c", signalCliBin, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      this.#daemonProcess = spawn(signalCliBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    // Pipe stderr to logger so we can see daemon errors
    this.#pipeDaemonStderr(this.#daemonProcess, logger);

    // Wait for the daemon to be ready by polling the socket
    await this.#waitForDaemon(15_000);
  }

  #pipeDaemonStderr(
    p: ChildProcess,
    logger: AgentContext["logger"],
  ): void {
    (async () => {
      try {
        for await (const chunk of p.stderr!) {
          const text = new TextDecoder().decode(chunk);
          for (const line of text.split("\n").filter(Boolean)) {
            logger.debug(`[signal-cli daemon] ${line}`);
          }
        }
      } catch {
        // stream closed
      }
    })();
  }

  async #waitForDaemon(timeoutMs: number): Promise<void> {
    const logger = this.#context!.logger;
    const start = Date.now();
    const isTcp = this.#daemonAddress.includes(":");
    let lastError = "";

    while (Date.now() - start < timeoutMs) {
      // Check if the process died
      if (this.#daemonProcess && this.#daemonProcess.exitCode !== null) {
        throw new Error(
          "signal-cli daemon exited unexpectedly. Check that the account " +
            `(${this.#botAccount}) is registered. Run: ` +
            `signal-cli -a ${this.#botAccount} register`,
        );
      }

      try {
        if (isTcp) {
          const [host, portStr] = this.#daemonAddress.split(":");
          const testConn = createConnection({
            host,
            port: parseInt(portStr, 10),
          });
          await new Promise<void>((resolve, reject) => {
            testConn.once("connect", () => {
              testConn.destroy();
              resolve();
            });
            testConn.once("error", reject);
          });
          logger.info("signal-cli daemon is ready (TCP)");
          return;
        } else {
          fs.statSync(this.#daemonAddress);
          logger.info("signal-cli daemon is ready (socket)");
          return;
        }
      } catch (error) {
        lastError = String(error);
        await delay(250);
      }
    }

    throw new Error(
      `signal-cli daemon did not become ready within ${timeoutMs}ms. ` +
        `Last error: ${lastError}`,
    );
  }

  async #verifyAccount(): Promise<void> {
    try {
      const accounts = await this.#rpc!.request("listAccounts", {});
      const list = accounts as Array<{ number: string }> | undefined;
      if (!list || !Array.isArray(list) || list.length === 0) {
        throw new Error(
          `No Signal accounts found. Register your account first:\n` +
            `  signal-cli --config ${SIGNAL_CLI_CONFIG_DIR} -a ${this.#botAccount} register\n` +
            `Then verify with the code you receive:\n` +
            `  signal-cli --config ${SIGNAL_CLI_CONFIG_DIR} -a ${this.#botAccount} verify <code>`,
        );
      }

      const found = list.some(
        (a) => a.number === this.#botAccount ||
          a.number.replace(/^\+/, "") === this.#botAccount?.replace(/^\+/, ""),
      );
      if (!found) {
        throw new Error(
          `Account ${this.#botAccount} is not registered in signal-cli. ` +
            `Registered accounts: ${list.map((a) => a.number).join(", ") || "none"}. ` +
            `Register with: signal-cli --config ${SIGNAL_CLI_CONFIG_DIR} -a ${this.#botAccount} register`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Register") ||
          error.message.includes("No Signal accounts"))
      ) {
        throw error; // re-throw our own registration errors
      }
      // listAccounts may not be supported by all daemon versions; log and continue
      this.#context!.logger.warn(
        "Could not verify Signal account registration via listAccounts",
        error,
      );
    }
  }

  // ─── Message handling ────────────────────────────────────────────────────

  async #handleReceive(params: SignalReceiveParams): Promise<void> {
    if (!this.#context || !this.#rpc) return;

    const { envelope } = params;
    const dataMessage = envelope.dataMessage ??
      envelope.syncMessage?.sentMessage;
    if (!dataMessage) return;

    const rawContent = dataMessage.message?.trim() ?? "";
    const attachments = signalAttachments(dataMessage);
    if (!rawContent && attachments.length === 0) return;

    const content = rawContent || signalAttachmentSummary(attachments);
    const timestamp = dataMessage.timestamp;
    const dedupKey = `${envelope.source}:${timestamp}`;
    if (this.#seenTimestamps.has(dedupKey)) return;
    this.#rememberSeenTimestamp(dedupKey);

    // Skip messages received before startup (with a small grace window)
    if (timestamp < this.#startedAt - 5000) return;

    const isGroup = Boolean(dataMessage.groupInfo);
    const channelId = isGroup
      ? dataMessage.groupInfo!.groupId
      : envelope.source;
    const channelType = isGroup ? "group" : "dm";
    const guildId = isGroup ? dataMessage.groupInfo!.groupId : undefined;

    const authorName = envelope.source;

    // Track conversation context
    this.#rememberChannelContext(channelId, {
      id: `${envelope.source}:${timestamp}`,
      authorId: envelope.source,
      authorName,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      isBot: envelope.source === this.#botAccount,
    });

    // Ignore own messages
    if (envelope.source === this.#botAccount) return;

    // Determine if we should respond
    const mentioned = isMentioned(
      dataMessage,
      this.#signalConfig.displayName,
      this.#botAccount,
    );
    const prefix = this.#signalConfig.commandPrefix;
    const isPrefixCommand = prefix ? content.startsWith(prefix) : false;

    if (isGroup && !isPrefixCommand && !mentioned) {
      if (this.#signalConfig.respondToAllMessages) {
        // respond anyway
      } else if (this.#signalConfig.mentionOnly) {
        return;
      }
    }

    // Strip prefix and mention patterns
    let messageContent = content;
    if (isPrefixCommand) {
      messageContent = content.slice(prefix.length).trim();
    } else if (mentioned && isGroup) {
      messageContent = stripMention(
        content,
        this.#signalConfig.displayName,
        this.#botAccount,
      );
    }

    // Handle local commands
    if (
      await this.#handleLocalCommand(
        messageContent,
        channelId,
        envelope.source,
        timestamp,
        isGroup,
      )
    ) {
      return;
    }

    if (!messageContent && attachments.length === 0) {
      await this.#sendReply(
        channelId,
        envelope.source,
        timestamp,
        "What do you need?",
        isGroup,
      );
      return;
    }

    // Send typing indicator
    const recipient = isGroup
      ? dataMessage.groupInfo!.groupId
      : envelope.source;
    this.#rpc.notify("sendTyping", {
      account: this.#botAccount,
      recipient,
      stop: false,
    }).catch(() => {});

    const typingTimer = setInterval(() => {
      this.#rpc?.notify("sendTyping", {
        account: this.#botAccount,
        recipient,
        stop: false,
      }).catch(() => {});
    }, 10_000);

    const inbound: InboundMessage = {
      id: `${envelope.source}:${timestamp}`,
      platform: this.name,
      channelId,
      channelType,
      guildId,
      authorId: envelope.source,
      authorName,
      content: messageContent || content,
      attachments: attachments.length > 0 ? attachments : undefined,
      context: this.#getChannelContext(
        channelId,
        `${envelope.source}:${timestamp}`,
      ),
      replyTo: await this.#buildReplyReference(dataMessage),
      reply: async (replyContent) => {
        await this.#sendMultiMessageReply(
          channelId,
          envelope.source,
          timestamp,
          replyContent,
          isGroup,
        );
      },
    };

    try {
      await this.#context.handleMessage(inbound);
      // Send read receipt
      await this.#rpc.notify("sendReceipt", {
        account: this.#botAccount,
        recipient: envelope.source,
        targetSentTimestamp: timestamp,
        type: "read",
      }).catch(() => {});
    } finally {
      clearInterval(typingTimer);
      // Stop typing
      this.#rpc.notify("sendTyping", {
        account: this.#botAccount,
        recipient,
        stop: true,
      }).catch(() => {});
    }
  }

  // ─── Local commands ──────────────────────────────────────────────────────

  async #handleLocalCommand(
    content: string,
    channelId: string,
    senderId: string,
    timestamp: number,
    isGroup: boolean,
  ): Promise<boolean> {
    const [command = "", ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "help" || normalized === "commands") {
      await this.#sendMessage(
        channelId,
        senderId,
        [
          "Commands:",
          "DMs: help, status, memory, memory all, session, session new [name], plugins, tools, or any message.",
          "Groups: mention Missy with help, status, memory, session, plugins, tools, or a message.",
        ].join("\n"),
        isGroup,
        timestamp,
      );
      return true;
    }

    if (normalized === "status") {
      await this.#sendMessage(
        channelId,
        senderId,
        this.#formatStatus(),
        isGroup,
        timestamp,
      );
      return true;
    }

    if (normalized === "tools") {
      await this.#sendMessage(
        channelId,
        senderId,
        this.#formatTools(),
        isGroup,
        timestamp,
      );
      return true;
    }

    if (normalized === "plugins") {
      await this.#sendMessage(
        channelId,
        senderId,
        this.#formatPlugins(),
        isGroup,
        timestamp,
      );
      return true;
    }

    if (normalized === "session" || normalized === "sessions") {
      const action = args[0]?.toLowerCase();
      if (action === "new" || action === "start" || action === "clear") {
        const session = await this.#startSession(
          channelId,
          args.slice(1).join(" "),
        );
        await this.#sendMessage(
          channelId,
          senderId,
          `Started session ${session.id}. Earlier context is now ignored.`,
          isGroup,
          timestamp,
        );
        return true;
      }

      await this.#sendMessage(
        channelId,
        senderId,
        this.#formatSession(channelId),
        isGroup,
        timestamp,
      );
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await this.#sendMessage(
        channelId,
        senderId,
        this.#formatMemory(senderId, args[0]?.toLowerCase() === "all"),
        isGroup,
        timestamp,
      );
      return true;
    }

    return false;
  }

  // ─── Formatters ──────────────────────────────────────────────────────────

  #formatTools(): string {
    if (!this.#context) return "Missy is not ready.";

    const tools = this.#context.tools.list();
    if (tools.length === 0) return "No tools are registered.";

    return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join(
      "\n",
    );
  }

  #formatPlugins(): string {
    if (!this.#context) return "Missy is not ready.";

    if (this.#context.plugins.length === 0) return "No plugins are loaded.";

    return this.#context.plugins
      .map((plugin) =>
        `- ${plugin.name} v${plugin.version}: ${plugin.description}`
      )
      .join("\n");
  }

  #formatMemory(userId: string, includeAll: boolean): string {
    if (!this.#context) return "Missy is not ready.";

    if (!this.#context.config.memory.enabled) return "Memory is disabled.";

    if (includeAll) {
      const allMemory = this.#context.memory.getAllMemory();
      const lines = Object.entries(allMemory).flatMap((
        [storedUserId, records],
      ) =>
        records.map((record) =>
          `- ${storedUserId}.${record.key}: ${record.value}`
        )
      );
      return lines.length > 0 ? lines.join("\n") : "No memory stored.";
    }

    const records = this.#context.memory.getUserMemory(userId);
    return records.length > 0
      ? records.map((record) => `- ${record.key}: ${record.value}`).join("\n")
      : "No memory stored for you yet.";
  }

  #formatStatus(): string {
    if (!this.#context) return "Missy is not ready.";

    return [
      "Missy is online.",
      `Platform: Signal (signal-cli daemon)`,
      `Account: ${this.#botAccount}`,
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled",
      "Group routing: direct mentions only",
      `Reply context: ${
        this.#signalConfig.includeReplyContext ? "enabled" : "disabled"
      }`,
      `Channel context: ${
        this.#signalConfig.includeChannelContext
          ? "enabled"
          : "disabled"
      }`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }

  #formatSession(channelId: string): string {
    const id = this.#sessionIds.get(channelId);
    const startedAt = this.#sessionStartedAt.get(channelId);
    if (!id || !startedAt) {
      return "Current session: default\nContext includes the configured live conversation history.";
    }

    return [
      `Current session: ${id}`,
      `Started: ${new Date(startedAt).toISOString()}`,
      "Context only includes messages after this session started.",
    ].join("\n");
  }

  // ─── Reply building ──────────────────────────────────────────────────────

  async #buildReplyReference(
    dataMessage: SignalDataMessage,
  ): Promise<InboundMessage["replyTo"]> {
    if (!this.#signalConfig?.includeReplyContext) return undefined;

    const quote = dataMessage.quote;
    if (!quote) return undefined;

    return {
      id: String(quote.id),
      authorId: quote.author,
      authorName: quote.author,
      content: quote.text ?? "",
    };
  }

  // ─── Sending ─────────────────────────────────────────────────────────────

  async #sendMultiMessageReply(
    channelId: string,
    senderId: string,
    timestamp: number,
    content: string,
    isGroup: boolean,
  ): Promise<void> {
    const delimiter = this.#signalConfig?.multiMessageDelimiter ??
      "|||";
    const delayMs = this.#signalConfig?.multiMessageDelayMs ?? 1500;
    const parts = splitByDelimiter(content, delimiter);

    if (parts.length <= 1) {
      await this.#sendReply(channelId, senderId, timestamp, content, isGroup);
      return;
    }

    await this.#sendReply(channelId, senderId, timestamp, parts[0], isGroup);
    for (const part of parts.slice(1)) {
      await delay(delayMs);
      await this.#sendText(channelId, part, isGroup);
    }
  }

  async #sendReply(
    channelId: string,
    senderId: string,
    timestamp: number,
    content: string,
    isGroup: boolean,
  ): Promise<void> {
    const chunks = splitMessage(
      content,
      this.#signalConfig?.maxMessageLength,
    );
    const [first = ""] = chunks;
    const recipient = isGroup ? channelId : senderId;

    await this.#rpc?.request("send", {
      account: this.#botAccount,
      recipient,
      message: first,
      quoteTimestamp: timestamp,
      quoteAuthor: senderId,
    });

    for (const chunk of chunks.slice(1)) {
      await this.#sendText(channelId, chunk, isGroup);
    }
  }

  async #sendText(
    channelId: string,
    content: string,
    isGroup: boolean,
  ): Promise<void> {
    const recipient = isGroup ? channelId : channelId;
    for (
      const chunk of splitMessage(
        content,
        this.#signalConfig?.maxMessageLength,
      )
    ) {
      await this.#rpc?.request("send", {
        account: this.#botAccount,
        recipient,
        message: chunk,
      });
    }
  }

  async #sendMessage(
    channelId: string,
    senderId: string,
    content: string,
    isGroup: boolean,
    timestamp: number,
  ): Promise<void> {
    await this.#sendReply(channelId, senderId, timestamp, content, isGroup);
  }

  // ─── Conversation context ────────────────────────────────────────────────

  #rememberChannelContext(
    channelId: string,
    message: ConversationMessage,
  ): void {
    const limit = Math.max(
      (this.#signalConfig?.channelContextCount ?? 10) * 2,
      50,
    );
    const buffer = this.#conversationContext.get(channelId) ?? [];
    buffer.push(message);
    if (buffer.length > limit) {
      buffer.splice(0, buffer.length - limit);
    }
    this.#conversationContext.set(channelId, buffer);
  }

  #getChannelContext(
    channelId: string,
    currentMessageId: string,
  ): ConversationMessage[] | undefined {
    if (!this.#signalConfig?.includeChannelContext) return undefined;

    const limit = this.#signalConfig.channelContextCount;
    if (limit <= 0) return undefined;

    const buffer = this.#conversationContext.get(channelId) ?? [];
    return buffer
      .filter((message) =>
        message.id !== currentMessageId &&
        !message.id.startsWith("session-sep-")
      )
      .slice(-limit);
  }

  #rememberSeenTimestamp(key: string): void {
    this.#seenTimestamps.add(key);
    if (this.#seenTimestamps.size > 5000) {
      this.#seenTimestamps = new Set([...this.#seenTimestamps].slice(-2500));
    }
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  #loadSessions(): void {
    if (!this.#context) return;

    const stored = this.#context.keystore.namespace("signal").get("sessions");
    if (!isRecord(stored)) return;

    for (const [channelId, session] of Object.entries(stored)) {
      if (!isRecord(session)) continue;

      const id = typeof session.id === "string" ? session.id : undefined;
      const startedAt = typeof session.startedAt === "number"
        ? session.startedAt
        : undefined;
      if (!id || !startedAt) continue;

      this.#sessionIds.set(channelId, id);
      this.#sessionStartedAt.set(channelId, startedAt);
    }
  }

  async #startSession(
    channelId: string,
    requestedName?: string,
  ): Promise<{ id: string; startedAt: number }> {
    const startedAt = Date.now();
    const id = normalizeSessionName(requestedName) ?? generateSessionId();
    this.#sessionIds.set(channelId, id);
    this.#sessionStartedAt.set(channelId, startedAt);
    // Seed the context buffer with a separator so the AI sees the session boundary
    this.#conversationContext.set(channelId, [{
      id: `session-sep-${id}`,
      authorId: "system",
      authorName: "session",
      content: "====================",
      isBot: true,
    }]);
    await this.#saveSessions();
    return { id, startedAt };
  }

  async #saveSessions(): Promise<void> {
    if (!this.#context) return;

    const sessions: Record<string, { id: string; startedAt: number }> = {};
    for (const [channelId, id] of this.#sessionIds) {
      const startedAt = this.#sessionStartedAt.get(channelId);
      if (startedAt) {
        sessions[channelId] = { id, startedAt };
      }
    }

    await this.#context.keystore.namespace("signal").set(
      "sessions",
      sessions,
    );
  }
}

// ─── signal-cli installation ───────────────────────────────────────────────────

async function ensureJava(
  logger: AgentContext["logger"],
): Promise<void> {
  try {
    const result = execSync("java -version 2>&1", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    logger.info(`Java detected: ${result.split("\n")[0]}`);
  } catch {
    throw new Error(
      "Java is required to run signal-cli but was not found on your PATH.\n" +
        "Install Java 17 or later: https://adoptium.net/",
    );
  }
}

/**
 * Ensure signal-cli is installed under SIGNAL_CLI_DIR.
 * Downloads the latest release from GitHub if not already present.
 * Returns the path to the signal-cli executable.
 */
async function ensureSignalCli(
  logger: AgentContext["logger"],
): Promise<string> {
  const binName = process.platform === "win32" ? "signal-cli.bat" : "signal-cli";
  const binPath = path.join(SIGNAL_CLI_DIR, "bin", binName);

  try {
    fs.statSync(binPath);
    logger.info(`signal-cli found at ${binPath}`);
    return binPath;
  } catch {
    logger.info("signal-cli not found; downloading...");
  }

  fs.mkdirSync(SIGNAL_CLI_DIR, { recursive: true });

  // Find the latest release
  const releaseUrl = await getLatestReleaseUrl(logger);
  logger.info(`Downloading signal-cli from ${releaseUrl}`);

  // Download the tar.gz
  const response = await fetch(releaseUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download signal-cli: HTTP ${response.status}`,
    );
  }

  const tarGzPath = path.join(SIGNAL_CLI_DIR, "signal-cli.tar.gz");

  // Write the tarball to disk
  const dest = fs.createWriteStream(tarGzPath);
  const reader = response.body!.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      dest.write(value);
    }
  } finally {
    dest.end();
  }

  // Extract
  logger.info("Extracting signal-cli...");
  try {
    execSync(`tar -xzf "${tarGzPath}" -C "${SIGNAL_CLI_DIR}"`, {
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`Failed to extract signal-cli: ${String(error)}`);
  }

  // Clean up tarball
  try {
    fs.unlinkSync(tarGzPath);
  } catch {
    // ignore
  }

  // Make the binary executable on Unix
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(binPath, 0o755);
    } catch {
      logger.warn("Could not set executable permission on signal-cli binary");
    }
  }

  logger.info(`signal-cli installed to ${SIGNAL_CLI_DIR}`);
  return binPath;
}

async function getLatestReleaseUrl(
  logger: AgentContext["logger"],
): Promise<string> {
  const apiUrl =
    `https://api.github.com/repos/${SIGNAL_CLI_REPO}/releases/latest`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "missy-signal-platform",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const release = await response.json() as {
      assets?: Array<{ browser_download_url: string; name: string }>;
    };

    if (!release.assets || release.assets.length === 0) {
      throw new Error("No assets found in latest release");
    }

    // Find the main tar.gz asset (not the Windows-specific one first, prefer the Unix one)
    const tarAsset = release.assets.find((a) =>
      a.name.endsWith(".tar.gz") && !a.name.includes("Windows")
    ) ?? release.assets.find((a) => a.name.endsWith(".tar.gz"));

    if (!tarAsset) {
      throw new Error("No .tar.gz asset found in latest release");
    }

    return tarAsset.browser_download_url;
  } catch (error) {
    // Fallback to a known version if the API call fails (rate limiting, etc.)
    logger.warn(
      `Could not fetch latest release from GitHub API: ${String(error)}. ` +
        "Falling back to a known release version.",
    );

    // This is a reasonable fallback. The URL pattern is stable.
    // If you need a different version, set SIGNAL_SOCKET_PATH to point
    // to an existing signal-cli installation.
    return "https://github.com/AsamK/signal-cli/releases/download/v0.13.11/signal-cli-0.13.11.tar.gz";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveUnixSocketPath(): string {
  const xdgRuntime = process.env["XDG_RUNTIME_DIR"];
  if (xdgRuntime) {
    return `${xdgRuntime}/signal-cli/socket`;
  }
  return "/var/run/signal-cli/socket";
}

function isMentioned(
  dataMessage: SignalDataMessage,
  displayName: string,
  botAccount: string | undefined,
): boolean {
  // Check native mentions array
  if (dataMessage.mentions && dataMessage.mentions.length > 0) {
    const botNumber = botAccount?.replace(/^\+/, "");
    for (const mention of dataMessage.mentions) {
      if (
        mention.number === botAccount ||
        mention.number.replace(/^\+/, "") === botNumber
      ) {
        return true;
      }
    }
  }

  // Check text for @mention patterns
  const body = dataMessage.message;
  if (!body) return false;

  const patterns: string[] = [];
  if (displayName) {
    patterns.push(`@${displayName}`);
    patterns.push(displayName);
  }
  if (botAccount) {
    patterns.push(botAccount);
    patterns.push(`@${botAccount}`);
  }

  const lower = body.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function stripMention(
  content: string,
  displayName: string,
  botAccount: string | undefined,
): string {
  let result = content;

  const patterns: string[] = [];
  if (displayName) {
    patterns.push(`@${displayName}`);
    patterns.push(displayName);
  }
  if (botAccount) {
    patterns.push(botAccount);
    patterns.push(`@${botAccount}`);
  }

  for (const pattern of patterns) {
    const index = result.toLowerCase().indexOf(pattern.toLowerCase());
    if (index !== -1) {
      result = result.slice(0, index) + result.slice(index + pattern.length);
    }
  }

  return result.trim().replace(/^[,:;.!?\s]+/, "").trim();
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(36).padStart(2, "0")
  )
    .join("")
    .toLowerCase()
    .slice(0, 10);
  return `session-${suffix}`;
}

function normalizeSessionName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitMessage(content: string, maxLength = 0): string[] {
  const effectiveMax = maxLength > 0 ? maxLength : 4000;
  const normalized = content.trim();
  if (normalized.length <= effectiveMax) return [normalized || " "];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > effectiveMax) {
    let splitAt = remaining.lastIndexOf("\n", effectiveMax);
    if (splitAt < Math.floor(effectiveMax * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", effectiveMax);
    }
    if (splitAt < 1) splitAt = effectiveMax;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);

  return chunks;
}

function splitByDelimiter(content: string, delimiter: string): string[] {
  return content
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function signalAttachments(dataMessage: SignalDataMessage): MessageAttachment[] {
  return (dataMessage.attachments ?? []).map((a) => ({
    id: a.id ?? "",
    contentType: a.contentType,
    name: a.filename,
    size: a.size,
    width: a.width,
    height: a.height,
    caption: a.caption,
  }));
}

function signalAttachmentSummary(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const names = attachments.map((a) => a.name ?? "attachment").join(", ");
  return `[Attachment${attachments.length > 1 ? "s" : ""}: ${names}]`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Module export ────────────────────────────────────────────────────────────

const module: PlatformModule = {
  metadata: {
    name: "signal",
    description:
      "Signal platform adapter backed by signal-cli JSON-RPC daemon. Auto-installs and manages the daemon lifecycle.",
    version: "0.1.0",
  },
  configSchema: {
    module: "signal",
    label: "Signal Platform",
    fields: [
      {
        key: "signal.account",
        label: "Signal Account",
        description:
          "Phone number registered with signal-cli (e.g. +1234567890)",
        type: "string",
        required: true,
      },
      {
        key: "signal.socketPath",
        label: "Signal Daemon Socket Path",
        description:
          "Path to the signal-cli daemon JSON-RPC socket (UNIX) or host:port (TCP). Auto-detected when empty.",
        type: "string",
        required: false,
      },
      {
        key: "signal.commandPrefix",
        label: "Command Prefix",
        description: "Prefix for text commands",
        type: "string",
        required: false,
        default: "!M!",
      },
      {
        key: "signal.displayName",
        label: "Signal Display Name",
        description: "Display name referenced in mention patterns",
        type: "string",
        required: false,
        default: "Missy",
      },
      {
        key: "signal.mentionOnly",
        label: "Mention Only",
        description: "Only respond in groups when mentioned",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "signal.respondToAllMessages",
        label: "Respond to All Messages",
        description: "Respond to every message in Signal groups",
        type: "boolean",
        required: false,
        default: false,
        hidden: true,
      },
      {
        key: "signal.maxMessageLength",
        label: "Max Message Length",
        description: "Maximum characters per Signal message",
        type: "number",
        required: false,
        default: 0,
        hidden: true,
      },
      {
        key: "signal.includeReplyContext",
        label: "Include Reply Context",
        description:
          "Include the quoted message when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "signal.includeChannelContext",
        label: "Include Channel Context",
        description:
          "Include recent conversation when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "signal.channelContextCount",
        label: "Channel Context Count",
        description:
          "Number of recent messages to include as conversation context",
        type: "number",
        required: false,
        default: 10,
        hidden: true,
      },
      {
        key: "signal.multiMessageDelimiter",
        label: "Multi-Message Delimiter",
        description:
          "Delimiter used to split long responses into multiple messages",
        type: "string",
        required: false,
        default: "|||",
        hidden: true,
      },
      {
        key: "signal.multiMessageDelayMs",
        label: "Multi-Message Delay",
        description: "Delay in milliseconds between multi-message parts",
        type: "number",
        required: false,
        default: 1500,
        hidden: true,
      },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new SignalPlatform(),
};

export default module;
