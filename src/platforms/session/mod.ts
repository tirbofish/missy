import * as crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Session.js types are imported dynamically to avoid Deno runtime issues
// with extensionless imports in transitive dependencies (signal-bindings).
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

// Message type matched to @session.js/client internal Message shape.
// Not exported from the package's public API, so we mirror it here.
interface SessionMessage {
  type: "private" | "group";
  groupId?: string;
  id: string;
  from: string;
  author: { displayName: string };
  text?: string;
  attachments: SessionAttachment[];
  replyToMessage?: {
    timestamp: number;
    author: string;
    text?: string;
    attachments?: { contentType?: string; fileName?: string }[];
  };
  timestamp: number;
  getReplyToMessage():
    | {
        timestamp: number;
        author: string;
        text?: string;
        attachments?: { contentType?: string; fileName?: string }[];
      }
    | undefined;
}

interface SessionAttachment {
  id: string;
  caption?: string;
  name?: string;
  size?: number;
  metadata: { width?: number; height?: number; contentType?: string };
}

/** Local interface mirroring @session.js/client Session class API we use. */
interface SessionInstance {
  setMnemonic(mnemonic: string, displayName?: string): void;
  getSessionID(): string;
  getDisplayName(): string | undefined;
  setDisplayName(name: string): Promise<void>;
  sendMessage(args: {
    to: string;
    text?: string;
    attachments?: File[];
    voiceMessage?: Blob;
    replyToMessage?: {
      timestamp: number;
      author: string;
      text?: string;
    };
  }): Promise<{ messageHash: string; syncMessageHash: string; timestamp: number }>;
  addPoller(poller: PollerInstance): void;
  showTypingIndicator(args: { conversation: string }): Promise<void>;
  hideTypingIndicator(args: { conversation: string }): Promise<void>;
  markMessagesAsRead(args: {
    from: string;
    messagesTimestamps: number[];
    readAt?: number;
  }): Promise<void>;
  acceptConversationRequest(args: { from: string }): Promise<void>;
  addReaction(args: {
    messageTimestamp: number;
    messageAuthor: string;
    emoji: string;
  }): Promise<void>;
  removeReaction(args: {
    messageTimestamp: number;
    messageAuthor: string;
    emoji: string;
  }): Promise<void>;
  deleteMessage(args: {
    to: string;
    timestamp: number;
    hash: string;
  }): Promise<void>;
  deleteMessages(args: Array<{
    to: string;
    timestamp: number;
    hash: string;
  }>): Promise<void>;
  // deno-lint-ignore no-explicit-any
  on(eventName: string, callback: (data: any) => void): void;
  // deno-lint-ignore no-explicit-any
  off(eventName: string, callback: (data: any) => void): void;
}

/** Local interface mirroring @session.js/client Poller class. */
// deno-lint-ignore no-empty-interface
interface PollerInstance {}

export interface SessionService {
  readonly platformName: "session";
  react(channelId: string, messageTimestamp: number, messageAuthor: string, emoji: string): Promise<void>;
  removeReaction(channelId: string, messageTimestamp: number, messageAuthor: string, emoji: string): Promise<void>;
  deleteMessage(channelId: string, timestamp: number, hash: string): Promise<void>;
}

interface SessionPlatformConfig {
  mnemonic?: string;
  displayName: string;
  commandPrefix: string;
  mentionOnly: boolean;
  respondToAllMessages: boolean;
  maxMessageLength: number;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
  autoAcceptRequests: boolean;
}

function parseSessionConfig(config: AppConfig): SessionPlatformConfig {
  const s = (config.data.session ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    mnemonic: (s.mnemonic as string) ?? env["SESSION_MNEMONIC"],
    displayName: (s.displayName as string) ?? env["SESSION_DISPLAY_NAME"] ?? "Missy",
    commandPrefix: (s.commandPrefix as string) ?? env["SESSION_COMMAND_PREFIX"] ?? "!M!",
    mentionOnly: typeof s.mentionOnly === "boolean" ? s.mentionOnly : true,
    respondToAllMessages: typeof s.respondToAllMessages === "boolean" ? s.respondToAllMessages : false,
    maxMessageLength: typeof s.maxMessageLength === "number" ? s.maxMessageLength : 0,
    includeReplyContext: typeof s.includeReplyContext === "boolean" ? s.includeReplyContext : true,
    includeChannelContext: typeof s.includeChannelContext === "boolean" ? s.includeChannelContext : true,
    channelContextCount: typeof s.channelContextCount === "number" ? s.channelContextCount : 10,
    multiMessageDelimiter: (s.multiMessageDelimiter as string) ?? env["SESSION_MULTI_MESSAGE_DELIMITER"] ?? "|||",
    multiMessageDelayMs: typeof s.multiMessageDelayMs === "number" ? s.multiMessageDelayMs : 1500,
    autoAcceptRequests: typeof s.autoAcceptRequests === "boolean" ? s.autoAcceptRequests : true,
  };
}

// ─── Platform ─────────────────────────────────────────────────────────────────

class SessionPlatform implements AgentPlatform {
  readonly name = "session";

  getSystemContext(): string {
    const identityLine = this.#botSessionId
      ? `  <your_session_id>${this.#botSessionId}</your_session_id>\n`
      : "";
    return [
      "<platform>",
      "  <name>Session</name>",
      "  <description>You are communicating through Session, a fully decentralized messenger. Messages are end-to-end encrypted and onion-routed through the Oxen Service Node network. No phone number or email is required — users are identified by 66-character Session IDs (starting with 05).</description>",
      identityLine +
      "  <capabilities>",
      "    <capability>Direct messages and closed groups (up to 100 members)</capability>",
      "    <capability>Emoji reactions on messages</capability>",
      "    <capability>Typing indicators</capability>",
      "    <capability>File and image attachments</capability>",
      "    <capability>Message replies (quote context)</capability>",
      "    <capability>Read receipts</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">~4000 characters per message</limit>",
      "    <limit name=\"attachment_size\">~10 MB per file</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In groups, you only respond when directly mentioned by name or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  // Session.js classes are loaded dynamically to avoid Deno runtime
  // issues with extensionless imports in transitive deps (signal-bindings).
  #SessionClass?: new () => SessionInstance;
  #PollerClass?: new () => PollerInstance;
  #readyFn?: Promise<unknown>;
  #session?: SessionInstance;
  #poller?: PollerInstance;
  #context?: AgentContext;
  #sessionConfig?: SessionPlatformConfig;
  #botSessionId?: string;
  #startedAt = 0;
  #sessionIds = new Map<string, string>();
  #sessionStartedAt = new Map<string, number>();
  #conversationContext = new Map<string, ConversationMessage[]>();
  #seenMessageIds = new Set<string>();
  #displayNameCache = new Map<string, string>();
  #acceptedConversations = new Set<string>();
  /** Track sent messages so they can be deleted later. key = messageHash */
  #sentMessages = new Map<string, { to: string; timestamp: number }>();
  #started = false;

  async start(context: AgentContext): Promise<void> {
    this.#context = context;
    this.#sessionConfig = parseSessionConfig(context.config);

    // Dynamically import Session.js — avoids Deno crashing on
    // extensionless imports in the transitive @session.js/types dep.
    context.logger.info("Loading Session.js client...");
    const sessionMod = await import("@session.js/client");
    this.#SessionClass = sessionMod.Session;
    this.#PollerClass = sessionMod.Poller;
    this.#readyFn = sessionMod.ready;

    // Resolve mnemonic: config → keystore → generate fresh
    const mnemonic = await this.#resolveMnemonic();
    this.#startedAt = Date.now();
    this.#loadSessions();

    context.logger.info("Initializing Session.js WASM runtime...");
    await this.#readyFn;
    context.logger.info("Session.js WASM runtime ready");

    const displayName = this.#sessionConfig?.displayName || "Missy";

    const SessionCtor = this.#SessionClass;
    this.#session = new SessionCtor();
    this.#session.setMnemonic(mnemonic, displayName);

    // Derive the bot's Session ID from the mnemonic
    // The Session ID is the hex-encoded public key prefixed with "05"
    this.#botSessionId = await this.#resolveSelfId();

    context.logger.info(
      `Session bot identity: ${this.#botSessionId}`,
    );

    // Generate a QR code so users can scan to start a conversation
    await this.#printQrCode(context);

    // Start polling for messages
    const PollerCtor = this.#PollerClass!;
    this.#poller = new PollerCtor();
    this.#session.addPoller(this.#poller);

    // Register message handler
    this.#session.on("message", (msg: SessionMessage) => {
      this.#handleMessage(msg).catch((error) =>
        context.logger.error("Failed to handle Session message", error),
      );
    });

    // Register typing indicator handler
    this.#session.on("messageTypingIndicator", (ti: {
      isTyping: boolean;
      conversation: string;
    }) => {
      context.logger.debug(
        `Typing ${ti.isTyping ? "started" : "stopped"} in ${ti.conversation}`,
      );
    });

    // Register reaction handlers
    this.#session.on("reactionAdded", (r: {
      messageTimestamp: number;
      messageAuthor: string;
      reactionFrom: string;
      emoji: string;
    }) => {
      context.logger.debug(
        `${r.reactionFrom} reacted with ${r.emoji} to message by ${r.messageAuthor}`,
      );
    });

    this.#session.on("reactionRemoved", (r: {
      messageTimestamp: number;
      messageAuthor: string;
      reactionFrom: string;
      emoji: string;
    }) => {
      context.logger.debug(
        `${r.reactionFrom} removed reaction ${r.emoji}`,
      );
    });

    // Sync message handler (messages we sent from other devices)
    this.#session.on("syncMessage", (msg: { to: string; text?: string }) => {
      context.logger.debug(
        `Sync message to ${msg.to}: ${msg.text?.slice(0, 100) ?? "(no text)"}`,
      );
    });

    // Conversation request accepted (by the other party)
    this.#session.on("messageRequestApproved", (data: {
      profile: unknown;
      conversation: string;
    }) => {
      context.logger.info(
        `Conversation request approved by ${data.conversation}`,
      );
    });

    // Register platform service so plugins and tools can use Session APIs
    context.platformServices.register("session", {
      platformName: "session" as const,
      react: async (channelId, messageTimestamp, messageAuthor, emoji) => {
        await this.#session?.addReaction({ messageTimestamp, messageAuthor, emoji });
      },
      removeReaction: async (channelId, messageTimestamp, messageAuthor, emoji) => {
        await this.#session?.removeReaction({ messageTimestamp, messageAuthor, emoji });
      },
      deleteMessage: async (channelId, timestamp, hash) => {
        await this.#session?.deleteMessage({ to: channelId, timestamp, hash });
      },
    });

    // Capture session reference for tool closures
    const session = this.#session;

    // Register tools for the AI
    context.tools.register({
      name: "session.react",
      description: "Add an emoji reaction to a message on Session. Your own Session ID is in <your_session_id> in the platform context. Find the target message's timestamp and author from the reply_to block or conversation_context messages (each has a timestamp attribute and author id attribute). Input: {\"messageTimestamp\":1734567890,\"messageAuthor\":\"05...\",\"emoji\":\"👍\"}",
      inputSchema: {
        type: "object",
        properties: {
          messageTimestamp: { type: "number", description: "The timestamp of the message to react to (from the reply_to or conversation_context message's timestamp attribute)" },
          messageAuthor: { type: "string", description: "The Session ID of the message author (from the reply_to or conversation_context message's author id attribute)" },
          emoji: { type: "string", description: "A single emoji character" },
        },
        required: ["messageTimestamp", "messageAuthor", "emoji"],
      },
      async execute(input) {
        const p = parseReactionInput(input);
        await session?.addReaction({
          messageTimestamp: p.messageTimestamp,
          messageAuthor: p.messageAuthor,
          emoji: p.emoji,
        });
        return { ok: true, emoji: p.emoji };
      },
    });

    context.tools.register({
      name: "session.deleteMessage",
      description: "Delete a message Missy sent on Session. The message metadata (timestamp, hash) is needed. Input: {\"timestamp\":1234567890,\"hash\":\"...\"}",
      inputSchema: {
        type: "object",
        properties: {
          timestamp: { type: "number", description: "The timestamp of the message to delete" },
          hash: { type: "string", description: "The message hash of the message to delete" },
          channelId: { type: "string", description: "The conversation or group ID where the message was sent" },
        },
        required: ["timestamp", "hash", "channelId"],
      },
      async execute(input) {
        const p = parseDeleteInput(input);
        await session?.deleteMessage({ to: p.channelId, timestamp: p.timestamp, hash: p.hash });
        return { ok: true };
      },
    });

    this.#started = true;
    context.logger.info(
      `Session platform started as ${displayName} ` +
        `(${this.#botSessionId})`,
    );
  }

  async stop(): Promise<void> {
    this.#started = false;

    // Remove poller and clean up session
    if (this.#poller && this.#session) {
      try {
        // Session.js doesn't expose removePoller; the session just stops
        // processing when the process exits. The poller is tied to the
        // session lifecycle.
      } catch {
        // ignore
      }
    }

    this.#session = undefined;
    this.#poller = undefined;
    this.#botSessionId = undefined;
    this.#sessionIds.clear();
    this.#sessionStartedAt.clear();
    this.#conversationContext.clear();
    this.#seenMessageIds.clear();
    this.#displayNameCache.clear();
    this.#acceptedConversations.clear();
  }

  // ─── Identity resolution ─────────────────────────────────────────────────

  async #resolveMnemonic(): Promise<string> {
    const keystore = this.#context!.keystore.namespace("session");
    const logger = this.#context!.logger;

    // 1. Use explicitly configured mnemonic
    const configured = this.#sessionConfig?.mnemonic;
    if (configured) {
      logger.info("Using configured Session mnemonic");
      return configured;
    }

    // 2. Reuse a previously generated mnemonic
    const persisted = keystore.get<string>("mnemonic");
    if (persisted) {
      const words = persisted.trim().split(/\s+/);
      if (words.length === 13) {
        logger.info("Using persisted Session mnemonic from keystore");
        return persisted;
      }
      logger.warn(
        `Persisted mnemonic has ${words.length} words (expected 13). ` +
          "Discarding and generating a fresh one.",
      );
      await keystore.delete("mnemonic");
    }

    // 3. Generate a new random mnemonic and persist it
    logger.info("No Session mnemonic found — generating a new identity...");
    const { encode } = await import("@session.js/mnemonic");
    // 16 bytes (128 bits) → 13-word mnemonic (Session standard)
    const seedHex = randomHex(16);
    const mnemonic = encode(seedHex);
    await keystore.set("mnemonic", mnemonic);

    // Also write to config so it's visible and portable
    await persistConfigMnemonic(mnemonic, logger);
    logger.info(
      "Generated new Session identity! Mnemonic saved to keystore and config — " +
        "back up the mnemonic if you want to keep this identity.",
    );

    return mnemonic;
  }

  // ─── Self ID resolution ──────────────────────────────────────────────────

  async #resolveSelfId(): Promise<string> {
    try {
      return this.#session!.getSessionID();
    } catch (error) {
      this.#context?.logger.warn(
        "Could not resolve Session ID; will detect from first sync message",
        error,
      );
      return "05<detecting...>";
    }
  }

  // ─── Display name resolution ─────────────────────────────────────────────

  #resolveDisplayName(sessionId: string, profileName?: string): string {
    // Use profile-provided name first (from message author)
    if (profileName?.trim()) return profileName.trim();

    // Check cache
    const cached = this.#displayNameCache.get(sessionId);
    if (cached) return cached;

    // Fall back to truncated Session ID
    return sessionId.slice(0, 12);
  }

  // ─── QR code ─────────────────────────────────────────────────────────────

  async #printQrCode(context: AgentContext): Promise<void> {
    const sessionId = this.#botSessionId;
    if (!sessionId || sessionId.startsWith("05<detecting")) return;

    try {
      const QRCode = (await import("qrcode")).default;
      const ascii = await QRCode.toString(sessionId, {
        type: "terminal",
        small: true,
      });
      // Print directly to stdout so it's always visible, not just in logs
      console.log(`\nScan this QR code to start a Session conversation with Missy:\n`);
      console.log(ascii);
      console.log(`Session ID: ${sessionId}\n`);

      // Also save a PNG for sharing
      const qrPng = await QRCode.toBuffer(sessionId, {
        type: "png",
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      mkdirSync("data", { recursive: true });
      writeFileSync("data/session-qr.png", qrPng);
      context.logger.info("QR code PNG saved to data/session-qr.png");
    } catch (error) {
      context.logger.warn("Failed to generate Session QR code", error);
    }
  }

  // ─── Message handling ───────────────────────────────────────────────────

  async #handleMessage(msg: SessionMessage): Promise<void> {
    if (!this.#context || !this.#started) return;

    // Deduplicate
    if (msg.id && this.#seenMessageIds.has(msg.id)) return;
    if (msg.id) this.#rememberSeenMessageId(msg.id);

    // Skip messages before startup (with grace window)
    if (msg.timestamp && msg.timestamp < this.#startedAt - 5000) return;

    const content = msg.text?.trim() ?? "";
    const attachments = sessionAttachments(msg);
    if (!content && attachments.length === 0) return;

    const isGroup = msg.type === "group" || Boolean(msg.groupId);
    const channelId = isGroup && msg.groupId
      ? msg.groupId
      : msg.from;
    const channelType = isGroup ? "group" : "dm";
    const guildId = isGroup && msg.groupId ? msg.groupId : undefined;

    // Resolve and cache display name
    const authorName = this.#resolveDisplayName(msg.from, msg.author?.displayName);
    if (
      msg.author?.displayName &&
      !this.#displayNameCache.has(msg.from)
    ) {
      this.#displayNameCache.set(msg.from, msg.author.displayName);
    }

    // Track conversation context
    this.#rememberChannelContext(channelId, {
      id: msg.id ?? `${msg.from}:${msg.timestamp}`,
      authorId: msg.from,
      authorName,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      isBot: msg.from === this.#botSessionId,
      timestamp: msg.timestamp,
    });

    // Ignore own messages (including sync messages)
    if (msg.from === this.#botSessionId) return;

    // Auto-accept conversation requests from new contacts.
    // This is needed for both DMs and groups — group members must have
    // their DM request accepted before group encryption keys can be exchanged.
    if (
      this.#sessionConfig.autoAcceptRequests &&
      !this.#acceptedConversations.has(msg.from)
    ) {
      this.#acceptedConversations.add(msg.from);
      this.#session?.acceptConversationRequest({ from: msg.from })
        .then(() =>
          this.#context?.logger.info(
            `Accepted conversation request from ${authorName} (${msg.from})`,
          )
        )
        .catch((error) =>
          this.#context?.logger.debug(
            `Conversation request already accepted or failed for ${msg.from}`,
            error,
          )
        );
    }

    // Determine if we should respond
    // Use the live display name from the Session instance (may differ from config
    // if changed via the name command), plus the bot's Session ID as fallback.
    const liveName = this.#session?.getDisplayName()
      || this.#sessionConfig.displayName
      || "Missy";
    const mentionNames = [liveName];
    if (this.#botSessionId) {
      mentionNames.push(this.#botSessionId);
    }
    const prefix = this.#sessionConfig.commandPrefix;
    const isPrefixCommand = prefix ? content.startsWith(prefix) : false;
    const mentioned = isGroup
      ? hasTextMention(content, mentionNames)
      : false;

    if (isGroup && !isPrefixCommand && !mentioned) {
      if (this.#sessionConfig.respondToAllMessages) {
        // respond anyway
      } else if (this.#sessionConfig.mentionOnly) {
        return;
      }
    }

    // Strip prefix and mention patterns
    let messageContent = content;
    if (isPrefixCommand) {
      messageContent = content.slice(prefix.length).trim();
    } else if (mentioned && isGroup) {
      messageContent = stripMention(content, mentionNames);
    }

    // Handle local commands
    if (
      await this.#handleLocalCommand(
        messageContent,
        channelId,
        msg.from,
        msg.timestamp,
        isGroup,
      )
    ) {
      return;
    }

    if (!messageContent) {
      await this.#sendReply(
        channelId,
        msg.from,
        "What do you need?",
        isGroup,
        msg,
      );
      return;
    }

    // Send typing indicator
    this.#session?.showTypingIndicator({
      conversation: channelId,
    }).catch(() => {});

    const typingTimer = setInterval(() => {
      this.#session?.showTypingIndicator({
        conversation: channelId,
      }).catch(() => {});
    }, 15_000);

    const inbound: InboundMessage = {
      id: msg.id ?? `${msg.from}:${msg.timestamp}`,
      platform: this.name,
      channelId,
      channelType,
      guildId,
      authorId: msg.from,
      authorName,
      content: messageContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      context: this.#getChannelContext(
        channelId,
        msg.id ?? `${msg.from}:${msg.timestamp}`,
      ),
      replyTo: await this.#buildReplyReference(msg),
      reply: async (replyContent) => {
        await this.#sendMultiMessageReply(
          channelId,
          msg.from,
          replyContent,
          isGroup,
          msg,
        );
      },
      timestamp: msg.timestamp,
    };

    try {
      await this.#context.handleMessage(inbound);
      // Mark as read (use channelId so this works for groups too)
      await this.#session?.markMessagesAsRead({
        from: channelId,
        messagesTimestamps: [msg.timestamp],
      }).catch(() => {});
    } finally {
      clearInterval(typingTimer);
      // Stop typing
      this.#session?.hideTypingIndicator({
        conversation: channelId,
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
      await this.#sendText(
        channelId,
        senderId,
        [
          "Commands:",
          "DMs: help, status, id, name <new-name>, accept, clear, memory, memory all, session, session new [name], delete, plugins, tools, or any message.",
          "Groups: mention Missy with help, status, id, clear, memory, session, leave, plugins, tools, or a message.",
        ].join("\n"),
        isGroup,
      );
      return true;
    }

    if (normalized === "status") {
      await this.#sendText(
        channelId,
        senderId,
        this.#formatStatus(),
        isGroup,
      );
      return true;
    }

    if (normalized === "id" || normalized === "qr" || normalized === "sessionid") {
      await this.#sendText(
        channelId,
        senderId,
        [
          `Session ID: ${this.#botSessionId}`,
          `QR code: data/session-qr.png`,
          `Display name: ${this.#sessionConfig?.displayName || "Missy"}`,
          "Share this ID or scan the QR code to start a conversation.",
        ].join("\n"),
        isGroup,
      );
      return true;
    }

    if (normalized === "name" || normalized === "setname") {
      const newName = args.join(" ").trim();
      if (!newName) {
        await this.#sendText(
          channelId,
          senderId,
          "Usage: name <new-display-name>",
          isGroup,
        );
        return true;
      }
      if (newName.length > 64) {
        await this.#sendText(
          channelId,
          senderId,
          "Display name must be 64 characters or fewer.",
          isGroup,
        );
        return true;
      }
      try {
        await this.#session!.setDisplayName(newName);
        await this.#sendText(
          channelId,
          senderId,
          `Display name changed to: ${newName}`,
          isGroup,
        );
      } catch (error) {
        await this.#sendText(
          channelId,
          senderId,
          `Failed to change display name: ${String(error)}`,
          isGroup,
        );
      }
      return true;
    }

    if (normalized === "accept") {
      try {
        await this.#session!.acceptConversationRequest({ from: senderId });
        this.#acceptedConversations.add(senderId);
        await this.#sendText(
          channelId,
          senderId,
          "Conversation request accepted.",
          isGroup,
        );
      } catch (error) {
        await this.#sendText(
          channelId,
          senderId,
          `Failed to accept: ${String(error)}`,
          isGroup,
        );
      }
      return true;
    }

    if (normalized === "clear" || normalized === "reset") {
      const session = await this.#startSession(channelId);
      await this.#sendText(
        channelId,
        senderId,
        `Context cleared. Started session ${session.id}.`,
        isGroup,
      );
      return true;
    }

    if (normalized === "leave") {
      if (!isGroup) {
        await this.#sendText(
          channelId,
          senderId,
          "You can only leave groups from within the group.",
          isGroup,
        );
        return true;
      }
      // Session.js doesn't expose a leaveGroup API directly.
      // Closed groups require members to be removed by an admin.
      await this.#sendText(
        channelId,
        senderId,
        "Session closed groups don't support self-leave via API. " +
          "An admin must remove members, or the group must be disbanded.",
        isGroup,
      );
      return true;
    }

    if (normalized === "delete" || normalized === "unsend") {
      // Find the replied-to message in our sent history by timestamp
      const replyTimestamp = msg.replyToMessage?.timestamp;
      if (replyTimestamp) {
        let deleted = false;
        for (const [hash, info] of this.#sentMessages) {
          if (info.timestamp === replyTimestamp) {
            try {
              await this.#session?.deleteMessage({
                to: info.to,
                timestamp: info.timestamp,
                hash,
              });
              this.#sentMessages.delete(hash);
              await this.#sendText(channelId, senderId, "Deleted.", isGroup);
              deleted = true;
            } catch (error) {
              await this.#sendText(channelId, senderId, `Failed to delete: ${String(error)}`, isGroup);
            }
            break;
          }
        }
        if (!deleted) {
          await this.#sendText(channelId, senderId, "Could not find that message in my sent history.", isGroup);
        }
      } else {
        await this.#sendText(channelId, senderId, "Reply to one of my messages with 'delete' to remove it. Or use the Session client to unsend.", isGroup);
      }
      return true;
    }

    if (normalized === "tools") {
      await this.#sendText(
        channelId,
        senderId,
        this.#formatTools(),
        isGroup,
      );
      return true;
    }

    if (normalized === "plugins") {
      await this.#sendText(
        channelId,
        senderId,
        this.#formatPlugins(),
        isGroup,
      );
      return true;
    }

    if (normalized === "session" || normalized === "sessions") {
      const action = args[0]?.toLowerCase();
      if (action === "new" || action === "start") {
        const session = await this.#startSession(
          channelId,
          args.slice(1).join(" "),
        );
        await this.#sendText(
          channelId,
          senderId,
          `Started session ${session.id}. Earlier context is now ignored.`,
          isGroup,
        );
        return true;
      }

      await this.#sendText(
        channelId,
        senderId,
        this.#formatSession(channelId),
        isGroup,
      );
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await this.#sendText(
        channelId,
        senderId,
        this.#formatMemory(senderId, args[0]?.toLowerCase() === "all"),
        isGroup,
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
      `Platform: Session (decentralized)`,
      `Session ID: ${this.#botSessionId}`,
      `Display name: ${this.#sessionConfig.displayName || "Missy"}`,
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled",
      "Group routing: direct mentions only",
      `Reply context: ${
        this.#sessionConfig.includeReplyContext
          ? "enabled"
          : "disabled"
      }`,
      `Channel context: ${
        this.#sessionConfig.includeChannelContext
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
    msg: SessionMessage,
  ): Promise<InboundMessage["replyTo"]> {
    if (!this.#sessionConfig?.includeReplyContext) return undefined;

    const replyTo = msg.replyToMessage;
    if (!replyTo) return undefined;

    return {
      id: String(replyTo.timestamp),
      authorId: replyTo.author,
      authorName: this.#resolveDisplayName(replyTo.author),
      content: replyTo.text ?? "",
      timestamp: replyTo.timestamp,
    };
  }

  // ─── Sending ─────────────────────────────────────────────────────────────

  async #sendMultiMessageReply(
    channelId: string,
    senderId: string,
    content: string,
    isGroup: boolean,
    originalMsg: SessionMessage,
  ): Promise<void> {
    const delimiter = this.#sessionConfig?.multiMessageDelimiter ??
      "|||";
    const delayMs = this.#sessionConfig?.multiMessageDelayMs ?? 1500;
    const parts = splitByDelimiter(content, delimiter);

    if (parts.length <= 1) {
      await this.#sendReply(
        channelId,
        senderId,
        content,
        isGroup,
        originalMsg,
      );
      return;
    }

    await this.#sendReply(
      channelId,
      senderId,
      parts[0],
      isGroup,
      originalMsg,
    );
    for (const part of parts.slice(1)) {
      await delay(delayMs);
      await this.#sendText(channelId, senderId, part, isGroup);
    }
  }

  async #sendReply(
    channelId: string,
    senderId: string,
    content: string,
    isGroup: boolean,
    originalMsg: SessionMessage,
  ): Promise<void> {
    const chunks = splitMessage(
      content,
      this.#sessionConfig?.maxMessageLength,
    );
    const [first = ""] = chunks;
    const to = isGroup ? channelId : senderId;

    // Build reply context from the original message
    const replyToMessage = {
      timestamp: originalMsg.timestamp,
      author: originalMsg.from,
    };

    const sent = await this.#session?.sendMessage({
      to,
      text: first,
      replyToMessage,
    });
    if (sent) {
      this.#sentMessages.set(sent.messageHash, { to, timestamp: sent.timestamp });
    }

    for (const chunk of chunks.slice(1)) {
      await this.#sendText(channelId, senderId, chunk, isGroup);
    }
  }

  async #sendText(
    channelId: string,
    senderId: string,
    content: string,
    isGroup: boolean,
  ): Promise<void> {
    const to = isGroup ? channelId : senderId;
    for (
      const chunk of splitMessage(
        content,
        this.#sessionConfig?.maxMessageLength,
      )
    ) {
      const sent = await this.#session?.sendMessage({
        to,
        text: chunk,
      });
      if (sent) {
        this.#sentMessages.set(sent.messageHash, { to, timestamp: sent.timestamp });
      }
    }
  }

  // ─── Conversation context ────────────────────────────────────────────────

  #rememberChannelContext(
    channelId: string,
    message: ConversationMessage,
  ): void {
    const limit = Math.max(
      (this.#sessionConfig?.channelContextCount ?? 10) * 2,
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
    if (!this.#sessionConfig?.includeChannelContext) return undefined;

    const limit = this.#sessionConfig.channelContextCount;
    if (limit <= 0) return undefined;

    const buffer = this.#conversationContext.get(channelId) ?? [];
    return buffer
      .filter((message) =>
        message.id !== currentMessageId &&
        !message.id.startsWith("session-sep-")
      )
      .slice(-limit);
  }

  #rememberSeenMessageId(id: string): void {
    this.#seenMessageIds.add(id);
    if (this.#seenMessageIds.size > 5000) {
      this.#seenMessageIds = new Set([...this.#seenMessageIds].slice(-2500));
    }
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  #loadSessions(): void {
    if (!this.#context) return;

    const stored = this.#context.keystore.namespace("session").get("sessions");
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

    await this.#context.keystore.namespace("session").set(
      "sessions",
      sessions,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasTextMention(
  content: string,
  names: string[],
): boolean {
  const patterns = mentionPatterns(names);
  if (patterns.length === 0) return false;
  const lower = content.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function stripMention(
  content: string,
  names: string[],
): string {
  let result = content;
  for (const pattern of mentionPatterns(names)) {
    const index = result.toLowerCase().indexOf(pattern);
    if (index !== -1) {
      result = result.slice(0, index) + result.slice(index + pattern.length);
    }
  }
  return result.trim().replace(/^[,:;.!?\s]+/, "").trim();
}

/** Build mention patterns from a list of names — each name generates `@name` and `name`. */
function mentionPatterns(names: string[]): string[] {
  const patterns: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const lower = name.toLowerCase();
    patterns.push(`@${lower}`);
    patterns.push(lower);
  }
  return patterns;
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

function sessionAttachments(msg: SessionMessage): MessageAttachment[] {
  return (msg.attachments ?? []).map((a) => ({
    id: a.id,
    contentType: a.metadata?.contentType,
    name: a.name,
    size: a.size,
    width: a.metadata?.width,
    height: a.metadata?.height,
    caption: a.caption,
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function persistConfigMnemonic(
  mnemonic: string,
  logger: AgentContext["logger"],
): Promise<void> {
  const configPath = "missy.config.json";
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // file doesn't exist yet — start fresh
    }
    config["session.mnemonic"] = mnemonic;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    logger.info(`Mnemonic written to ${configPath} (session.mnemonic)`);
  } catch (error) {
    logger.warn(
      `Could not persist mnemonic to ${configPath}: ${String(error)}`,
    );
  }
}

function parseReactionInput(input: unknown): {
  messageTimestamp: number;
  messageAuthor: string;
  emoji: string;
} {
  if (!isRecord(input)) {
    throw new Error('session.react expects an object with messageTimestamp, messageAuthor, and emoji.');
  }
  const ts = input.messageTimestamp;
  const author = input.messageAuthor;
  const emoji = input.emoji;
  if (typeof ts !== "number" || typeof author !== "string" || typeof emoji !== "string") {
    throw new Error('session.react requires messageTimestamp (number), messageAuthor (string), and emoji (string).');
  }
  return { messageTimestamp: ts, messageAuthor: author, emoji: emoji.trim() };
}

function parseDeleteInput(input: unknown): {
  timestamp: number;
  hash: string;
  channelId: string;
} {
  if (!isRecord(input)) {
    throw new Error('session.deleteMessage expects an object with timestamp, hash, and channelId.');
  }
  const ts = input.timestamp;
  const hash = input.hash;
  const channelId = input.channelId;
  if (typeof ts !== "number" || typeof hash !== "string" || typeof channelId !== "string") {
    throw new Error('session.deleteMessage requires timestamp (number), hash (string), and channelId (string).');
  }
  return { timestamp: ts, hash: hash, channelId };
}

// ─── Module export ────────────────────────────────────────────────────────────

const module: PlatformModule = {
  metadata: {
    name: "session",
    description:
      "Session messenger platform adapter backed by @session.js/client. Fully decentralized — no servers required.",
    version: "0.1.0",
  },
  configSchema: {
    module: "session",
    label: "Session Platform",
    fields: [
      {
        key: "session.mnemonic",
        label: "Session Mnemonic",
        description:
          "13-word mnemonic seed phrase for your Session bot account. If omitted, a new random identity is generated and persisted automatically.",
        type: "string",
        required: false,
        secret: true,
      },
      {
        key: "session.displayName",
        label: "Session Display Name",
        description: "Display name for the bot on the Session network",
        type: "string",
        required: false,
        default: "Missy",
      },
      {
        key: "session.commandPrefix",
        label: "Command Prefix",
        description: "Prefix for text commands",
        type: "string",
        required: false,
        default: "!M!",
      },
      {
        key: "session.mentionOnly",
        label: "Mention Only",
        description: "Only respond in groups when mentioned",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.respondToAllMessages",
        label: "Respond to All Messages",
        description: "Respond to every message in Session groups",
        type: "boolean",
        required: false,
        default: false,
        hidden: true,
      },
      {
        key: "session.maxMessageLength",
        label: "Max Message Length",
        description: "Maximum characters per Session message",
        type: "number",
        required: false,
        default: 0,
        hidden: true,
      },
      {
        key: "session.includeReplyContext",
        label: "Include Reply Context",
        description:
          "Include the quoted message when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.includeChannelContext",
        label: "Include Channel Context",
        description:
          "Include recent conversation when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.channelContextCount",
        label: "Channel Context Count",
        description:
          "Number of recent messages to include as conversation context",
        type: "number",
        required: false,
        default: 10,
        hidden: true,
      },
      {
        key: "session.multiMessageDelimiter",
        label: "Multi-Message Delimiter",
        description:
          "Delimiter used to split long responses into multiple messages",
        type: "string",
        required: false,
        default: "|||",
        hidden: true,
      },
      {
        key: "session.multiMessageDelayMs",
        label: "Multi-Message Delay",
        description: "Delay in milliseconds between multi-message parts",
        type: "number",
        required: false,
        default: 1500,
        hidden: true,
      },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new SessionPlatform(),
};

export default module;
