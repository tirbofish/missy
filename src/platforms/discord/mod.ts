import {
  ApplicationCommandOptionType,
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  Partials,
  type PartialUser,
  type TextBasedChannel,
  type User,
} from "discord.js";
import type {
  AgentContext,
  AgentPlatform,
  ConfigSchema,
  ConversationMessage,
  InboundMessage,
  MessageAttachment,
  PlatformModule,
} from "../../core/types.ts";
import type { AppConfig } from "../../core/config.ts";
import { splitDiscordMessage } from "./message-split.ts";
import type {
  DiscordMessageResult,
  DiscordService,
  DiscordUserInfo,
  SearchMessagesOptions,
} from "./service.ts";

interface DiscordPlatformConfig {
  token?: string;
  commandPrefix: string;
  mentionOnly: boolean;
  respondToAllMessages: boolean;
  maxMessageLength: number;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  observeReactions: boolean;
  reactToAllMessages: boolean;
  reactToHandledMessages: boolean;
  handledReactionEmoji: string;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
}

function parseDiscordConfig(config: AppConfig): DiscordPlatformConfig {
  const d = (config.data.discord ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    token: (d.token as string) ?? env["DISCORD_TOKEN"],
    commandPrefix: (d.commandPrefix as string) ?? env["DISCORD_COMMAND_PREFIX"] ?? "!M!",
    mentionOnly: typeof d.mentionOnly === "boolean" ? d.mentionOnly : true,
    respondToAllMessages: typeof d.respondToAllMessages === "boolean" ? d.respondToAllMessages : false,
    maxMessageLength: typeof d.maxMessageLength === "number" ? d.maxMessageLength : 0,
    includeReplyContext: typeof d.includeReplyContext === "boolean" ? d.includeReplyContext : true,
    includeChannelContext: typeof d.includeChannelContext === "boolean" ? d.includeChannelContext : true,
    channelContextCount: typeof d.channelContextCount === "number" ? d.channelContextCount : 10,
    observeReactions: typeof d.observeReactions === "boolean" ? d.observeReactions : false,
    reactToAllMessages: typeof d.reactToAllMessages === "boolean" ? d.reactToAllMessages : false,
    reactToHandledMessages: typeof d.reactToHandledMessages === "boolean" ? d.reactToHandledMessages : false,
    handledReactionEmoji: (d.handledReactionEmoji as string) ?? env["DISCORD_HANDLED_REACTION_EMOJI"] ?? "\u{1F440}",
    multiMessageDelimiter: (d.multiMessageDelimiter as string) ?? env["DISCORD_MULTI_MESSAGE_DELIMITER"] ?? "|||",
    multiMessageDelayMs: typeof d.multiMessageDelayMs === "number" ? d.multiMessageDelayMs : 1500,
  };
}

class DiscordServiceImpl implements DiscordService {
  readonly platformName = "discord" as const;

  constructor(private client: Client) {}

  async react(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const channel = await this.#fetchTextChannel(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.react(emoji);
  }

  async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const channel = await this.#fetchTextChannel(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.reactions.resolve(emoji)?.users.remove(this.client.user!.id);
  }

  async send(
    channelId: string,
    content: string,
  ): Promise<{ messageId: string }> {
    const channel = await this.#fetchTextChannel(channelId);
    const sent = await channel.send(content);
    return { messageId: sent.id };
  }

  async replyTo(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ messageId: string }> {
    const channel = await this.#fetchTextChannel(channelId);
    const msg = await channel.messages.fetch(messageId);
    const sent = await msg.reply(content);
    return { messageId: sent.id };
  }

  async sendDM(
    userId: string,
    content: string,
  ): Promise<{ messageId: string }> {
    const user = await this.client.users.fetch(userId);
    const sent = await user.send(content);
    return { messageId: sent.id };
  }

  async searchMessages(
    channelId: string,
    options?: SearchMessagesOptions,
  ): Promise<DiscordMessageResult[]> {
    const channel = await this.#fetchTextChannel(channelId);
    const messages = await channel.messages.fetch({
      limit: Math.min(options?.limit ?? 50, 100),
      before: options?.before,
      after: options?.after,
    });

    let results = [...messages.values()];

    if (options?.authorId) {
      results = results.filter((m) => m.author.id === options.authorId);
    }
    if (options?.contains) {
      const search = options.contains.toLowerCase();
      results = results.filter((m) =>
        m.content.toLowerCase().includes(search)
      );
    }

    return results.map((m) => ({
      id: m.id,
      authorId: m.author.id,
      authorName: m.author.username,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async getNickname(
    guildId: string,
    userId: string,
  ): Promise<string | null> {
    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    return member.nickname;
  }

  async setBotNickname(
    guildId: string,
    nickname: string | null,
  ): Promise<void> {
    const guild = await this.client.guilds.fetch(guildId);
    const me = await guild.members.fetchMe();
    await me.setNickname(nickname);
  }

  async getUserInfo(userId: string): Promise<DiscordUserInfo> {
    const user = await this.client.users.fetch(userId);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? null,
      bot: user.bot,
    };
  }

  async pinMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.#fetchTextChannel(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.pin();
  }

  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.#fetchTextChannel(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.unpin();
  }

  async #fetchTextChannel(channelId: string): Promise<TextBasedChannel & { messages: any }> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text channel.`);
    }
    return channel as TextBasedChannel & { messages: any };
  }
}

class DiscordPlatform implements AgentPlatform {
  readonly name = "discord";

  getSystemContext(): string {
    return [
      "<platform>",
      "  <name>Discord</name>",
      "  <description>You are communicating through Discord, a chat platform with servers, channels, DMs, and threads.</description>",
      "  <capabilities>",
      "    <capability>Server channels (text, announcement, forum, thread)</capability>",
      "    <capability>Direct messages and group DMs</capability>",
      "    <capability>Slash commands (/missy, /memory, /tools, /plugins, /status)</capability>",
      "    <capability>Emoji reactions</capability>",
      "    <capability>Message replies and pinning</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">2000 characters per message</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In servers, you only respond when @mentioned or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  #client?: Client;
  #context?: AgentContext;
  #discordConfig?: DiscordPlatformConfig;

  async start(context: AgentContext): Promise<void> {
    const config = parseDiscordConfig(context.config);
    this.#discordConfig = config;
    const token = config.token;
    if (!token) {
      throw new Error(
        "DISCORD_TOKEN is required when the discord platform is enabled.",
      );
    }

    this.#context = context;
    this.#client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
      ],
    });

    this.#client.once(Events.ClientReady, (client) => {
      context.logger.info(`Discord logged in as ${client.user.tag}`);
      this.#registerSlashCommands().catch((error) =>
        context.logger.error("Failed to register Discord slash commands", error)
      );
    });

    this.#client.on(Events.MessageCreate, (message) => {
      this.#handleDiscordMessage(message).catch((error) =>
        context.logger.error("Failed to handle Discord message", error)
      );
    });

    this.#client.on(Events.InteractionCreate, (interaction) => {
      this.#handleInteraction(interaction).catch((error) =>
        context.logger.error("Failed to handle Discord interaction", error)
      );
    });

    this.#client.on(Events.MessageReactionAdd, (reaction, user) => {
      this.#handleReaction(reaction, user).catch((error) =>
        context.logger.error("Failed to handle Discord reaction", error)
      );
    });

    await this.#client.login(token);

    // Expose Discord operations to plugins via the platform service registry
    context.platformServices.register(
      "discord",
      new DiscordServiceImpl(this.#client),
    );
  }

  async stop(): Promise<void> {
    this.#client?.destroy();
    this.#client = undefined;
  }

  async #handleDiscordMessage(message: Message): Promise<void> {
    if (!this.#context || message.author.bot || !message.content.trim()) {
      return;
    }

    const botUser = this.#client?.user;
    const mentioned = botUser ? message.mentions.has(botUser) : false;
    const prefix = this.#discordConfig.commandPrefix;
    const isPrefixCommand = prefix
      ? message.content.trimStart().startsWith(prefix)
      : false;

    if (this.#discordConfig.reactToAllMessages) {
      await this.#reactToMessage(message);
    }

    if (message.guild && !mentioned) {
      return;
    }

    const routedContent = isPrefixCommand
      ? message.content.trimStart().slice(prefix.length).trim()
      : cleanMentionContent(message.content, botUser?.id);
    const content = prefix && routedContent.startsWith(prefix)
      ? routedContent.slice(prefix.length).trim()
      : routedContent;

    if (
      (isPrefixCommand || mentioned || !message.guild) &&
      await this.#handleLocalCommand(content, message)
    ) {
      return;
    }

    if (!content) {
      await replyToMessage(message, "What do you need?");
      return;
    }

    if (
      this.#discordConfig.reactToHandledMessages &&
      !this.#discordConfig.reactToAllMessages
    ) {
      await this.#reactToMessage(message);
    }

    const typing = startTyping(message);

    const context = await this.#fetchChannelContext(message);

    const inbound: InboundMessage = {
      id: message.id,
      platform: this.name,
      channelId: message.channelId,
      channelType: resolveChannelType(message.channel.type),
      guildId: message.guildId ?? undefined,
      authorId: message.author.id,
      authorName: message.author.username,
      content,
      attachments: message.attachments.size > 0
        ? message.attachments.map((a) => ({
          id: a.id,
          contentType: a.contentType ?? undefined,
          name: a.name ?? undefined,
          size: a.size,
          url: a.url,
          width: a.width ?? undefined,
          height: a.height ?? undefined,
        }))
        : undefined,
      context,
      replyTo: await this.#buildReplyReference(message),
      reply: async (content) => {
        await replyMultiMessage(
          message,
          content,
          this.#discordConfig?.multiMessageDelimiter ?? "|||",
          this.#discordConfig?.multiMessageDelayMs ?? 1500,
          this.#discordConfig?.maxMessageLength,
        );
      },
      timestamp: message.createdTimestamp,
    };

    try {
      await this.#context.handleMessage(inbound);
    } finally {
      typing.stop();
    }
  }

  async #handleInteraction(interaction: Interaction): Promise<void> {
    if (!this.#context || !interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "tools") {
      await replyToInteraction(interaction, this.#formatTools());
      return;
    }

    if (interaction.commandName === "plugins") {
      await replyToInteraction(interaction, this.#formatPlugins());
      return;
    }

    if (interaction.commandName === "memory") {
      const scope = interaction.options.getString("scope") ?? "mine";
      await replyToInteraction(
        interaction,
        this.#formatMemory(interaction.user.id, scope === "all"),
      );
      return;
    }

    if (interaction.commandName === "status") {
      await replyToInteraction(interaction, this.#formatStatus());
      return;
    }

    if (interaction.commandName !== "missy") {
      return;
    }

    const content = interaction.options.getString("message", true).trim();
    await interaction.deferReply();

    const inbound: InboundMessage = {
      id: interaction.id,
      platform: this.name,
      channelId: interaction.channelId,
      channelType: interaction.channel ? resolveChannelType(interaction.channel.type) : undefined,
      guildId: interaction.guildId ?? undefined,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      content,
      reply: async (replyContent) => {
        await followUpMultiMessage(
          interaction,
          replyContent,
          this.#discordConfig?.multiMessageDelimiter ?? "|||",
          this.#discordConfig?.multiMessageDelayMs ?? 1500,
          this.#discordConfig?.maxMessageLength,
        );
      },
      timestamp: interaction.createdTimestamp,
    };

    await this.#context.handleMessage(inbound);
  }

  async #handleLocalCommand(
    content: string,
    message: Message,
  ): Promise<boolean> {
    const [command = ""] = content.split(/\s+/);
    const [, ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "help" || normalized === "commands") {
      await replyToMessage(
        message,
        [
          "Commands:",
          "DMs: help, status, memory, memory all, plugins, tools, or any message.",
          "Servers: mention Missy with help, status, memory, plugins, tools, or a message.",
          "/missy message:<message for Missy>",
          "/memory",
          "/plugins",
          "/tools",
          "/status",
        ].join("\n"),
        this.#discordConfig?.maxMessageLength,
      );
      return true;
    }

    if (normalized === "status") {
      await replyToMessage(
        message,
        this.#formatStatus(),
        this.#discordConfig?.maxMessageLength,
      );
      return true;
    }

    if (normalized === "tools") {
      await replyToMessage(
        message,
        this.#formatTools(),
        this.#discordConfig?.maxMessageLength,
      );
      return true;
    }

    if (normalized === "plugins") {
      await replyToMessage(
        message,
        this.#formatPlugins(),
        this.#discordConfig?.maxMessageLength,
      );
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await replyToMessage(
        message,
        this.#formatMemory(message.author.id, args[0]?.toLowerCase() === "all"),
        this.#discordConfig?.maxMessageLength,
      );
      return true;
    }

    return false;
  }

  async #registerSlashCommands(): Promise<void> {
    if (!this.#client?.application) {
      return;
    }

    await this.#client.application.commands.set([
      {
        name: "missy",
        description: "Ask Missy something.",
        options: [
          {
            name: "message",
            description: "What you want to ask Missy.",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "tools",
        description: "List Missy's available tools.",
      },
      {
        name: "plugins",
        description: "List Missy's loaded plugins.",
      },
      {
        name: "memory",
        description: "Show stored memory.",
        options: [
          {
            name: "scope",
            description: "Whose memory to show.",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: "mine", value: "mine" },
              { name: "all", value: "all" },
            ],
          },
        ],
      },
      {
        name: "status",
        description: "Show Missy's Discord platform status.",
      },
    ]);
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
      `DMs: enabled`,
      "Server routing: direct mentions only",
      `Reply context: ${
        this.#discordConfig.includeReplyContext
          ? "enabled"
          : "disabled"
      }`,
      `Reaction events: ${
        this.#discordConfig.observeReactions ? "enabled" : "disabled"
      }`,
      `React to all messages: ${
        this.#discordConfig.reactToAllMessages ? "enabled" : "disabled"
      }`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }

  async #reactToMessage(message: Message): Promise<void> {
    await message.react(
      this.#discordConfig?.handledReactionEmoji ?? "\u{1F440}",
    )
      .catch((error) =>
        this.#context?.logger.warn("Failed to react to message", error)
      );
  }

  async #isReplyToBot(message: Message): Promise<boolean> {
    const botUserId = this.#client?.user?.id;
    if (!botUserId || !message.reference?.messageId) {
      return false;
    }

    try {
      const reference = await message.fetchReference();
      return reference.author.id === botUserId;
    } catch {
      return false;
    }
  }

  async #buildReplyReference(
    message: Message,
  ): Promise<InboundMessage["replyTo"]> {
    if (
      !this.#discordConfig?.includeReplyContext ||
      !message.reference?.messageId
    ) {
      return undefined;
    }

    return await this.#walkReplyChain(
      message.reference.messageId,
      message.reference.channelId ?? message.channelId,
      5, // max depth to avoid infinite loops
    );
  }

  /**
   * Walk the reply chain backwards, building a nested replyTo structure.
   * Each level fetches the parent message; if that message is itself a reply,
   * the chain continues up to `maxDepth` levels.
   */
  async #walkReplyChain(
    messageId: string,
    channelId: string,
    maxDepth: number,
  ): Promise<InboundMessage["replyTo"]> {
    try {
      const channel = await this.#client?.channels.fetch(channelId);
      if (!channel?.isTextBased()) return undefined;

      const msg = await (channel as TextBasedChannel & { messages: any }).messages.fetch(messageId);
      if (!msg) return undefined;

      const ref: InboundMessage["replyTo"] = {
        id: msg.id,
        authorId: msg.author.id,
        authorName: msg.author.username,
        content: msg.content,
        timestamp: msg.createdTimestamp,
      };

      // Walk further up the chain if this message is also a reply
      if (maxDepth > 1 && msg.reference?.messageId) {
        const parentId = msg.reference.messageId;
        const parentChannelId = msg.reference.channelId ?? (channel as { id: string }).id;
        ref.replyTo = await this.#walkReplyChain(parentId, parentChannelId, maxDepth - 1);
      }

      return ref;
    } catch (error) {
      this.#context?.logger.debug("Failed to walk Discord reply chain", error);
      return undefined;
    }
  }

  async #fetchChannelContext(
    message: Message,
  ): Promise<ConversationMessage[] | undefined> {
    if (!this.#discordConfig?.includeChannelContext) {
      return undefined;
    }

    const limit = this.#discordConfig.channelContextCount;
    if (limit <= 0) {
      return undefined;
    }

    try {
      const channel = message.channel;
      if (!channel.isTextBased()) {
        return undefined;
      }

      const messages = await channel.messages.fetch({
        limit,
        before: message.id,
      });

      const botId = this.#client?.user?.id;

      return [...messages.values()]
        .reverse()
        .map((m) => ({
          id: m.id,
          authorId: m.author.id,
          authorName: m.author.username,
          content: m.content,
          attachments: m.attachments.size > 0
            ? m.attachments.map((a) => ({
              id: a.id,
              contentType: a.contentType ?? undefined,
              name: a.name ?? undefined,
              size: a.size,
              url: a.url,
              width: a.width ?? undefined,
              height: a.height ?? undefined,
            }))
            : undefined,
          isBot: m.author.id === botId,
          timestamp: m.createdTimestamp,
        }));
    } catch (error) {
      this.#context.logger.warn("Failed to fetch channel context", error);
      return undefined;
    }
  }

  async #handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    const fullUser: User = user.partial ? await user.fetch() : user;

    if (!this.#discordConfig?.observeReactions || fullUser.bot) {
      return;
    }

    const botUserId = this.#client?.user?.id;
    if (!botUserId) {
      return;
    }

    const fullReaction: MessageReaction = reaction.partial
      ? await reaction.fetch()
      : reaction;
    const message = fullReaction.message;
    if (message.author?.id !== botUserId) {
      return;
    }

    const inbound: InboundMessage = {
      id: `${message.id}:${fullReaction.emoji.identifier}:${fullUser.id}`,
      platform: this.name,
      channelId: message.channelId,
      channelType: message.channel ? resolveChannelType(message.channel.type) : undefined,
      guildId: message.guildId ?? undefined,
      authorId: fullUser.id,
      authorName: fullUser.username,
      content:
        `User reacted to Missy's message with ${fullReaction.emoji.toString()}. Original message: ${message.content}`,
      replyTo: {
        id: message.id,
        authorId: botUserId,
        authorName: this.#client?.user?.username,
        content: message.content ?? "",
        timestamp: message.createdTimestamp,
      },
      reply: async (content) => {
        if ("send" in message.channel) {
          for (
            const chunk of splitDiscordMessage(
              content,
              this.#discordConfig?.maxMessageLength,
            )
          ) {
            await message.channel.send(chunk);
          }
        }
      },
    };

    await this.#context.handleMessage(inbound);
  }
}

function resolveChannelType(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.DM:
      return "dm";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GroupDM:
      return "group-dm";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.AnnouncementThread:
      return "announcement-thread";
    case ChannelType.PublicThread:
      return "thread";
    case ChannelType.PrivateThread:
      return "private-thread";
    case ChannelType.GuildStageVoice:
      return "stage";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildMedia:
      return "media";
    default:
      return "unknown";
  }
}

function cleanMentionContent(
  content: string,
  botUserId: string | undefined,
): string {
  if (!botUserId) {
    return content.trim();
  }

  return content
    .replaceAll(`<@${botUserId}>`, "")
    .replaceAll(`<@!${botUserId}>`, "")
    .trim();
}

async function replyToMessage(
  message: Message,
  content: string,
  maxLength = 0,
): Promise<void> {
  const effectiveMax = maxLength > 0 ? maxLength : 2000;
  const chunks = splitDiscordMessage(content, effectiveMax);
  const [first = ""] = chunks;
  await message.reply(first);

  for (const chunk of chunks.slice(1)) {
    if ("send" in message.channel) {
      await message.channel.send(chunk);
    } else {
      await message.reply(chunk);
    }
  }
}

function startTyping(message: Message): { stop(): void } {
  if (!("sendTyping" in message.channel)) {
    return { stop: () => {} };
  }

  let stopped = false;
  const sendTyping = () => {
    if (stopped || !("sendTyping" in message.channel)) {
      return;
    }

    message.channel.sendTyping().catch(() => {});
  };

  sendTyping();
  const interval = setInterval(sendTyping, 8000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

async function replyToInteraction(
  interaction: ChatInputCommandInteraction,
  content: string,
  maxLength = 0,
): Promise<void> {
  const effectiveMax = maxLength > 0 ? maxLength : 2000;
  const chunks = splitDiscordMessage(content, effectiveMax);
  const [first = ""] = chunks;
  await interaction.reply(first);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

async function followUpInteraction(
  interaction: ChatInputCommandInteraction,
  content: string,
  maxLength = 0,
): Promise<void> {
  const effectiveMax = maxLength > 0 ? maxLength : 2000;
  const chunks = splitDiscordMessage(content, effectiveMax);
  const [first = ""] = chunks;
  await interaction.editReply(first);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split content by the multi-message delimiter, then send each part as a
 * separate message with typing indicators and a delay between them.
 */
async function replyMultiMessage(
  message: Message,
  content: string,
  delimiter: string,
  delayMs: number,
  maxLength = 0,
): Promise<void> {
  const parts = splitByDelimiter(content, delimiter);

  if (parts.length <= 1) {
    await replyToMessage(message, content, maxLength);
    return;
  }

  // First part is sent as a reply
  await replyToMessage(message, parts[0], maxLength);

  // Subsequent parts are sent as separate channel messages with a delay
  for (const part of parts.slice(1)) {
    if ("sendTyping" in message.channel) {
      await message.channel.sendTyping().catch(() => {});
    }
    await delay(delayMs);
    const effectiveMax = maxLength > 0 ? maxLength : 2000;
    const chunks = splitDiscordMessage(part, effectiveMax);
    for (const chunk of chunks) {
      if ("send" in message.channel) {
        await message.channel.send(chunk);
      } else {
        await message.reply(chunk);
      }
    }
  }
}

/**
 * Split content by the multi-message delimiter, then send each part as a
 * separate follow-up with typing delays between them.
 */
async function followUpMultiMessage(
  interaction: ChatInputCommandInteraction,
  content: string,
  delimiter: string,
  delayMs: number,
  maxLength = 0,
): Promise<void> {
  const parts = splitByDelimiter(content, delimiter);

  if (parts.length <= 1) {
    await followUpInteraction(interaction, content, maxLength);
    return;
  }

  // First part edits the deferred reply
  await followUpInteraction(interaction, parts[0], maxLength);

  // Subsequent parts are follow-ups with delays
  for (const part of parts.slice(1)) {
    await delay(delayMs);
    const effectiveMax = maxLength > 0 ? maxLength : 2000;
    const chunks = splitDiscordMessage(part, effectiveMax);
    for (const chunk of chunks) {
      await interaction.followUp(chunk);
    }
  }
}

/** Split content by delimiter, trimming each part and dropping empties. */
function splitByDelimiter(content: string, delimiter: string): string[] {
  return content
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const module: PlatformModule = {
  metadata: {
    name: "discord",
    description: "Discord platform adapter backed by discord.js.",
    version: "0.1.0",
  },
  configSchema: {
    module: "discord",
    label: "Discord Platform",
    fields: [
      {
        key: "discord.token",
        label: "Discord Bot Token",
        description: "Your Discord bot token",
        type: "string",
        required: true,
        secret: true,
      },
      {
        key: "discord.commandPrefix",
        label: "Command Prefix",
        description: "Prefix for text commands",
        type: "string",
        required: false,
        default: "!M!",
      },
      {
        key: "discord.mentionOnly",
        label: "Mention Only",
        description: "Only respond when @mentioned",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "discord.respondToAllMessages",
        label: "Respond to All Messages",
        description: "Respond to every message in the server",
        type: "boolean",
        required: false,
        default: false,
        hidden: true,
      },
      {
        key: "discord.maxMessageLength",
        label: "Max Message Length",
        description: "Maximum characters per Discord message",
        type: "number",
        required: false,
        default: 0,
        hidden: true,
      },
    ],
  },
  createPlatform: () => new DiscordPlatform(),
};

export default module;
