/**
 * MatrixPlatform — the main Matrix platform adapter.
 */

import {
  AutojoinRoomsMixin,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentContext, AgentPlatform, ConversationMessage, InboundMessage } from "../../../core/types.ts";
import { delay, generateSessionId, isRecord, normalizeSessionName, splitByDelimiter } from "../../../core/helpers.ts";
import * as crypto from "node:crypto";
import type { MatrixEventContent, MatrixPlatformConfig, RawMatrixEvent } from "./types.ts";
import { VERIFICATION_EVENT_TYPES } from "./types.ts";
import { parseMatrixConfig } from "./config.ts";
import { canAuthenticateMatrix, resolveMatrixSession } from "./auth.ts";
import { parseMatrixAddressing } from "./addressing.ts";
import { matrixAttachments, matrixAttachmentSummary } from "./attachments.ts";

const STORAGE_DIR = path.join("data", "matrix");

export class MatrixPlatform implements AgentPlatform {
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

    // Monkey-patch updateSyncData to log verification to-device events
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
            if (VERIFICATION_EVENT_TYPES.has(String(msgType))) {
              context.logger.info(
                `To-device verification event: ${msgType} from ${m.sender ?? "?"}`,
                { type: msgType, sender: m.sender, transaction_id: (m.content as Record<string, unknown>)?.transaction_id },
              );
            } else {
              context.logger.debug(
                `To-device event: ${msgType} from ${m.sender ?? "?"}`,
                { type: msgType, sender: m.sender, hasOlmCiphertext: msgType === "m.room.encrypted" },
              );
            }
          }
        }
      }
      return originalUpdateSyncData(
        toDeviceMessages, otkCounts, unusedFallbackKeyAlgs, changedDeviceLists, leftDeviceLists,
      );
    };

    client.on("to_device.decrypted", (msg: Record<string, unknown>) => {
      const msgType = msg.type ?? "";
      if (VERIFICATION_EVENT_TYPES.has(String(msgType))) {
        context.logger.info(
          `Decrypted to-device verification event: ${msgType} from ${msg.sender ?? "?"}`,
          { type: msgType, sender: msg.sender, transaction_id: (msg.content as Record<string, unknown>)?.transaction_id },
        );
      } else {
        context.logger.debug(`Decrypted to-device event: ${msgType} from ${msg.sender ?? "?"}`);
      }
    });

    if (config.autoJoinInvites) {
      AutojoinRoomsMixin.setupOnClient(client);
    }

    client.on("room.invite", (roomId: string, inviteEvent: RawMatrixEvent) => {
      context.logger.info(`Matrix room invite received`, { roomId, inviter: inviteEvent.sender, eventId: inviteEvent.event_id });
      client.joinRoom(roomId)
        .then(() => context.logger.info(`Joined Matrix room via invite`, { roomId, inviter: inviteEvent.sender }))
        .catch((error) => context.logger.error(`Failed to join Matrix room after invite: ${roomId}`, error));
    });

    client.on("room.join", (roomId: string) => {
      context.logger.info(`Matrix room join detected`, { roomId });
    });

    client.on("room.message", (roomId: string, event: RawMatrixEvent) => {
      this.#handleRoomMessage(roomId, event).catch((error) =>
        context.logger.error("Failed to handle Matrix message", error)
      );
    });
    client.on("room.failed_decryption", (roomId: string, event: RawMatrixEvent, error: Error) => {
      context.logger.warn("Matrix event failed to decrypt", {
        roomId, eventId: event.event_id, senderId: event.sender, error: error.message,
      });
    });

    this.#botUserId = await client.getUserId();

    for (const roomIdOrAlias of config.roomIds) {
      try {
        const roomId = await client.resolveRoom(roomIdOrAlias);
        await client.joinRoom(roomId);
      } catch (error) {
        context.logger.warn(`Failed to join Matrix room ${roomIdOrAlias}`, error);
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

  async #handleRoomMessage(roomId: string, event: RawMatrixEvent): Promise<void> {
    if (!this.#context || !this.#client) return;

    const eventId = event.event_id;
    if (!eventId || this.#seenEventIds.has(eventId)) return;
    this.#rememberSeenEventId(eventId);

    if (event.origin_server_ts < this.#startedAt - 5000) return;

    const content = event.content ?? {};
    const msgtype = content.msgtype;
    const body = typeof content.body === "string" ? content.body.trim() : "";
    const attachments = matrixAttachments(content, this.#matrixConfig?.homeserverUrl);

    if (!body && attachments.length === 0) return;

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

    if (!event.sender || event.sender === this.#botUserId) return;

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

    if (!isDirectRoom && !mentioned && !isPrefixCommand) return;

    const shouldStripMentionedPrefix = prefix &&
      (mentioned || isDirectRoom) &&
      !isPrefixCommand &&
      addressing.content.startsWith(prefix);
    const messageContent = shouldStripMentionedPrefix
      ? addressing.content.slice(prefix.length).trim()
      : addressing.content;

    if (await this.#handleLocalCommand(messageContent, roomId, event)) return;

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
    if (cached !== undefined) return cached;

    let isDirect = false;
    try {
      const direct = await this.#client?.getAccountData<Record<string, string[]>>("m.direct");
      if (direct) {
        isDirect = Object.values(direct).some((roomIds) =>
          Array.isArray(roomIds) && roomIds.includes(roomId)
        );
      }
    } catch { /* m.direct may not exist */ }

    if (!isDirect && this.#client) {
      try {
        const state = await this.#client.getRoomState(roomId);
        const memberEvents = state.filter((event) => event.type === "m.room.member");
        const hasDirectFlag = memberEvents.some((event) => event.content?.is_direct === true);
        const joinedCount = memberEvents.filter((event) => event.content?.membership === "join").length;
        const hasRoomName = state.some((event) =>
          event.type === "m.room.name" && typeof event.content?.name === "string" && event.content.name.length > 0
        );
        isDirect = hasDirectFlag || (joinedCount <= 2 && !hasRoomName);
      } catch { isDirect = false; }
    }

    this.#directRoomCache.set(roomId, isDirect);
    return isDirect;
  }

  async #resolveDisplayName(userId: string): Promise<string | undefined> {
    if (this.#displayNameCache.has(userId)) return this.#displayNameCache.get(userId);

    let name: string | undefined;
    try {
      const profile = await this.#client?.getUserProfile(userId);
      name = typeof profile?.displayname === "string" ? profile.displayname : undefined;
    } catch { name = undefined; }

    this.#displayNameCache.set(userId, name);
    if (this.#displayNameCache.size > 1000) this.#displayNameCache.clear();
    return name;
  }

  #rememberRoomContext(roomId: string, message: ConversationMessage): void {
    const limit = Math.max((this.#matrixConfig?.channelContextCount ?? 10) * 2, 50);
    const buffer = this.#roomContext.get(roomId) ?? [];
    buffer.push(message);
    if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
    this.#roomContext.set(roomId, buffer);
  }

  #fetchChannelContext(roomId: string, currentEventId: string): ConversationMessage[] | undefined {
    if (!this.#matrixConfig?.includeChannelContext) return undefined;
    const limit = this.#matrixConfig.channelContextCount;
    if (limit <= 0) return undefined;
    const buffer = this.#roomContext.get(roomId) ?? [];
    return buffer
      .filter((message) => message.id !== currentEventId && !message.id.startsWith("session-sep-"))
      .slice(-limit);
  }

  async #buildReplyReference(roomId: string, content: MatrixEventContent): Promise<InboundMessage["replyTo"]> {
    if (!this.#matrixConfig?.includeReplyContext || !this.#client) return undefined;
    const relatesTo = content["m.relates_to"];
    const replyEventId = isRecord(relatesTo) &&
        isRecord(relatesTo["m.in_reply_to"]) &&
        typeof relatesTo["m.in_reply_to"].event_id === "string"
      ? relatesTo["m.in_reply_to"].event_id
      : undefined;
    if (!replyEventId) return undefined;
    return await this.#walkReplyChain(roomId, replyEventId, 5);
  }

  async #walkReplyChain(roomId: string, eventId: string, maxDepth: number): Promise<InboundMessage["replyTo"]> {
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
      if (maxDepth > 1) {
        const relatesTo = eventContent["m.relates_to"];
        const parentId = isRecord(relatesTo) &&
            isRecord(relatesTo["m.in_reply_to"]) &&
            typeof relatesTo["m.in_reply_to"].event_id === "string"
          ? relatesTo["m.in_reply_to"].event_id
          : undefined;
        if (parentId) ref.replyTo = await this.#walkReplyChain(roomId, parentId, maxDepth - 1);
      }
      return ref;
    } catch { return undefined; }
  }

  #rememberSeenEventId(eventId: string): void {
    this.#seenEventIds.add(eventId);
    if (this.#seenEventIds.size > 5000) this.#seenEventIds = new Set([...this.#seenEventIds].slice(-2500));
  }

  // ─── Session management ────────────────────────────────────────────────

  #loadSessions(): void {
    if (!this.#context) return;
    const stored = this.#context.keystore.namespace("matrix").get("roomSessions");
    if (!isRecord(stored)) return;
    for (const [roomId, session] of Object.entries(stored)) {
      if (!isRecord(session)) continue;
      const id = typeof session.id === "string" ? session.id : undefined;
      const startedAt = typeof session.startedAt === "number" ? session.startedAt : undefined;
      if (!id || !startedAt) continue;
      this.#roomSessionIds.set(roomId, id);
      this.#roomSessionStartedAt.set(roomId, startedAt);
    }
  }

  async #startRoomSession(roomId: string, requestedName?: string): Promise<{ id: string; startedAt: number }> {
    const startedAt = Date.now();
    const id = normalizeSessionName(requestedName) ?? generateSessionId();
    this.#roomSessionIds.set(roomId, id);
    this.#roomSessionStartedAt.set(roomId, startedAt);
    this.#roomContext.set(roomId, [{
      id: `session-sep-${id}`,
      authorId: "system", authorName: "session",
      content: "====================", isBot: true,
    }]);
    await this.#saveSessions();
    return { id, startedAt };
  }

  async #saveSessions(): Promise<void> {
    if (!this.#context) return;
    const sessions: Record<string, { id: string; startedAt: number }> = {};
    for (const [roomId, id] of this.#roomSessionIds) {
      const startedAt = this.#roomSessionStartedAt.get(roomId);
      if (startedAt) sessions[roomId] = { id, startedAt };
    }
    await this.#context.keystore.namespace("matrix").set("roomSessions", sessions);
  }

  // ─── Local commands ────────────────────────────────────────────────────

  async #handleLocalCommand(content: string, roomId: string, event: RawMatrixEvent): Promise<boolean> {
    const [command = "", ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "verify") {
      if (args[0]?.toLowerCase() === "confirm") { await this.#handleVerifyConfirm(roomId, event); return true; }
      await this.#handleVerifyRequest(roomId, event);
      return true;
    }
    if (normalized === "help" || normalized === "commands") {
      await this.#sendReply(roomId, event, [
        "Commands:",
        "DMs: help, status, verify, verify confirm, memory, memory all, session, session new [name], context clear, plugins, tools, or any message.",
        "Rooms: mention Missy with help, status, memory, session, plugins, tools, or a message.",
      ].join("\n"));
      return true;
    }
    if (normalized === "status") { await this.#sendReply(roomId, event, this.#formatStatus()); return true; }
    if (normalized === "tools") { await this.#sendReply(roomId, event, this.#formatTools()); return true; }
    if (normalized === "plugins") { await this.#sendReply(roomId, event, this.#formatPlugins()); return true; }
    if (normalized === "session" || normalized === "sessions") {
      if (args[0]?.toLowerCase() === "new" || args[0]?.toLowerCase() === "start" || args[0]?.toLowerCase() === "clear") {
        const session = await this.#startRoomSession(roomId, args.slice(1).join(" "));
        await this.#sendReply(roomId, event, `Started session ${session.id}. Earlier room context is now ignored.`);
        return true;
      }
      await this.#sendReply(roomId, event, this.#formatRoomSession(roomId));
      return true;
    }
    if (
      (normalized === "context" && ["clear", "reset", "new"].includes(args[0]?.toLowerCase() ?? "")) ||
      (normalized === "clear" && ["context", "session"].includes(args[0]?.toLowerCase() ?? "")) ||
      (normalized === "new" && args[0]?.toLowerCase() === "session") ||
      normalized === "reset"
    ) {
      const session = await this.#startRoomSession(roomId);
      await this.#sendReply(roomId, event, `Context cleared. Started session ${session.id}.`);
      return true;
    }
    if (normalized === "memory" || normalized === "mem") {
      await this.#sendReply(roomId, event, this.#formatMemory(event.sender, args[0]?.toLowerCase() === "all"));
      return true;
    }
    return false;
  }

  // ─── Formatters ────────────────────────────────────────────────────────

  #formatTools(): string {
    if (!this.#context) return "Missy is not ready.";
    const tools = this.#context.tools.list();
    if (tools.length === 0) return "No tools are registered.";
    return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  }
  #formatPlugins(): string {
    if (!this.#context) return "Missy is not ready.";
    if (this.#context.plugins.length === 0) return "No plugins are loaded.";
    return this.#context.plugins.map((plugin) => `- ${plugin.name} v${plugin.version}: ${plugin.description}`).join("\n");
  }
  #formatMemory(userId: string, includeAll: boolean): string {
    if (!this.#context) return "Missy is not ready.";
    if (!this.#context.config.memory.enabled) return "Memory is disabled.";
    if (includeAll) {
      const allMemory = this.#context.memory.getAllMemory();
      const lines = Object.entries(allMemory).flatMap(([storedUserId, records]) =>
        records.map((record) => `- ${storedUserId}.${record.key}: ${record.value}`)
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
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled", "Room routing: direct mentions only",
      `Reply context: ${this.#matrixConfig.includeReplyContext ? "enabled" : "disabled"}`,
      `Auto-join invites: ${this.#matrixConfig.autoJoinInvites ? "enabled" : "disabled"}`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }
  #formatRoomSession(roomId: string): string {
    const id = this.#roomSessionIds.get(roomId);
    const startedAt = this.#roomSessionStartedAt.get(roomId);
    if (!id || !startedAt) return "Current session: default\nContext includes the configured live room history.";
    return [`Current session: ${id}`, `Started: ${new Date(startedAt).toISOString()}`, "Context only includes room messages after this session started."].join("\n");
  }

  // ─── Verification ─────────────────────────────────────────────────────

  async #handleVerifyRequest(roomId: string, event: RawMatrixEvent): Promise<void> {
    if (!this.#client || !this.#botUserId) { await this.#sendReply(roomId, event, "Missy is not ready."); return; }
    const targetUserId = event.sender;
    if (!targetUserId) { await this.#sendReply(roomId, event, "Cannot identify your user."); return; }
    try {
      const txnId = `verify-${crypto.randomUUID()}`;
      await this.#client.sendToDevices("m.key.verification.request", {
        [targetUserId]: { "*": { from_device: this.#botUserId, transaction_id: txnId, methods: ["m.sas.v1"], timestamp: Date.now() } },
      });
      await this.#sendReply(roomId, event, "Verification request sent. Check Element — accept the request, compare the SAS emojis, and confirm. The bot handles the rest automatically.");
    } catch (error) {
      await this.#sendReply(roomId, event, `Failed to send verification request: ${String(error)}`);
    }
  }

  async #handleVerifyConfirm(roomId: string, event: RawMatrixEvent): Promise<void> {
    const recoveryKey = this.#matrixConfig?.recoveryKey;
    if (recoveryKey) {
      await this.#sendReply(roomId, event, "MATRIX_RECOVERY_KEY is set. Cross-signing will be attempted on the next restart.");
    } else {
      await this.#sendReply(roomId, event, "The SAS verification should be complete. If the emojis matched, this device is now verified from your perspective. To self-verify (cross-sign), set MATRIX_RECOVERY_KEY and restart.");
    }
  }

  // ─── Sending ──────────────────────────────────────────────────────────

  async #sendMultiMessageReply(roomId: string, replyToEvent: RawMatrixEvent, content: string): Promise<void> {
    const delimiter = this.#matrixConfig?.multiMessageDelimiter ?? "|||";
    const delayMs = this.#matrixConfig?.multiMessageDelayMs ?? 1500;
    const parts = splitByDelimiter(content, delimiter);
    if (parts.length <= 1) { await this.#sendReply(roomId, replyToEvent, content); return; }
    await this.#sendReply(roomId, replyToEvent, parts[0]);
    for (const part of parts.slice(1)) { await delay(delayMs); await this.#sendText(roomId, part); }
  }

  async #sendReply(roomId: string, replyToEvent: RawMatrixEvent, content: string): Promise<void> {
    const chunks = splitMatrixMessage(content, this.#matrixConfig?.maxMessageLength);
    const [first = ""] = chunks;
    await this.#client?.sendMessage(roomId, {
      body: first, msgtype: "m.text",
      "m.relates_to": { "m.in_reply_to": { event_id: replyToEvent.event_id } },
    });
    for (const chunk of chunks.slice(1)) { await this.#sendText(roomId, chunk); }
  }

  async #sendText(roomId: string, content: string): Promise<void> {
    for (const chunk of splitMatrixMessage(content, this.#matrixConfig?.maxMessageLength)) {
      await this.#client?.sendMessage(roomId, { body: chunk, msgtype: "m.text" });
    }
  }

  #startTyping(roomId: string): { stop(): void } {
    const client = this.#client;
    if (!client) return { stop() {} };
    let stopped = false;
    const sendTyping = () => { if (!stopped) client.setTyping(roomId, true, 10000).catch(() => {}); };
    sendTyping();
    const interval = setInterval(sendTyping, 8000);
    return {
      stop() { stopped = true; clearInterval(interval); client.setTyping(roomId, false, 0).catch(() => {}); },
    };
  }
}

// ─── Message splitting helper ──────────────────────────────────────────

export function splitMatrixMessage(content: string, maxLength = 0): string[] {
  const effectiveMax = maxLength > 0 ? maxLength : 4000;
  const normalized = content.trim();
  if (normalized.length <= effectiveMax) return [normalized || " "];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > effectiveMax) {
    let splitAt = remaining.lastIndexOf("\n", effectiveMax);
    if (splitAt < Math.floor(effectiveMax * 0.5)) splitAt = remaining.lastIndexOf(" ", effectiveMax);
    if (splitAt < 1) splitAt = effectiveMax;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
