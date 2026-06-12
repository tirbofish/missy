import {
  ClientEvent,
  createClient,
  EventType,
  MsgType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import type {
  AgentContext,
  AgentPlatform,
  ConfigSchema,
  ConversationMessage,
  InboundMessage,
  PlatformModule,
} from "../../core/types.ts";

class MatrixPlatform implements AgentPlatform {
  readonly name = "matrix";
  #client?: MatrixClient;
  #context?: AgentContext;
  #startedAt = 0;
  #seenEventIds = new Set<string>();
  #watchedRoomIds = new Set<string>();

  async start(context: AgentContext): Promise<void> {
    const config = context.config.matrix;
    if (!config.homeserverUrl) {
      throw new Error(
        "MATRIX_HOMESERVER_URL is required when the matrix platform is enabled.",
      );
    }
    if (!config.accessToken) {
      throw new Error(
        "MATRIX_ACCESS_TOKEN is required when the matrix platform is enabled.",
      );
    }
    if (!config.userId) {
      throw new Error(
        "MATRIX_USER_ID is required when the matrix platform is enabled.",
      );
    }

    this.#context = context;
    this.#startedAt = Date.now();
    this.#client = createClient({
      baseUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
      disableVoip: true,
    });

    this.#client.on(RoomEvent.Timeline, (event, room, toStart, removed, data) => {
      this.#handleTimelineEvent(event, room, toStart, removed, data?.liveEvent)
        .catch((error) =>
          context.logger.error("Failed to handle Matrix timeline event", error)
        );
    });
    this.#client.on(ClientEvent.Room, (room) => this.#watchRoom(room));

    for (const roomId of config.roomIds) {
      await this.#client.joinRoom(roomId).catch((error) =>
        context.logger.warn(`Failed to join Matrix room ${roomId}`, error)
      );
    }

    await this.#client.startClient({
      initialSyncLimit: Math.max(config.channelContextCount + 2, 10),
      lazyLoadMembers: true,
      disablePresence: true,
    });

    context.logger.info(`Matrix logged in as ${config.userId}`);
  }

  async stop(): Promise<void> {
    this.#client?.stopClient();
    this.#client = undefined;
    this.#seenEventIds.clear();
    this.#watchedRoomIds.clear();
  }

  #watchRoom(room: Room): void {
    if (this.#watchedRoomIds.has(room.roomId)) {
      return;
    }

    this.#watchedRoomIds.add(room.roomId);
    room.on(RoomEvent.MyMembership, (updatedRoom, membership) => {
      if (membership === "invite") {
        this.#joinInvitedRoom(updatedRoom).catch((error) =>
          this.#context?.logger.warn(
            `Failed to join Matrix invite ${updatedRoom.roomId}`,
            error,
          )
        );
      }
    });

    if (room.getMyMembership() === "invite") {
      this.#joinInvitedRoom(room).catch((error) =>
        this.#context?.logger.warn(
          `Failed to join Matrix invite ${room.roomId}`,
          error,
        )
      );
    }
  }

  async #joinInvitedRoom(room: Room): Promise<void> {
    if (!this.#client || !this.#context?.config.matrix.autoJoinInvites) {
      return;
    }

    await this.#client.joinRoom(room.roomId);
    this.#context.logger.info(`Joined Matrix invite ${room.roomId}`);
  }

  async #handleTimelineEvent(
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    liveEvent: boolean | undefined,
  ): Promise<void> {
    if (!this.#context || !this.#client || !room) {
      return;
    }
    if (removed || toStartOfTimeline || liveEvent === false) {
      return;
    }

    const eventId = event.getId();
    if (!eventId || this.#seenEventIds.has(eventId)) {
      return;
    }
    this.#seenEventIds.add(eventId);
    if (this.#seenEventIds.size > 5000) {
      this.#seenEventIds = new Set([...this.#seenEventIds].slice(-2500));
    }

    if (event.getTs() < this.#startedAt - 5000) {
      return;
    }
    if (event.getType() !== EventType.RoomMessage) {
      return;
    }

    const botUserId = this.#context.config.matrix.userId;
    const senderId = event.getSender();
    if (!senderId || senderId === botUserId) {
      return;
    }

    const content = event.getContent();
    const body = typeof content.body === "string" ? content.body.trim() : "";
    if (!body || !isSupportedMessageType(content.msgtype)) {
      return;
    }

    const prefix = this.#context.config.matrix.commandPrefix;
    const isPrefixCommand = body.startsWith(prefix);
    const isReplyToBot = await this.#isReplyToBot(event, room);
    const mentioned = isMatrixMention(
      content,
      body,
      botUserId,
      this.#context.config.matrix.displayName,
    );
    const isDirectRoom = room.getJoinedMemberCount() <= 2;
    const shouldHandleRoomMessage = mentioned || isPrefixCommand ||
      isReplyToBot ||
      this.#context.config.matrix.respondToAllMessages;

    if (
      this.#context.config.matrix.mentionOnly &&
      !isDirectRoom &&
      !shouldHandleRoomMessage
    ) {
      return;
    }

    const messageContent = isPrefixCommand
      ? body.slice(prefix.length).trim()
      : cleanMentionContent(
        body,
        botUserId,
        this.#context.config.matrix.displayName,
      );

    if (isPrefixCommand && await this.#handleLocalCommand(messageContent, room, event)) {
      return;
    }

    if (!messageContent) {
      await this.#sendReply(room.roomId, eventId, "What do you need?");
      return;
    }

    const typing = startTyping(this.#client, room.roomId);
    const inbound: InboundMessage = {
      id: eventId,
      platform: this.name,
      channelId: room.roomId,
      channelType: isDirectRoom ? "dm" : "room",
      guildId: room.roomId,
      authorId: senderId,
      authorName: event.sender?.name,
      content: messageContent,
      context: this.#fetchChannelContext(room, eventId),
      replyTo: await this.#buildReplyReference(event, room),
      reply: async (replyContent) => {
        await this.#sendMultiMessageReply(room.roomId, eventId, replyContent);
      },
    };

    try {
      await this.#context.handleMessage(inbound);
      await this.#client.sendReadReceipt(event).catch((error) =>
        this.#context?.logger.warn("Failed to send Matrix read receipt", error)
      );
    } finally {
      typing.stop();
    }
  }

  async #handleLocalCommand(
    content: string,
    room: Room,
    event: MatrixEvent,
  ): Promise<boolean> {
    const [command = ""] = content.split(/\s+/);
    const [, ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();
    const eventId = event.getId();
    if (!eventId) {
      return false;
    }

    if (normalized === "help" || normalized === "commands") {
      await this.#sendReply(
        room.roomId,
        eventId,
        [
          "Commands:",
          `${this.#context?.config.matrix.commandPrefix} help`,
          `${this.#context?.config.matrix.commandPrefix} status`,
          `${this.#context?.config.matrix.commandPrefix} memory`,
          `${this.#context?.config.matrix.commandPrefix} memory all`,
          `${this.#context?.config.matrix.commandPrefix} plugins`,
          `${this.#context?.config.matrix.commandPrefix} tools`,
          `${this.#context?.config.matrix.commandPrefix} <message for Missy>`,
        ].join("\n"),
      );
      return true;
    }

    if (normalized === "status") {
      await this.#sendReply(room.roomId, eventId, this.#formatStatus());
      return true;
    }

    if (normalized === "tools") {
      await this.#sendReply(room.roomId, eventId, this.#formatTools());
      return true;
    }

    if (normalized === "plugins") {
      await this.#sendReply(room.roomId, eventId, this.#formatPlugins());
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await this.#sendReply(
        room.roomId,
        eventId,
        this.#formatMemory(
          event.getSender() ?? "",
          args[0]?.toLowerCase() === "all",
        ),
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

  #formatStatus(): string {
    if (!this.#context) {
      return "Missy is not ready.";
    }

    return [
      "Missy is online.",
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled",
      `Room routing: ${
        this.#context.config.matrix.respondToAllMessages
          ? "all messages"
          : "mentions, replies, and prefix"
      }`,
      `Reply context: ${
        this.#context.config.matrix.includeReplyContext
          ? "enabled"
          : "disabled"
      }`,
      `Auto-join invites: ${
        this.#context.config.matrix.autoJoinInvites ? "enabled" : "disabled"
      }`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }

  async #sendMultiMessageReply(
    roomId: string,
    replyToEventId: string,
    content: string,
  ): Promise<void> {
    const delimiter = this.#context?.config.matrix.multiMessageDelimiter ?? "|||";
    const delayMs = this.#context?.config.matrix.multiMessageDelayMs ?? 1500;
    const parts = splitByDelimiter(content, delimiter);

    if (parts.length <= 1) {
      await this.#sendReply(roomId, replyToEventId, content);
      return;
    }

    await this.#sendReply(roomId, replyToEventId, parts[0]);
    for (const part of parts.slice(1)) {
      await delay(delayMs);
      await this.#sendText(roomId, part);
    }
  }

  async #sendReply(
    roomId: string,
    replyToEventId: string,
    content: string,
  ): Promise<void> {
    const chunks = splitMatrixMessage(
      content,
      this.#context?.config.matrix.maxMessageLength,
    );
    const [first = ""] = chunks;
    await this.#client?.sendMessage(roomId, {
      body: first,
      msgtype: MsgType.Text,
      "m.relates_to": {
        "m.in_reply_to": {
          event_id: replyToEventId,
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
        this.#context?.config.matrix.maxMessageLength,
      )
    ) {
      await this.#client?.sendMessage(roomId, {
        body: chunk,
        msgtype: MsgType.Text,
      });
    }
  }

  async #isReplyToBot(event: MatrixEvent, room: Room): Promise<boolean> {
    if (!this.#context?.config.matrix.includeReplyContext) {
      return false;
    }

    const replyEventId = event.replyEventId;
    if (!replyEventId) {
      return false;
    }

    const reference = findRoomEvent(room, replyEventId);
    return reference?.getSender() === this.#context.config.matrix.userId;
  }

  async #buildReplyReference(
    event: MatrixEvent,
    room: Room,
  ): Promise<InboundMessage["replyTo"]> {
    if (!this.#context?.config.matrix.includeReplyContext) {
      return undefined;
    }

    const replyEventId = event.replyEventId;
    if (!replyEventId) {
      return undefined;
    }

    const reference = findRoomEvent(room, replyEventId);
    if (!reference) {
      return undefined;
    }

    return matrixEventToReference(reference);
  }

  #fetchChannelContext(
    room: Room,
    currentEventId: string,
  ): ConversationMessage[] | undefined {
    if (!this.#context?.config.matrix.includeChannelContext) {
      return undefined;
    }

    const limit = this.#context.config.matrix.channelContextCount;
    if (limit <= 0) {
      return undefined;
    }

    const botUserId = this.#context.config.matrix.userId;
    return room.getLiveTimeline().getEvents()
      .filter((event) => event.getId() !== currentEventId)
      .filter((event) => event.getType() === EventType.RoomMessage)
      .map(matrixEventToConversationMessage)
      .filter((message): message is ConversationMessage => Boolean(message))
      .slice(-limit)
      .map((message) => ({
        ...message,
        isBot: message.authorId === botUserId,
      }));
  }
}

function isSupportedMessageType(msgtype: unknown): boolean {
  return msgtype === MsgType.Text || msgtype === MsgType.Notice ||
    msgtype === MsgType.Emote;
}

function isMatrixMention(
  content: Record<string, unknown>,
  body: string,
  botUserId: string | undefined,
  displayName: string,
): boolean {
  const mentions = content["m.mentions"];
  if (
    botUserId &&
    mentions &&
    typeof mentions === "object" &&
    Array.isArray((mentions as { user_ids?: unknown }).user_ids) &&
    (mentions as { user_ids: unknown[] }).user_ids.includes(botUserId)
  ) {
    return true;
  }

  return body.toLowerCase().includes(`@${displayName.toLowerCase()}`);
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

  return result
    .replace(new RegExp(`@${escapeRegExp(displayName)}`, "gi"), "")
    .trim();
}

function findRoomEvent(room: Room, eventId: string): MatrixEvent | undefined {
  return room.getLiveTimeline().getEvents().find((event) =>
    event.getId() === eventId
  );
}

function matrixEventToConversationMessage(
  event: MatrixEvent,
): ConversationMessage | undefined {
  const eventId = event.getId();
  const senderId = event.getSender();
  const content = event.getContent();
  const body = typeof content.body === "string" ? content.body.trim() : "";
  if (!eventId || !senderId || !body || !isSupportedMessageType(content.msgtype)) {
    return undefined;
  }

  return {
    id: eventId,
    authorId: senderId,
    authorName: event.sender?.name,
    content: body,
  };
}

function matrixEventToReference(
  event: MatrixEvent,
): InboundMessage["replyTo"] {
  const content = event.getContent();
  return {
    id: event.getId() ?? "",
    authorId: event.getSender() ?? "",
    authorName: event.sender?.name,
    content: typeof content.body === "string" ? content.body : "",
  };
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

function startTyping(
  client: MatrixClient,
  roomId: string,
): { stop(): void } {
  let stopped = false;
  const sendTyping = () => {
    if (stopped) {
      return;
    }
    client.sendTyping(roomId, true, 10000).catch(() => {});
  };

  sendTyping();
  const interval = setInterval(sendTyping, 8000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      client.sendTyping(roomId, false, 0).catch(() => {});
    },
  };
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
    description: "Matrix platform adapter backed by matrix-js-sdk.",
    version: "0.1.0",
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
        description: "Access token for the bot account",
        type: "string",
        required: true,
        secret: true,
      },
      {
        key: "matrix.userId",
        label: "Matrix User ID",
        description: "Example: @missy:matrix.org",
        type: "string",
        required: true,
      },
      {
        key: "matrix.deviceId",
        label: "Matrix Device ID",
        description: "Optional device ID associated with the access token",
        type: "string",
        required: false,
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
