import {
  AutojoinRoomsMixin,
  MatrixAuth,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
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

const STORAGE_DIR = path.join("data", "matrix");

interface MatrixPlatformConfig {
  homeserverUrl?: string;
  accessToken?: string;
  username?: string;
  password?: string;
  userId?: string;
  deviceId?: string;
  recoveryKey?: string;
  restoreKeyBackup: boolean;
  verifyDevice: boolean;
  deviceDisplayName: string;
  roomIds: string[];
  mentionOnly: boolean;
  commandPrefix: string;
  displayName: string;
  maxMessageLength: number;
  respondToAllMessages: boolean;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
  autoJoinInvites: boolean;
}

function parseMatrixConfig(config: AppConfig): MatrixPlatformConfig {
  const m = (config.data.matrix ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  const str = (key: string, envKey: string, fallback: string): string =>
    (m[key] as string) ?? env[envKey] ?? fallback;
  const optStr = (key: string, envKey: string): string | undefined =>
    (m[key] as string) ?? env[envKey];
  const bool = (key: string, envKey: string, fallback: boolean): boolean => {
    const v = m[key];
    if (typeof v === "boolean") return v;
    const ev = env[envKey];
    if (ev !== undefined) return ["1", "true", "yes", "on"].includes(ev.toLowerCase());
    return fallback;
  };
  const list = (key: string, envKey: string): string[] => {
    const v = m[key];
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
    const ev = env[envKey];
    return ev ? ev.split(",").map(s => s.trim()).filter(Boolean) : [];
  };

  return {
    homeserverUrl: optStr("homeserverUrl", "MATRIX_HOMESERVER_URL"),
    accessToken: optStr("accessToken", "MATRIX_ACCESS_TOKEN"),
    username: optStr("username", "MATRIX_USERNAME"),
    password: optStr("password", "MATRIX_PASSWORD"),
    userId: optStr("userId", "MATRIX_USER_ID"),
    deviceId: optStr("deviceId", "MATRIX_DEVICE_ID"),
    recoveryKey: optStr("recoveryKey", "MATRIX_RECOVERY_KEY"),
    restoreKeyBackup: bool("restoreKeyBackup", "MATRIX_RESTORE_KEY_BACKUP", true),
    verifyDevice: bool("verifyDevice", "MATRIX_VERIFY_DEVICE", true),
    deviceDisplayName: str("deviceDisplayName", "MATRIX_DEVICE_DISPLAY_NAME", "Missy Bot"),
    roomIds: list("roomIds", "MATRIX_ROOM_IDS"),
    mentionOnly: bool("mentionOnly", "MATRIX_MENTION_ONLY", true),
    commandPrefix: str("commandPrefix", "MATRIX_COMMAND_PREFIX", "!M!"),
    displayName: str("displayName", "MATRIX_DISPLAY_NAME", "Missy"),
    maxMessageLength: typeof m.maxMessageLength === "number" ? m.maxMessageLength : 0,
    respondToAllMessages: bool("respondToAllMessages", "MATRIX_RESPOND_TO_ALL_MESSAGES", false),
    includeReplyContext: bool("includeReplyContext", "MATRIX_INCLUDE_REPLY_CONTEXT", true),
    includeChannelContext: bool("includeChannelContext", "MATRIX_INCLUDE_CHANNEL_CONTEXT", true),
    channelContextCount: typeof m.channelContextCount === "number" ? m.channelContextCount : 10,
    multiMessageDelimiter: str("multiMessageDelimiter", "MATRIX_MULTI_MESSAGE_DELIMITER", "|||"),
    multiMessageDelayMs: typeof m.multiMessageDelayMs === "number" ? m.multiMessageDelayMs : 1500,
    autoJoinInvites: bool("autoJoinInvites", "MATRIX_AUTO_JOIN_INVITES", true),
  };
}

/**
 * Known verification-related to-device event types.
 * When the bot receives one of these, it logs it so the operator can act.
 */
const VERIFICATION_EVENT_TYPES = new Set([
  "m.key.verification.request",
  "m.key.verification.ready",
  "m.key.verification.start",
  "m.key.verification.accept",
  "m.key.verification.key",
  "m.key.verification.mac",
  "m.key.verification.cancel",
  "m.key.verification.done",
]);

type MatrixEventContent = Record<string, unknown>;

interface RawMatrixEvent {
  event_id: string;
  sender: string;
  type: string;
  origin_server_ts: number;
  content: MatrixEventContent;
}

class MatrixPlatform implements AgentPlatform {
  readonly name = "matrix";

  getSystemContext(): string {
    return [
      "<platform>",
      "  <name>Matrix</name>",
      "  <description>You are communicating through Matrix, an open federated messaging protocol. Rooms can span multiple homeservers.</description>",
      "  <capabilities>",
      "    <capability>Direct rooms and group rooms</capability>",
      "    <capability>End-to-end encryption (Olm/Megolm)</capability>",
      "    <capability>Device verification (SAS)</capability>",
      "    <capability>Message replies and reactions</capability>",
      "    <capability>File attachments</capability>",
      "    <capability>Typing indicators and read receipts</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">~4000 characters per message</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In rooms, you only respond when @mentioned or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  #client?: MatrixClient;
  #context?: AgentContext;
  #matrixConfig?: MatrixPlatformConfig;
  #botUserId?: string;
  #startedAt = 0;
  #roomSessionIds = new Map<string, string>();
  #roomSessionStartedAt = new Map<string, number>();
  #seenEventIds = new Set<string>();
  #directRoomCache = new Map<string, boolean>();
  #roomContext = new Map<string, ConversationMessage[]>();
  #displayNameCache = new Map<string, string | undefined>();

  async start(context: AgentContext): Promise<void> {
    const config = parseMatrixConfig(context.config);
    this.#matrixConfig = config;
    if (!config.homeserverUrl) {
      throw new Error(
        "MATRIX_HOMESERVER_URL is required when the matrix platform is enabled.",
      );
    }
    if (!canAuthenticateMatrix(config)) {
      throw new Error(
        "Matrix requires either MATRIX_ACCESS_TOKEN, or MATRIX_USERNAME plus MATRIX_PASSWORD.",
      );
    }

    this.#context = context;
    this.#startedAt = Date.now();
    this.#loadSessions();

    const session = await resolveMatrixSession(context, config);
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const storage = new SimpleFsStorageProvider(
      path.join(STORAGE_DIR, "bot-storage.json"),
    );
    const cryptoStore = new RustSdkCryptoStorageProvider(
      path.join(STORAGE_DIR, "crypto"),
      StoreType.Sqlite,
    );

    const client = new MatrixClient(
      config.homeserverUrl,
      session.accessToken,
      storage,
      cryptoStore,
    );
    this.#client = client;

    // Intercept to-device events before they reach the crypto engine so we
    // can log verification requests. The SDK doesn't emit these as events.
    //
    // IMPORTANT: incoming to-device events from other users are Olm-encrypted
    // (type "m.room.encrypted"). The inner event type (e.g.
    // "m.key.verification.request") is only visible AFTER the OlmMachine
    // decrypts it. We also listen for "to_device.decrypted" below to catch
    // those.
    const originalUpdateSyncData = client.crypto.updateSyncData.bind(
      client.crypto,
    );
    client.crypto.updateSyncData = async function (
      toDeviceMessages: unknown[],
      otkCounts: Record<string, number>,
      unusedFallbackKeyAlgs: string[],
      changedDeviceLists: string[],
      leftDeviceLists: string[],
    ): Promise<void> {
      if (Array.isArray(toDeviceMessages) && toDeviceMessages.length > 0) {
        for (const msg of toDeviceMessages) {
          if (msg && typeof msg === "object") {
            const m = msg as Record<string, unknown>;
            const msgType = m.type ?? "";
            // Log any verification-related to-device events (catches
            // outgoing/cleartext ones sent via sendToDevices).
            if (VERIFICATION_EVENT_TYPES.has(String(msgType))) {
              context.logger.info(
                `To-device verification event: ${msgType} from ${
                  m.sender ?? "?"
                }`,
                {
                  type: msgType,
                  sender: m.sender,
                  transaction_id: (m.content as Record<string, unknown>)
                    ?.transaction_id,
                },
              );
            } else {
              // Log encrypted to-device events at debug level so we can
              // confirm Element's verification request is arriving.
              context.logger.debug(
                `To-device event: ${msgType} from ${m.sender ?? "?"}`,
                {
                  type: msgType,
                  sender: m.sender,
                  hasOlmCiphertext: msgType === "m.room.encrypted",
                },
              );
            }
          }
        }
      }
      return originalUpdateSyncData(
        toDeviceMessages,
        otkCounts,
        unusedFallbackKeyAlgs,
        changedDeviceLists,
        leftDeviceLists,
      );
    };

    // The SDK emits "to_device.decrypted" after the OlmMachine decrypts an
    // incoming to-device message. Verification events from other users
    // (e.g. m.key.verification.request) surface here.
    client.on(
      "to_device.decrypted",
      (msg: Record<string, unknown>) => {
        const msgType = msg.type ?? "";
        if (VERIFICATION_EVENT_TYPES.has(String(msgType))) {
          context.logger.info(
            `Decrypted to-device verification event: ${msgType} from ${
              msg.sender ?? "?"
            }`,
            {
              type: msgType,
              sender: msg.sender,
              transaction_id: (msg.content as Record<string, unknown>)
                ?.transaction_id,
            },
          );
        } else {
          context.logger.debug(
            `Decrypted to-device event: ${msgType} from ${msg.sender ?? "?"}`,
          );
        }
      },
    );

    if (config.autoJoinInvites) {
      AutojoinRoomsMixin.setupOnClient(client);
    }

    // Explicit invite handler with logging so we can observe invite flow.
    // AutojoinRoomsMixin is still registered above as a fallback.
    client.on("room.invite", (roomId: string, inviteEvent: RawMatrixEvent) => {
      context.logger.info(`Matrix room invite received`, {
        roomId,
        inviter: inviteEvent.sender,
        eventId: inviteEvent.event_id,
      });
      client.joinRoom(roomId)
        .then(() => {
          context.logger.info(`Joined Matrix room via invite`, {
            roomId,
            inviter: inviteEvent.sender,
          });
        })
        .catch((error) => {
          context.logger.error(
            `Failed to join Matrix room after invite: ${roomId}`,
            error,
          );
        });
    });

    client.on("room.join", (roomId: string) => {
      context.logger.info(`Matrix room join detected`, { roomId });
    });

    client.on("room.message", (roomId: string, event: RawMatrixEvent) => {
      this.#handleRoomMessage(roomId, event).catch((error) =>
        context.logger.error("Failed to handle Matrix message", error)
      );
    });
    client.on(
      "room.failed_decryption",
      (roomId: string, event: RawMatrixEvent, error: Error) => {
        context.logger.warn("Matrix event failed to decrypt", {
          roomId,
          eventId: event.event_id,
          senderId: event.sender,
          error: error.message,
        });
      },
    );

    this.#botUserId = await client.getUserId();

    for (const roomIdOrAlias of config.roomIds) {
      try {
        const roomId = await client.resolveRoom(roomIdOrAlias);
        await client.joinRoom(roomId);
      } catch (error) {
        context.logger.warn(
          `Failed to join Matrix room ${roomIdOrAlias}`,
          error,
        );
      }
    }

    await client.start();

    context.logger.info(`Matrix logged in as ${this.#botUserId}`, {
      managedDevice: session.managedDevice,
      cryptoStore: path.join(STORAGE_DIR, "crypto"),
    });

    if (config.verifyDevice !== false) {
      context.logger.warn(
        "Matrix device is NOT verified. Any verification requests will be " +
          "logged so you can see when someone tries to verify this device. " +
          "To verify, have your other Matrix session send a verification " +
          "request to this device (right-click → Verify in Element).",
      );
    }
  }

  async stop(): Promise<void> {
    this.#client?.stop();
    this.#client = undefined;
    this.#botUserId = undefined;
    this.#roomSessionIds.clear();
    this.#roomSessionStartedAt.clear();
    this.#seenEventIds.clear();
    this.#directRoomCache.clear();
    this.#roomContext.clear();
    this.#displayNameCache.clear();
  }

  async #handleRoomMessage(
    roomId: string,
    event: RawMatrixEvent,
  ): Promise<void> {
    if (!this.#context || !this.#client) {
      return;
    }

    const eventId = event.event_id;
    if (!eventId || this.#seenEventIds.has(eventId)) {
      return;
    }
    this.#rememberSeenEventId(eventId);

    if (event.origin_server_ts < this.#startedAt - 5000) {
      return;
    }

    const content = event.content ?? {};
    const msgtype = content.msgtype;
    const body = typeof content.body === "string" ? content.body.trim() : "";
    const attachments = matrixAttachments(content, this.#matrixConfig?.homeserverUrl);

    // Skip messages that have no text and no attachments
    if (!body && attachments.length === 0) {
      return;
    }

    // Build a display-friendly content for non-text messages
    const displayContent = body || matrixAttachmentSummary(msgtype, attachments);

    this.#rememberRoomContext(roomId, {
      id: eventId,
      authorId: event.sender,
      authorName: await this.#resolveDisplayName(event.sender),
      content: displayContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      isBot: event.sender === this.#botUserId,
      timestamp: event.origin_server_ts,
    });

    if (!event.sender || event.sender === this.#botUserId) {
      return;
    }

    const prefix = this.#matrixConfig.commandPrefix;
    const addressing = parseMatrixAddressing({
      body: body || displayContent,
      content,
      botUserId: this.#botUserId,
      displayName: this.#matrixConfig.displayName,
      prefix,
    });
    const isPrefixCommand = addressing.isPrefixCommand;
    const mentioned = addressing.mentioned;
    const isDirectRoom = await this.#isDirectRoom(roomId);

    if (!isDirectRoom && !mentioned && !isPrefixCommand) {
      return;
    }

    const shouldStripMentionedPrefix = prefix &&
      (mentioned || isDirectRoom) &&
      !isPrefixCommand &&
      addressing.content.startsWith(prefix);
    const messageContent = shouldStripMentionedPrefix
      ? addressing.content.slice(prefix.length).trim()
      : addressing.content;

    if (await this.#handleLocalCommand(messageContent, roomId, event)) {
      return;
    }

    // Allow attachment-only messages through
    if (!messageContent && attachments.length === 0) {
      await this.#sendReply(roomId, event, "What do you need?");
      return;
    }

    const effectiveContent = messageContent || displayContent;

    const typing = this.#startTyping(roomId);
    const inbound: InboundMessage = {
      id: eventId,
      platform: this.name,
      channelId: roomId,
      channelType: isDirectRoom ? "dm" : "room",
      guildId: roomId,
      authorId: event.sender,
      authorName: await this.#resolveDisplayName(event.sender),
      content: effectiveContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      context: this.#fetchChannelContext(roomId, eventId),
      replyTo: await this.#buildReplyReference(roomId, content),
      reply: async (replyContent) => {
        await this.#sendMultiMessageReply(roomId, event, replyContent);
      },
      timestamp: event.origin_server_ts,
    };

    try {
      await this.#context.handleMessage(inbound);
      await this.#client.sendReadReceipt(roomId, eventId).catch((error) =>
        this.#context?.logger.warn("Failed to send Matrix read receipt", error)
      );
    } finally {
      typing.stop();
    }
  }

  async #isDirectRoom(roomId: string): Promise<boolean> {
    const cached = this.#directRoomCache.get(roomId);
    if (cached !== undefined) {
      return cached;
    }

    let isDirect = false;
    try {
      const direct = await this.#client?.getAccountData<
        Record<string, string[]>
      >("m.direct");
      if (direct) {
        isDirect = Object.values(direct).some((roomIds) =>
          Array.isArray(roomIds) && roomIds.includes(roomId)
        );
      }
    } catch {
      // m.direct account data may not exist; fall through to state checks.
    }

    if (!isDirect && this.#client) {
      try {
        const state = await this.#client.getRoomState(roomId);
        const memberEvents = state.filter((event) =>
          event.type === "m.room.member"
        );
        const hasDirectFlag = memberEvents.some((event) =>
          event.content?.is_direct === true
        );
        const joinedCount = memberEvents.filter((event) =>
          event.content?.membership === "join"
        ).length;
        const hasRoomName = state.some((event) =>
          event.type === "m.room.name" &&
          typeof event.content?.name === "string" &&
          event.content.name.length > 0
        );

        isDirect = hasDirectFlag || (joinedCount <= 2 && !hasRoomName);
      } catch {
        isDirect = false;
      }
    }

    this.#directRoomCache.set(roomId, isDirect);
    return isDirect;
  }

  async #resolveDisplayName(userId: string): Promise<string | undefined> {
    if (this.#displayNameCache.has(userId)) {
      return this.#displayNameCache.get(userId);
    }

    let name: string | undefined;
    try {
      const profile = await this.#client?.getUserProfile(userId);
      name = typeof profile?.displayname === "string"
        ? profile.displayname
        : undefined;
    } catch {
      name = undefined;
    }

    this.#displayNameCache.set(userId, name);
    if (this.#displayNameCache.size > 1000) {
      this.#displayNameCache.clear();
    }
    return name;
  }

  #rememberRoomContext(roomId: string, message: ConversationMessage): void {
    const limit = Math.max(
      (this.#matrixConfig?.channelContextCount ?? 10) * 2,
      50,
    );
    const buffer = this.#roomContext.get(roomId) ?? [];
    buffer.push(message);
    if (buffer.length > limit) {
      buffer.splice(0, buffer.length - limit);
    }
    this.#roomContext.set(roomId, buffer);
  }

  #fetchChannelContext(
    roomId: string,
    currentEventId: string,
  ): ConversationMessage[] | undefined {
    if (!this.#matrixConfig?.includeChannelContext) {
      return undefined;
    }

    const limit = this.#matrixConfig.channelContextCount;
    if (limit <= 0) {
      return undefined;
    }

    const buffer = this.#roomContext.get(roomId) ?? [];
    return buffer
      .filter((message) =>
        message.id !== currentEventId &&
        !message.id.startsWith("session-sep-")
      )
      .slice(-limit);
  }

  async #buildReplyReference(
    roomId: string,
    content: MatrixEventContent,
  ): Promise<InboundMessage["replyTo"]> {
    if (!this.#matrixConfig?.includeReplyContext || !this.#client) {
      return undefined;
    }

    const relatesTo = content["m.relates_to"];
    const replyEventId = isRecord(relatesTo) &&
        isRecord(relatesTo["m.in_reply_to"]) &&
        typeof relatesTo["m.in_reply_to"].event_id === "string"
      ? relatesTo["m.in_reply_to"].event_id
      : undefined;
    if (!replyEventId) {
      return undefined;
    }

    return await this.#walkReplyChain(roomId, replyEventId, 5);
  }

  /**
   * Walk the Matrix reply chain backwards, building a nested replyTo structure.
   * Each level fetches the parent event via getEvent; if that event is itself
   * a reply (has m.in_reply_to), the chain continues up to maxDepth levels.
   */
  async #walkReplyChain(
    roomId: string,
    eventId: string,
    maxDepth: number,
  ): Promise<InboundMessage["replyTo"]> {
    try {
      const event = await this.#client?.getEvent(roomId, eventId);
      if (!event) return undefined;

      const eventContent = event.content ?? {};
      const body = typeof eventContent.body === "string" ? eventContent.body : "";
      const author = event.sender ?? "";

      const ref: InboundMessage["replyTo"] = {
        id: eventId,
        authorId: author,
        authorName: author ? await this.#resolveDisplayName(author) : undefined,
        content: body,
        timestamp: event.origin_server_ts,
      };

      // Walk further up the chain if this event is also a reply
      if (maxDepth > 1) {
        const relatesTo = eventContent["m.relates_to"];
        const parentId = isRecord(relatesTo) &&
            isRecord(relatesTo["m.in_reply_to"]) &&
            typeof relatesTo["m.in_reply_to"].event_id === "string"
          ? relatesTo["m.in_reply_to"].event_id
          : undefined;
        if (parentId) {
          ref.replyTo = await this.#walkReplyChain(roomId, parentId, maxDepth - 1);
        }
      }

      return ref;
    } catch {
      return undefined;
    }
  }

  #rememberSeenEventId(eventId: string): void {
    this.#seenEventIds.add(eventId);
    if (this.#seenEventIds.size > 5000) {
      this.#seenEventIds = new Set([...this.#seenEventIds].slice(-2500));
    }
  }

  #loadSessions(): void {
    if (!this.#context) {
      return;
    }

    const stored = this.#context.keystore.namespace("matrix").get(
      "roomSessions",
    );
    if (!isRecord(stored)) {
      return;
    }

    for (const [roomId, session] of Object.entries(stored)) {
      if (!isRecord(session)) {
        continue;
      }

      const id = typeof session.id === "string" ? session.id : undefined;
      const startedAt = typeof session.startedAt === "number"
        ? session.startedAt
        : undefined;
      if (!id || !startedAt) {
        continue;
      }

      this.#roomSessionIds.set(roomId, id);
      this.#roomSessionStartedAt.set(roomId, startedAt);
    }
  }

  async #startRoomSession(roomId: string, requestedName?: string): Promise<{
    id: string;
    startedAt: number;
  }> {
    const startedAt = Date.now();
    const id = normalizeSessionName(requestedName) ?? generateMatrixSessionId();
    this.#roomSessionIds.set(roomId, id);
    this.#roomSessionStartedAt.set(roomId, startedAt);
    // Seed the context buffer with a separator so the AI sees the session boundary
    this.#roomContext.set(roomId, [{
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
    if (!this.#context) {
      return;
    }

    const sessions: Record<string, { id: string; startedAt: number }> = {};
    for (const [roomId, id] of this.#roomSessionIds) {
      const startedAt = this.#roomSessionStartedAt.get(roomId);
      if (startedAt) {
        sessions[roomId] = { id, startedAt };
      }
    }

    await this.#context.keystore.namespace("matrix").set(
      "roomSessions",
      sessions,
    );
  }

  #formatRoomSession(roomId: string): string {
    const id = this.#roomSessionIds.get(roomId);
    const startedAt = this.#roomSessionStartedAt.get(roomId);
    if (!id || !startedAt) {
      return "Current session: default\nContext includes the configured live room history.";
    }

    return [
      `Current session: ${id}`,
      `Started: ${new Date(startedAt).toISOString()}`,
      "Context only includes room messages after this session started.",
    ].join("\n");
  }

  async #handleLocalCommand(
    content: string,
    roomId: string,
    event: RawMatrixEvent,
  ): Promise<boolean> {
    const [command = "", ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "verify") {
      const action = args[0]?.toLowerCase();
      if (action === "confirm") {
        await this.#handleVerifyConfirm(roomId, event);
        return true;
      }
      await this.#handleVerifyRequest(roomId, event);
      return true;
    }

    if (normalized === "help" || normalized === "commands") {
      await this.#sendReply(
        roomId,
        event,
        [
          "Commands:",
          "DMs: help, status, verify, verify confirm, memory, memory all, session, session new [name], context clear, plugins, tools, or any message.",
          "Rooms: mention Missy with help, status, memory, session, plugins, tools, or a message.",
        ].join("\n"),
      );
      return true;
    }

    if (normalized === "status") {
      await this.#sendReply(roomId, event, this.#formatStatus());
      return true;
    }

    if (normalized === "tools") {
      await this.#sendReply(roomId, event, this.#formatTools());
      return true;
    }

    if (normalized === "plugins") {
      await this.#sendReply(roomId, event, this.#formatPlugins());
      return true;
    }

    if (normalized === "session" || normalized === "sessions") {
      const action = args[0]?.toLowerCase();
      if (action === "new" || action === "start" || action === "clear") {
        const session = await this.#startRoomSession(
          roomId,
          args.slice(1).join(" "),
        );
        await this.#sendReply(
          roomId,
          event,
          `Started session ${session.id}. Earlier room context is now ignored.`,
        );
        return true;
      }

      await this.#sendReply(roomId, event, this.#formatRoomSession(roomId));
      return true;
    }

    if (
      (normalized === "context" &&
        ["clear", "reset", "new"].includes(args[0]?.toLowerCase() ?? "")) ||
      (normalized === "clear" &&
        ["context", "session"].includes(args[0]?.toLowerCase() ?? "")) ||
      (normalized === "new" && args[0]?.toLowerCase() === "session") ||
      normalized === "reset"
    ) {
      const session = await this.#startRoomSession(roomId);
      await this.#sendReply(
        roomId,
        event,
        `Context cleared. Started session ${session.id}.`,
      );
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await this.#sendReply(
        roomId,
        event,
        this.#formatMemory(event.sender, args[0]?.toLowerCase() === "all"),
      );
      return true;
    }

    return false;
  }

  #formatTools(): string {
    if (!this.#context) {
      return "Missy is not ready.";
    }

    const tools = this.#context.tools.list();
    if (tools.length === 0) {
      return "No tools are registered.";
    }

    return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join(
      "\n",
    );
  }

  #formatPlugins(): string {
    if (!this.#context) {
      return "Missy is not ready.";
    }

    if (this.#context.plugins.length === 0) {
      return "No plugins are loaded.";
    }

    return this.#context.plugins
      .map((plugin) =>
        `- ${plugin.name} v${plugin.version}: ${plugin.description}`
      )
      .join("\n");
  }

  #formatMemory(userId: string, includeAll: boolean): string {
    if (!this.#context) {
      return "Missy is not ready.";
    }

    if (!this.#context.config.memory.enabled) {
      return "Memory is disabled.";
    }

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

  /**
   * Send an m.key.verification.request to the user so they can verify this
   * device from their Element client.
   *
   * The OlmMachine inside the SDK's CryptoClient handles the full SAS
   * protocol (start, accept, key, MAC) automatically via receiveSyncChanges.
   * The user accepts the prompt in Element, compares emojis, and confirms.
   *
   * Note: the final cross-signing signature upload is blocked by the SDK
   * (RustEngine throws on SignatureUpload), so the device won't become
   * self-verified, but the remote user's client will see verification
   * as complete.
   */
  async #handleVerifyRequest(
    roomId: string,
    event: RawMatrixEvent,
  ): Promise<void> {
    if (!this.#client || !this.#botUserId) {
      await this.#sendReply(roomId, event, "Missy is not ready.");
      return;
    }

    const targetUserId = event.sender;
    if (!targetUserId) {
      await this.#sendReply(roomId, event, "Cannot identify your user.");
      return;
    }

    try {
      const txnId = `verify-${crypto.randomUUID()}`;
      await this.#client.sendToDevices(
        "m.key.verification.request",
        {
          [targetUserId]: {
            "*": {
              from_device: this.#botUserId,
              transaction_id: txnId,
              methods: ["m.sas.v1"],
              timestamp: Date.now(),
            },
          },
        },
      );
      await this.#sendReply(
        roomId,
        event,
        "Verification request sent. Check Element — accept the request, " +
          "compare the SAS emojis, and confirm. The bot handles the rest " +
          "automatically.",
      );
    } catch (error) {
      await this.#sendReply(
        roomId,
        event,
        `Failed to send verification request: ${String(error)}`,
      );
    }
  }

  /**
   * After the user has confirmed SAS emojis in Element, this checks the
   * device's verification state.
   */
  async #handleVerifyConfirm(
    roomId: string,
    event: RawMatrixEvent,
  ): Promise<void> {
    const recoveryKey = this.#matrixConfig?.recoveryKey;

    if (recoveryKey) {
      await this.#sendReply(
        roomId,
        event,
        "MATRIX_RECOVERY_KEY is set. Cross-signing will be attempted on " +
          "the next restart.",
      );
    } else {
      await this.#sendReply(
        roomId,
        event,
        "The SAS verification should be complete. If the emojis matched, " +
          "this device is now verified from your perspective. " +
          "To self-verify (cross-sign), set MATRIX_RECOVERY_KEY and restart.",
      );
    }
  }

  #formatStatus(): string {
    if (!this.#context) {
      return "Missy is not ready.";
    }

    return [
      "Missy is online.",
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled",
      "Room routing: direct mentions only",
      `Reply context: ${
        this.#matrixConfig.includeReplyContext ? "enabled" : "disabled"
      }`,
      `Auto-join invites: ${
        this.#matrixConfig.autoJoinInvites ? "enabled" : "disabled"
      }`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }

  async #sendMultiMessageReply(
    roomId: string,
    replyToEvent: RawMatrixEvent,
    content: string,
  ): Promise<void> {
    const delimiter = this.#matrixConfig?.multiMessageDelimiter ??
      "|||";
    const delayMs = this.#matrixConfig?.multiMessageDelayMs ?? 1500;
    const parts = splitByDelimiter(content, delimiter);

    if (parts.length <= 1) {
      await this.#sendReply(roomId, replyToEvent, content);
      return;
    }

    await this.#sendReply(roomId, replyToEvent, parts[0]);
    for (const part of parts.slice(1)) {
      await delay(delayMs);
      await this.#sendText(roomId, part);
    }
  }

  async #sendReply(
    roomId: string,
    replyToEvent: RawMatrixEvent,
    content: string,
  ): Promise<void> {
    const chunks = splitMatrixMessage(
      content,
      this.#matrixConfig?.maxMessageLength,
    );
    const [first = ""] = chunks;
    await this.#client?.sendMessage(roomId, {
      body: first,
      msgtype: "m.text",
      "m.relates_to": {
        "m.in_reply_to": {
          event_id: replyToEvent.event_id,
        },
      },
    });

    for (const chunk of chunks.slice(1)) {
      await this.#sendText(roomId, chunk);
    }
  }

  async #sendText(roomId: string, content: string): Promise<void> {
    for (
      const chunk of splitMatrixMessage(
        content,
        this.#matrixConfig?.maxMessageLength,
      )
    ) {
      await this.#client?.sendMessage(roomId, {
        body: chunk,
        msgtype: "m.text",
      });
    }
  }

  #startTyping(roomId: string): { stop(): void } {
    const client = this.#client;
    if (!client) {
      return { stop() {} };
    }

    let stopped = false;
    const sendTyping = () => {
      if (stopped) {
        return;
      }
      client.setTyping(roomId, true, 10000).catch(() => {});
    };

    sendTyping();
    const interval = setInterval(sendTyping, 8000);

    return {
      stop() {
        stopped = true;
        clearInterval(interval);
        client.setTyping(roomId, false, 0).catch(() => {});
      },
    };
  }
}

function isSupportedMessageType(msgtype: unknown): boolean {
  return msgtype === "m.text" || msgtype === "m.notice" ||
    msgtype === "m.emote" || msgtype === "m.image" ||
    msgtype === "m.file" || msgtype === "m.audio" ||
    msgtype === "m.video";
}

function matrixAttachments(
  raw: MatrixEventContent,
  homeserverUrl?: string,
): MessageAttachment[] {
  const msgtype = raw.msgtype;
  if (msgtype !== "m.image" && msgtype !== "m.file" &&
      msgtype !== "m.audio" && msgtype !== "m.video") {
    return [];
  }

  const rawUrl = typeof raw.url === "string" ? raw.url : undefined;
  if (!rawUrl) return [];

  // Resolve mxc:// URLs to HTTPS so image recognition providers can fetch them
  const url = resolveMxcUrl(rawUrl, homeserverUrl);

  const info = isRecord(raw.info) ? raw.info : {};
  return [{
    id: rawUrl,
    contentType: typeof info.mimetype === "string"
      ? info.mimetype
      : msgtypeToContentType(String(msgtype)),
    name: typeof raw.body === "string" ? raw.body : undefined,
    size: typeof info.size === "number" ? info.size : undefined,
    url,
    width: typeof info.w === "number" ? info.w : undefined,
    height: typeof info.h === "number" ? info.h : undefined,
  }];
}

/**
 * Resolve a Matrix mxc:// URI to an HTTPS URL via the homeserver's media endpoint.
 * Leaves non-mxc URLs unchanged.
 */
function resolveMxcUrl(url: string, homeserverUrl?: string): string {
  if (!url.startsWith("mxc://") || !homeserverUrl) {
    return url;
  }

  // mxc://serverName/mediaId → https://homeserver/_matrix/media/v3/download/serverName/mediaId
  const parts = url.slice("mxc://".length).split("/");
  if (parts.length < 2) return url;

  const serverName = parts[0];
  const mediaId = parts.slice(1).join("/");
  const base = homeserverUrl.replace(/\/+$/, "");
  return `${base}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
}

function msgtypeToContentType(msgtype: string): string {
  switch (msgtype) {
    case "m.image": return "image/unknown";
    case "m.file": return "application/octet-stream";
    case "m.audio": return "audio/unknown";
    case "m.video": return "video/unknown";
    default: return "application/octet-stream";
  }
}

function matrixAttachmentSummary(
  msgtype: unknown,
  attachments: MessageAttachment[],
): string {
  if (attachments.length === 0) return "";
  const [a] = attachments;
  const label = a.name ?? "attachment";
  switch (msgtype) {
    case "m.image": return `[Image: ${label}]`;
    case "m.file": return `[File: ${label}]`;
    case "m.audio": return `[Audio: ${label}]`;
    case "m.video": return `[Video: ${label}]`;
    default: return `[Attachment: ${label}]`;
  }
}

interface MatrixAuthSession {
  accessToken: string;
  managedDevice: boolean;
}

function canAuthenticateMatrix(
  config: MatrixPlatformConfig,
): boolean {
  return Boolean(
    config.homeserverUrl &&
      (config.accessToken || (config.username && config.password)),
  );
}

async function resolveMatrixSession(
  context: AgentContext,
  config: MatrixPlatformConfig,
): Promise<MatrixAuthSession> {
  if (config.accessToken) {
    if (
      config.homeserverUrl &&
      await isAccessTokenValid(config.homeserverUrl, config.accessToken)
    ) {
      return { accessToken: config.accessToken, managedDevice: false };
    }

    if (!config.username || !config.password) {
      throw new Error(
        "MATRIX_ACCESS_TOKEN is no longer valid. Generate a new token, or set MATRIX_USERNAME and MATRIX_PASSWORD so Missy can log in on its own.",
      );
    }
    context.logger.warn(
      "Configured MATRIX_ACCESS_TOKEN is invalid; falling back to username/password login.",
    );
  }

  if (!config.homeserverUrl || !config.username || !config.password) {
    throw new Error(
      "Matrix managed device login requires MATRIX_HOMESERVER_URL, MATRIX_USERNAME, and MATRIX_PASSWORD.",
    );
  }

  const matrixStore = context.keystore.namespace("matrix");
  const stored = matrixStore.get("botSdkSession");
  if (isRecord(stored) && typeof stored.accessToken === "string") {
    const valid = await isAccessTokenValid(
      config.homeserverUrl,
      stored.accessToken,
    );
    if (valid) {
      return { accessToken: stored.accessToken, managedDevice: true };
    }
    context.logger.warn(
      "Stored Matrix access token is no longer valid; logging in again. The crypto store will be reset for the new device.",
    );
    fs.rmSync(path.join(STORAGE_DIR, "crypto"), {
      recursive: true,
      force: true,
    });
  }

  const auth = new MatrixAuth(config.homeserverUrl);
  const loginClient = await auth.passwordLogin(
    config.username,
    config.password,
    config.deviceDisplayName,
  );
  const accessToken = loginClient.accessToken;
  const whoami = await loginClient.getWhoAmI();

  await matrixStore.set("botSdkSession", {
    accessToken,
    deviceId: whoami.device_id,
    loggedInAt: new Date().toISOString(),
    userId: whoami.user_id,
  });
  context.logger.info("Created Matrix managed device", {
    deviceId: whoami.device_id,
    userId: whoami.user_id,
  });

  return { accessToken, managedDevice: true };
}

async function isAccessTokenValid(
  homeserverUrl: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const probe = new MatrixClient(homeserverUrl, accessToken);
    await probe.getWhoAmI();
    return true;
  } catch {
    return false;
  }
}

interface MatrixAddressing {
  content: string;
  isPrefixCommand: boolean;
  mentioned: boolean;
}

function parseMatrixAddressing({
  body,
  content,
  botUserId,
  displayName,
  prefix,
}: {
  body: string;
  content: MatrixEventContent;
  botUserId: string | undefined;
  displayName: string;
  prefix: string;
}): MatrixAddressing {
  const trimmed = body.trim();
  if (prefix && trimmed.startsWith(prefix)) {
    return {
      content: trimmed.slice(prefix.length).trim(),
      isPrefixCommand: true,
      mentioned: false,
    };
  }

  const nativeMentioned = hasMatrixUserMention(content, botUserId);
  const leadingAddress = stripLeadingAddressName(
    trimmed,
    matrixAddressNames(displayName, botUserId),
  );
  if (leadingAddress.addressed) {
    return {
      content: cleanMentionContent(
        leadingAddress.content,
        botUserId,
        displayName,
      ),
      isPrefixCommand: false,
      mentioned: true,
    };
  }

  const textMentioned = hasTextMention(trimmed, displayName, botUserId);
  if (nativeMentioned || textMentioned) {
    return {
      content: cleanMentionContent(trimmed, botUserId, displayName),
      isPrefixCommand: false,
      mentioned: true,
    };
  }

  return {
    content: trimmed,
    isPrefixCommand: false,
    mentioned: false,
  };
}

function hasMatrixUserMention(
  content: MatrixEventContent,
  botUserId: string | undefined,
): boolean {
  const mentions = content["m.mentions"];
  return Boolean(
    botUserId &&
      isRecord(mentions) &&
      Array.isArray(mentions.user_ids) &&
      mentions.user_ids.includes(botUserId),
  );
}

function matrixAddressNames(
  displayName: string,
  botUserId: string | undefined,
): string[] {
  const names = new Set<string>();
  const cleanDisplayName = normalizeAddressName(displayName);
  if (cleanDisplayName) {
    names.add(cleanDisplayName);
  }

  const localpart = botUserId?.match(/^@([^:]+)/)?.[1];
  const cleanLocalpart = normalizeAddressName(localpart ?? "");
  if (cleanLocalpart) {
    names.add(cleanLocalpart);
  }

  return [...names].sort((a, b) => b.length - a.length);
}

function normalizeAddressName(value: string): string {
  return value.trim().replace(/^@/, "");
}

function stripLeadingAddressName(
  body: string,
  names: string[],
): { addressed: boolean; content: string } {
  for (const name of names) {
    const pattern = new RegExp(
      `^@?${escapeRegExp(name)}(?:\\s+|[,:;.!?]+\\s*|$)`,
      "i",
    );
    const match = body.match(pattern);
    if (match) {
      return {
        addressed: true,
        content: body.slice(match[0].length).trim(),
      };
    }
  }

  return { addressed: false, content: body };
}

function hasTextMention(
  body: string,
  displayName: string,
  botUserId: string | undefined,
): boolean {
  const names = matrixAddressNames(displayName, botUserId);
  return names.some((name) =>
    new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[,:;.!?])`, "i").test(
      body,
    )
  ) || (botUserId ? body.includes(botUserId) : false);
}

function cleanMentionContent(
  body: string,
  botUserId: string | undefined,
  displayName: string,
): string {
  let result = body.trim();
  if (botUserId) {
    result = result.replaceAll(botUserId, "");
  }

  for (const name of matrixAddressNames(displayName, botUserId)) {
    result = result.replace(
      new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[,:;.!?])`, "gi"),
      " ",
    );
  }

  return result.trim();
}

function generateMatrixSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("").toLowerCase().slice(0, 10);
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

function splitMatrixMessage(content: string, maxLength = 0): string[] {
  const effectiveMax = maxLength > 0 ? maxLength : 4000;
  const normalized = content.trim();
  if (normalized.length <= effectiveMax) {
    return [normalized || " "];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > effectiveMax) {
    let splitAt = remaining.lastIndexOf("\n", effectiveMax);
    if (splitAt < Math.floor(effectiveMax * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", effectiveMax);
    }
    if (splitAt < 1) {
      splitAt = effectiveMax;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function splitByDelimiter(content: string, delimiter: string): string[] {
  return content
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const module: PlatformModule = {
  metadata: {
    name: "matrix",
    description: "Matrix platform adapter backed by matrix-bot-sdk.",
    version: "0.2.0",
  },
  configSchema: {
    module: "matrix",
    label: "Matrix Platform",
    fields: [
      {
        key: "matrix.homeserverUrl",
        label: "Matrix Homeserver URL",
        description: "Example: https://matrix.org",
        type: "string",
        required: true,
      },
      {
        key: "matrix.accessToken",
        label: "Matrix Access Token",
        description:
          "Existing access token for the bot account; optional when username/password are set",
        type: "string",
        required: false,
        secret: true,
      },
      {
        key: "matrix.username",
        label: "Matrix Username",
        description:
          "Bot Matrix username or user ID for automatic device login",
        type: "string",
        required: false,
      },
      {
        key: "matrix.password",
        label: "Matrix Password",
        description: "Bot Matrix password for automatic Missy device login",
        type: "string",
        required: false,
        secret: true,
      },
      {
        key: "matrix.userId",
        label: "Matrix User ID",
        description:
          "Example: @missy:matrix.org; optional when username/password are set",
        type: "string",
        required: false,
      },
      {
        key: "matrix.deviceDisplayName",
        label: "Matrix Device Display Name",
        description: "Display name for the automatically-created Matrix device",
        type: "string",
        required: false,
        default: "Missy Bot",
      },
      {
        key: "matrix.roomIds",
        label: "Matrix Room IDs",
        description: "Comma-separated room IDs or aliases to join on startup",
        type: "string",
        required: false,
        default: "",
      },
      {
        key: "matrix.commandPrefix",
        label: "Command Prefix",
        description: "Prefix for Matrix text commands",
        type: "string",
        required: false,
        default: "!M!",
      },
      {
        key: "matrix.displayName",
        label: "Matrix Display Name",
        description: "Display name used for plain-text mentions",
        type: "string",
        required: false,
        default: "Missy",
      },
      {
        key: "matrix.mentionOnly",
        label: "Mention Only",
        description: "Only respond in rooms when mentioned",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "matrix.respondToAllMessages",
        label: "Respond to All Messages",
        description: "Respond to every message in Matrix rooms",
        type: "boolean",
        required: false,
        default: false,
        hidden: true,
      },
      {
        key: "matrix.maxMessageLength",
        label: "Max Message Length",
        description: "Maximum characters per Matrix message",
        type: "number",
        required: false,
        default: 0,
        hidden: true,
      },
      {
        key: "matrix.autoJoinInvites",
        label: "Auto-Join Invites",
        description: "Automatically join rooms the bot is invited to",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new MatrixPlatform(),
};

export default module;
