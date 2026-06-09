import type { PluginModule } from "../../core/types.ts";
import type { DiscordService } from "../../platforms/discord/service.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const module: PluginModule = {
  metadata: {
    name: "discord-tools",
    description:
      "Registers AI-callable tools for Discord actions (react, DM, search, nicknames, etc).",
    version: "0.1.0",
  },
  setup(context) {
    const discord = context.platformServices.get<DiscordService>("discord");
    if (!discord) {
      context.logger.warn(
        "discord-tools: Discord platform service not available, skipping tool registration",
      );
      return;
    }

    // ─── discord.react ─────────────────────────────────────────────────────────
    context.tools.register({
      name: "discord.react",
      description: "React to a Discord message with an emoji.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: {
            type: "string",
            description: "The channel ID containing the message.",
          },
          messageId: {
            type: "string",
            description: "The message ID to react to.",
          },
          emoji: {
            type: "string",
            description:
              "The emoji to react with (unicode emoji or custom emoji name).",
          },
        },
        required: ["channelId", "messageId", "emoji"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, messageId, emoji } = input as {
          channelId: string;
          messageId: string;
          emoji: string;
        };
        await discord.react(channelId, messageId, emoji);
        return { success: true };
      },
    });

    // ─── discord.remove_reaction ───────────────────────────────────────────────
    context.tools.register({
      name: "discord.remove_reaction",
      description: "Remove the bot's reaction from a message.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID." },
          messageId: { type: "string", description: "Message ID." },
          emoji: { type: "string", description: "Emoji to remove." },
        },
        required: ["channelId", "messageId", "emoji"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, messageId, emoji } = input as {
          channelId: string;
          messageId: string;
          emoji: string;
        };
        await discord.removeReaction(channelId, messageId, emoji);
        return { success: true };
      },
    });

    // ─── discord.send ──────────────────────────────────────────────────────────
    context.tools.register({
      name: "discord.send",
      description: "Send a message to a Discord channel.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID to send to." },
          content: { type: "string", description: "Message content." },
        },
        required: ["channelId", "content"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, content } = input as {
          channelId: string;
          content: string;
        };
        return await discord.send(channelId, content);
      },
    });

    // ─── discord.reply_to ──────────────────────────────────────────────────────
    context.tools.register({
      name: "discord.reply_to",
      description: "Reply to a specific Discord message by ID.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID." },
          messageId: {
            type: "string",
            description: "Message ID to reply to.",
          },
          content: { type: "string", description: "Reply content." },
        },
        required: ["channelId", "messageId", "content"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, messageId, content } = input as {
          channelId: string;
          messageId: string;
          content: string;
        };
        return await discord.replyTo(channelId, messageId, content);
      },
    });

    // ─── discord.send_dm ───────────────────────────────────────────────────────
    context.tools.register({
      name: "discord.send_dm",
      description: "Send a direct message to a Discord user.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "User ID to DM." },
          content: { type: "string", description: "Message content." },
        },
        required: ["userId", "content"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { userId, content } = input as {
          userId: string;
          content: string;
        };
        return await discord.sendDM(userId, content);
      },
    });

    // ─── discord.search_messages ───────────────────────────────────────────────
    context.tools.register({
      name: "discord.search_messages",
      description:
        "Search recent messages in a Discord channel. Can filter by author or content.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: {
            type: "string",
            description: "Channel ID to search in.",
          },
          limit: {
            type: "number",
            description: "Max messages to fetch (1-100, default 50).",
          },
          before: {
            type: "string",
            description: "Fetch messages before this message ID.",
          },
          after: {
            type: "string",
            description: "Fetch messages after this message ID.",
          },
          authorId: {
            type: "string",
            description: "Filter to messages by this user ID.",
          },
          contains: {
            type: "string",
            description: "Filter to messages containing this text.",
          },
        },
        required: ["channelId"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, ...options } = input as {
          channelId: string;
          limit?: number;
          before?: string;
          after?: string;
          authorId?: string;
          contains?: string;
        };
        return await discord.searchMessages(channelId, options);
      },
    });

    // ─── discord.get_nickname ──────────────────────────────────────────────────
    context.tools.register({
      name: "discord.get_nickname",
      description: "Get a user's nickname in a guild.",
      inputSchema: {
        type: "object",
        properties: {
          guildId: { type: "string", description: "Guild (server) ID." },
          userId: { type: "string", description: "User ID." },
        },
        required: ["guildId", "userId"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { guildId, userId } = input as {
          guildId: string;
          userId: string;
        };
        const nickname = await discord.getNickname(guildId, userId);
        return { nickname };
      },
    });

    // ─── discord.set_nickname ──────────────────────────────────────────────────
    context.tools.register({
      name: "discord.set_nickname",
      description:
        "Set the bot's nickname in a guild. Pass null to reset to default.",
      inputSchema: {
        type: "object",
        properties: {
          guildId: { type: "string", description: "Guild (server) ID." },
          nickname: {
            type: ["string", "null"],
            description: "New nickname, or null to reset.",
          },
        },
        required: ["guildId", "nickname"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { guildId, nickname } = input as {
          guildId: string;
          nickname: string | null;
        };
        await discord.setBotNickname(guildId, nickname);
        return { success: true };
      },
    });

    // ─── discord.get_user_info ─────────────────────────────────────────────────
    context.tools.register({
      name: "discord.get_user_info",
      description: "Get information about a Discord user by ID.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "User ID." },
        },
        required: ["userId"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { userId } = input as { userId: string };
        return await discord.getUserInfo(userId);
      },
    });

    // ─── discord.pin_message ───────────────────────────────────────────────────
    context.tools.register({
      name: "discord.pin_message",
      description: "Pin a message in a channel.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID." },
          messageId: { type: "string", description: "Message ID to pin." },
        },
        required: ["channelId", "messageId"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, messageId } = input as {
          channelId: string;
          messageId: string;
        };
        await discord.pinMessage(channelId, messageId);
        return { success: true };
      },
    });

    // ─── discord.unpin_message ─────────────────────────────────────────────────
    context.tools.register({
      name: "discord.unpin_message",
      description: "Unpin a message in a channel.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID." },
          messageId: { type: "string", description: "Message ID to unpin." },
        },
        required: ["channelId", "messageId"],
      },
      async execute(input) {
        if (!isRecord(input)) throw new Error("Invalid input");
        const { channelId, messageId } = input as {
          channelId: string;
          messageId: string;
        };
        await discord.unpinMessage(channelId, messageId);
        return { success: true };
      },
    });
  },
};

export default module;
