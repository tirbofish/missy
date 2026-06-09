import type { PlatformService } from "../../core/types.ts";

/** Shared interface for Discord operations. Plugins depend on this, not on discord.js. */
export interface DiscordService extends PlatformService {
  readonly platformName: "discord";

  /** React to a message with an emoji. */
  react(channelId: string, messageId: string, emoji: string): Promise<void>;

  /** Remove the bot's reaction from a message. */
  removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;

  /** Send a message to a channel. */
  send(
    channelId: string,
    content: string,
  ): Promise<{ messageId: string }>;

  /** Reply to a specific message. */
  replyTo(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ messageId: string }>;

  /** DM a user by ID. */
  sendDM(userId: string, content: string): Promise<{ messageId: string }>;

  /** Fetch recent messages from a channel, optionally filtering. */
  searchMessages(
    channelId: string,
    options?: SearchMessagesOptions,
  ): Promise<DiscordMessageResult[]>;

  /** Get a member's display name in a guild. */
  getNickname(guildId: string, userId: string): Promise<string | null>;

  /** Set the bot's nickname in a guild (null to reset). */
  setBotNickname(guildId: string, nickname: string | null): Promise<void>;

  /** Get user info by ID. */
  getUserInfo(userId: string): Promise<DiscordUserInfo>;

  /** Pin a message. */
  pinMessage(channelId: string, messageId: string): Promise<void>;

  /** Unpin a message. */
  unpinMessage(channelId: string, messageId: string): Promise<void>;
}

export interface SearchMessagesOptions {
  limit?: number;
  before?: string;
  after?: string;
  authorId?: string;
  contains?: string;
}

export interface DiscordMessageResult {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface DiscordUserInfo {
  id: string;
  username: string;
  displayName: string | null;
  bot: boolean;
}
