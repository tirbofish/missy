import {
  ApplicationCommandOptionType,
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
  PlatformModule,
} from "../../core/types.ts";
import { splitDiscordMessage } from "./message-split.ts";
import type {
  DiscordMessageResult,
  DiscordService,
  DiscordUserInfo,
  SearchMessagesOptions,
} from "./service.ts";

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
  #client?: Client;
  #context?: AgentContext;

  async start(context: AgentContext): Promise<void> {
    const token = context.config.discord.token;
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
    const prefix = this.#context.config.discord.commandPrefix;
    const isPrefixCommand = message.content.trimStart().startsWith(prefix);
    const isReplyToBot = await this.#isReplyToBot(message);
    const shouldHandleServerMessage = mentioned || isPrefixCommand ||
      isReplyToBot ||
      this.#context.config.discord.respondToAllMessages;

    if (this.#context.config.discord.reactToAllMessages) {
      await this.#reactToMessage(message);
    }

    if (
      this.#context.config.discord.mentionOnly && !shouldHandleServerMessage &&
      message.guild
    ) {
      return;
    }

    const content = isPrefixCommand
      ? message.content.trimStart().slice(prefix.length).trim()
      : cleanMentionContent(message.content, botUser?.id);

    if (isPrefixCommand && await this.#handleLocalCommand(content, message)) {
      return;
    }

    if (!content) {
      await replyToMessage(message, "What do you need?");
      return;
    }

    if (
      this.#context.config.discord.reactToHandledMessages &&
      !this.#context.config.discord.reactToAllMessages
    ) {
      await this.#reactToMessage(message);
    }

    const typing = startTyping(message);

    const context = await this.#fetchChannelContext(message);

    const inbound: InboundMessage = {
      id: message.id,
      platform: this.name,
      channelId: message.channelId,
      guildId: message.guildId ?? undefined,
      authorId: message.author.id,
      authorName: message.author.username,
      content,
      context,
      replyTo: await this.#buildReplyReference(message),
      reply: async (content) => {
        await replyToMessage(
          message,
          content,
          this.#context?.config.discord.maxMessageLength,
        );
      },
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
      guildId: interaction.guildId ?? undefined,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      content,
      reply: async (replyContent) => {
        await followUpInteraction(
          interaction,
          replyContent,
          this.#context?.config.discord.maxMessageLength,
        );
      },
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
          `${this.#context?.config.discord.commandPrefix} help`,
          `${this.#context?.config.discord.commandPrefix} status`,
          `${this.#context?.config.discord.commandPrefix} memory`,
          `${this.#context?.config.discord.commandPrefix} memory all`,
          `${this.#context?.config.discord.commandPrefix} plugins`,
          `${this.#context?.config.discord.commandPrefix} tools`,
          `${this.#context?.config.discord.commandPrefix} <message for Missy>`,
          "/missy message:<message for Missy>",
          "/memory",
          "/plugins",
          "/tools",
          "/status",
        ].join("\n"),
        this.#context?.config.discord.maxMessageLength,
      );
      return true;
    }

    if (normalized === "status") {
      await replyToMessage(
        message,
        this.#formatStatus(),
        this.#context?.config.discord.maxMessageLength,
      );
      return true;
    }

    if (normalized === "tools") {
      await replyToMessage(
        message,
        this.#formatTools(),
        this.#context?.config.discord.maxMessageLength,
      );
      return true;
    }

    if (normalized === "plugins") {
      await replyToMessage(
        message,
        this.#formatPlugins(),
        this.#context?.config.discord.maxMessageLength,
      );
      return true;
    }

    if (normalized === "memory" || normalized === "mem") {
      await replyToMessage(
        message,
        this.#formatMemory(message.author.id, args[0]?.toLowerCase() === "all"),
        this.#context?.config.discord.maxMessageLength,
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
      `Server routing: ${
        this.#context.config.discord.respondToAllMessages
          ? "all messages"
          : "mentions, replies, and prefix"
      }`,
      `Reply context: ${
        this.#context.config.discord.includeReplyContext
          ? "enabled"
          : "disabled"
      }`,
      `Reaction events: ${
        this.#context.config.discord.observeReactions ? "enabled" : "disabled"
      }`,
      `React to all messages: ${
        this.#context.config.discord.reactToAllMessages ? "enabled" : "disabled"
      }`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }

  async #reactToMessage(message: Message): Promise<void> {
    await message.react(
      this.#context?.config.discord.handledReactionEmoji ?? "\u{1F440}",
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
      !this.#context?.config.discord.includeReplyContext ||
      !message.reference?.messageId
    ) {
      return undefined;
    }

    try {
      const reference = await message.fetchReference();
      return {
        id: reference.id,
        authorId: reference.author.id,
        authorName: reference.author.username,
        content: reference.content,
      };
    } catch (error) {
      this.#context.logger.warn("Failed to fetch Discord reply context", error);
      return undefined;
    }
  }

  async #fetchChannelContext(
    message: Message,
  ): Promise<ConversationMessage[] | undefined> {
    if (!this.#context?.config.discord.includeChannelContext) {
      return undefined;
    }

    const limit = this.#context.config.discord.channelContextCount;
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
          isBot: m.author.id === botId,
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

    if (!this.#context?.config.discord.observeReactions || fullUser.bot) {
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
      },
      reply: async (content) => {
        if ("send" in message.channel) {
          for (
            const chunk of splitDiscordMessage(
              content,
              this.#context?.config.discord.maxMessageLength,
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
