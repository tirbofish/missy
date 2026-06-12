import type { AgentContext } from "../../../../core/types.ts";
import type { DiscordService } from "../../../../platforms/discord/src/service.ts";
import { isRecord } from "../../../../core/helpers.ts";

export function registerAdminTools(context: AgentContext, discord: DiscordService): void {
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
      const { channelId, messageId } = input as { channelId: string; messageId: string };
      await discord.pinMessage(channelId, messageId);
      return { success: true };
    },
  });

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
      const { channelId, messageId } = input as { channelId: string; messageId: string };
      await discord.unpinMessage(channelId, messageId);
      return { success: true };
    },
  });
}
