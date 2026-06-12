/**
 * DiscordPlatform — Discord platform adapter backed by discord.js.
 */

import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  Partials,
  type TextBasedChannel,
} from "discord.js";
import type { AgentContext, AgentPlatform, ConversationMessage, InboundMessage, MessageAttachment } from "../../../core/types.ts";
import { delay, splitByDelimiter } from "../../../core/helpers.ts";
import type { DiscordPlatformConfig } from "./config.ts";
import { parseDiscordConfig } from "./config.ts";
import { splitDiscordMessage } from "./message-split.ts";
import type { DiscordService, DiscordMessageResult, DiscordUserInfo, SearchMessagesOptions } from "./service.ts";

class DiscordServiceImpl implements DiscordService {
  readonly platformName = "discord" as const;
  readonly #client: Client;

  constructor(client: Client) { this.#client = client; }

  async react(channelId: string, messageId: string, emoji: string): Promise<void> {
    const ch = await this.#fetchTextChannel(channelId);
    const msg = await ch.messages.fetch(messageId);
    await msg.react(emoji);
  }
  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const ch = await this.#fetchTextChannel(channelId);
    const msg = await ch.messages.fetch(messageId);
    const r = msg.reactions.cache.find((r) => r.emoji.name === emoji);
    if (r) await r.users.remove(this.#client.user!.id);
  }
  async send(channelId: string, content: string): Promise<{ messageId: string }> {
    const ch = await this.#fetchTextChannel(channelId);
    const sent = await ch.send(content);
    return { messageId: sent.id };
  }
  async replyTo(channelId: string, messageId: string, content: string): Promise<{ messageId: string }> {
    const ch = await this.#fetchTextChannel(channelId);
    const msg = await ch.messages.fetch(messageId);
    const sent = await msg.reply(content);
    return { messageId: sent.id };
  }
  async sendDM(userId: string, content: string): Promise<{ messageId: string }> {
    const user = await this.#client.users.fetch(userId);
    const sent = await user.send(content);
    return { messageId: sent.id };
  }
  async searchMessages(channelId: string, options?: SearchMessagesOptions): Promise<DiscordMessageResult[]> {
    const ch = await this.#fetchTextChannel(channelId);
    const opts: { limit?: number; before?: string; after?: string } = {};
    if (options?.limit) opts.limit = Math.min(options.limit, 100);
    if (options?.before) opts.before = options.before;
    if (options?.after) opts.after = options.after;
    const msgs = await ch.messages.fetch(opts);
    let results = [...msgs.values()].map((m) => ({
      id: m.id, authorId: m.author.id, authorName: m.author.displayName ?? m.author.username,
      content: m.content, createdAt: m.createdAt.toISOString(),
    }));
    if (options?.authorId) results = results.filter((m) => m.authorId === options.authorId);
    if (options?.contains) results = results.filter((m) => m.content.includes(options.contains!));
    return results;
  }
  async getNickname(guildId: string, userId: string): Promise<string | null> {
    const guild = await this.#client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    return member.nickname ?? member.displayName;
  }
  async setBotNickname(guildId: string, nickname: string | null): Promise<void> {
    const guild = await this.#client.guilds.fetch(guildId);
    await guild.members.me?.setNickname(nickname);
  }
  async getUserInfo(userId: string): Promise<DiscordUserInfo> {
    const user = await this.#client.users.fetch(userId);
    return { id: user.id, username: user.username, displayName: user.displayName, bot: user.bot };
  }
  async pinMessage(channelId: string, messageId: string): Promise<void> {
    const ch = await this.#fetchTextChannel(channelId);
    const msg = await ch.messages.fetch(messageId);
    await msg.pin();
  }
  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    const ch = await this.#fetchTextChannel(channelId);
    const msg = await ch.messages.fetch(messageId);
    await msg.unpin();
  }
  async #fetchTextChannel(channelId: string): Promise<TextBasedChannel> {
    const ch = await this.#client.channels.fetch(channelId);
    if (!ch?.isTextBased()) throw new Error(`Channel ${channelId} is not text-based`);
    return ch;
  }
}

export class DiscordPlatform implements AgentPlatform {
  readonly name = "discord";

  getSystemContext(): string {
    return [
      "<platform>",
      "  <name>Discord</name>",
      "  <description>You are communicating through Discord, a popular chat platform with guilds, channels, and threads.</description>",
      "  <capabilities>",
      "    <capability>Text channels, voice channels, forums, and threads</capability>",
      "    <capability>Slash commands and context menus</capability>",
      "    <capability>Message reactions</capability>",
      "    <capability>File attachments</capability>",
      "    <capability>Message replies</capability>",
      "    <capability>Typing indicators</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">~2000 characters per message</limit>",
      "    <limit name=\"attachment_size\">~25 MB per file</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In guild channels, you only respond when @mentioned or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  #client?: Client;
  #context?: AgentContext;
  #discordConfig?: DiscordPlatformConfig;
  #botUserId?: string;
  #channelContext = new Map<string, ConversationMessage[]>();

  async start(context: AgentContext): Promise<void> {
    this.#context = context;
    this.#discordConfig = parseDiscordConfig(context.config);
    if (!this.#discordConfig.token) throw new Error("DISCORD_TOKEN is required when the discord platform is enabled.");

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel],
    });
    this.#client = client;

    client.on(Events.ClientReady, () => {
      this.#botUserId = client.user?.id;
      context.logger.info(`Discord logged in as ${client.user?.tag ?? this.#botUserId}`);
    });

    client.on(Events.MessageCreate, (message: Message) => {
      this.#handleDiscordMessage(message).catch((error) => context.logger.error("Failed to handle Discord message", error));
    });

    await client.login(this.#discordConfig.token);

    context.platformServices.register("discord", new DiscordServiceImpl(client));
    context.logger.info("Discord platform started");
  }

  async stop(): Promise<void> {
    this.#client?.destroy();
    this.#client = undefined;
    this.#botUserId = undefined;
    this.#channelContext.clear();
  }

  async #handleDiscordMessage(message: Message): Promise<void> {
    if (!this.#context || !this.#client) return;
    if (message.author.id === this.#botUserId) return;

    const content = message.content?.trim() ?? "";
    const attachments = message.attachments.map((a) => ({
      id: a.id, contentType: a.contentType, name: a.name, size: a.size, url: a.url,
      width: a.width ?? undefined, height: a.height ?? undefined,
    } satisfies MessageAttachment));

    const isDM = message.channel.type === ChannelType.DM;
    const prefix = this.#discordConfig.commandPrefix;
    const botMentioned = message.mentions.users.has(this.#botUserId!);
    const isPrefixCommand = prefix && content.startsWith(prefix);

    if (!isDM && !botMentioned && !isPrefixCommand) return;

    let messageContent = content;
    if (isPrefixCommand) {
      messageContent = content.slice(prefix.length).trim();
    } else if (botMentioned && !isDM) {
      messageContent = cleanMentionContent(content, this.#botUserId);
    }

    if (await this.#handleLocalCommand(messageContent, message)) return;

    if (!messageContent && attachments.length === 0) {
      await replyToMessage(message, "What do you need?");
      return;
    }

    const typing = startTyping(message.channel);
    const inbound: InboundMessage = {
      id: message.id,
      platform: this.name,
      channelId: message.channel.id,
      channelType: isDM ? "dm" : resolveChannelType(message.channel.type),
      guildId: message.guild?.id,
      authorId: message.author.id,
      authorName: message.author.displayName ?? message.author.username,
      content: messageContent || content,
      attachments: attachments.length > 0 ? attachments : undefined,
      context: undefined,
      replyTo: await this.#buildReplyReference(message),
      reply: async (replyContent) => {
        await replyMultiMessage(message, replyContent,
          this.#discordConfig?.multiMessageDelimiter ?? "|||",
          this.#discordConfig?.multiMessageDelayMs ?? 1500,
          this.#discordConfig?.maxMessageLength ?? 0);
      },
      timestamp: message.createdTimestamp,
    };

    try {
      await this.#context.handleMessage(inbound);
    } finally {
      typing.stop();
    }
  }

  async #handleLocalCommand(content: string, message: Message): Promise<boolean> {
    const [command = "", ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "help" || normalized === "commands") {
      await replyToMessage(message, ["Commands:", "help, status, tools, plugins, memory, memory all, session, session new [name], or any message."].join("\n"));
      return true;
    }
    if (normalized === "status") { await replyToMessage(message, this.#formatStatus()); return true; }
    if (normalized === "tools") { await replyToMessage(message, this.#formatTools()); return true; }
    if (normalized === "plugins") { await replyToMessage(message, this.#formatPlugins()); return true; }
    if (normalized === "memory" || normalized === "mem") {
      await replyToMessage(message, this.#formatMemory(message.author.id, args[0]?.toLowerCase() === "all"));
      return true;
    }
    return false;
  }

  // ─── Formatters ──────────────────────────────────────────────────────

  #formatTools(): string {
    if (!this.#context) return "Missy is not ready.";
    const tools = this.#context.tools.list();
    if (tools.length === 0) return "No tools are registered.";
    return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  }
  #formatPlugins(): string {
    if (!this.#context) return "Missy is not ready.";
    if (this.#context.plugins.length === 0) return "No plugins are loaded.";
    return this.#context.plugins.map((p) => `- ${p.name} v${p.version}: ${p.description}`).join("\n");
  }
  #formatMemory(userId: string, includeAll: boolean): string {
    if (!this.#context) return "Missy is not ready.";
    if (!this.#context.config.memory.enabled) return "Memory is disabled.";
    if (includeAll) {
      const all = this.#context.memory.getAllMemory();
      const lines = Object.entries(all).flatMap(([uid, r]) => r.map((rec) => `- ${uid}.${rec.key}: ${rec.value}`));
      return lines.length > 0 ? lines.join("\n") : "No memory stored.";
    }
    const records = this.#context.memory.getUserMemory(userId);
    return records.length > 0 ? records.map((r) => `- ${r.key}: ${r.value}`).join("\n") : "No memory stored for you yet.";
  }
  #formatStatus(): string {
    if (!this.#context) return "Missy is not ready.";
    return [`Missy is online.`, `Tools: ${this.#context.tools.list().length}`, `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`, `Reply mode: ${this.#context.config.replyMode}`].join("\n");
  }

  async #buildReplyReference(message: Message): Promise<InboundMessage["replyTo"]> {
    if (!this.#discordConfig?.includeReplyContext) return undefined;
    const ref = message.reference;
    if (!ref?.messageId) return undefined;
    try {
      const replied = await message.channel.messages.fetch(ref.messageId);
      if (!replied) return undefined;
      return {
        id: replied.id, authorId: replied.author.id,
        authorName: replied.author.displayName ?? replied.author.username,
        content: replied.content, timestamp: replied.createdTimestamp,
      };
    } catch { return undefined; }
  }
}

// ─── Free functions ──────────────────────────────────────────────────────

function resolveChannelType(type: ChannelType): string {
  switch (type) {
    case ChannelType.DM: return "dm";
    case ChannelType.GuildText: case ChannelType.GuildAnnouncement: return "text";
    case ChannelType.PublicThread: case ChannelType.PrivateThread: case ChannelType.AnnouncementThread: return "thread";
    case ChannelType.GuildForum: return "forum";
    default: return "text";
  }
}

function cleanMentionContent(body: string, botUserId?: string): string {
  let result = body.trim();
  if (botUserId) {
    result = result.replace(new RegExp(`<@!?${botUserId}>`, "g"), "");
  }
  return result.trim();
}

async function replyToMessage(message: Message, content: string): Promise<void> {
  for (const chunk of splitDiscordMessage(content)) {
    await message.reply(chunk);
  }
}

function startTyping(channel: TextBasedChannel): { stop(): void } {
  let stopped = false;
  const sendTyping = () => { if (!stopped) channel.sendTyping().catch(() => {}); };
  sendTyping();
  const interval = setInterval(sendTyping, 8000);
  return {
    stop() { stopped = true; clearInterval(interval); },
  };
}

async function replyMultiMessage(
  message: Message, content: string, delimiter: string, delayMs: number, maxLength?: number,
): Promise<void> {
  const parts = splitByDelimiter(content, delimiter);
  if (parts.length <= 1) { await replyToMessage(message, content); return; }
  await replyToMessage(message, parts[0]);
  for (const part of parts.slice(1)) { await delay(delayMs); await message.channel.send(part); }
}
