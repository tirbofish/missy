import type { AgentContext } from "../../../../core/types.ts";
import type { DiscordService } from "../../../../platforms/discord/src/service.ts";
import { isRecord } from "../../../../core/helpers.ts";

export function registerReactionTools(context: AgentContext, discord: DiscordService): void {
  context.tools.register({
    name: "discord.react",
    description: "React to a Discord message with an emoji.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID containing the message." },
        messageId: { type: "string", description: "The message ID to react to." },
        emoji: { type: "string", description: "The emoji to react with (unicode emoji or custom emoji name)." },
      },
      required: ["channelId", "messageId", "emoji"],
    },
    async execute(input) {
      if (!isRecord(input)) throw new Error("Invalid input");
      const { channelId, messageId, emoji } = input as { channelId: string; messageId: string; emoji: string };
      await discord.react(channelId, messageId, emoji);
      return { success: true };
    },
  });

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
      const { channelId, messageId, emoji } = input as { channelId: string; messageId: string; emoji: string };
      await discord.removeReaction(channelId, messageId, emoji);
      return { success: true };
    },
  });
}
