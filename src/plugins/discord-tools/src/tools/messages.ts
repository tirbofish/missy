import type { AgentContext } from "../../../../core/types.ts";
import type { DiscordService } from "../../../../platforms/discord/src/service.ts";
import { isRecord } from "../../../../core/helpers.ts";

export function registerMessageTools(context: AgentContext, discord: DiscordService): void {
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
      const { channelId, content } = input as { channelId: string; content: string };
      return await discord.send(channelId, content);
    },
  });

  context.tools.register({
    name: "discord.reply_to",
    description: "Reply to a specific Discord message by ID.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel ID." },
        messageId: { type: "string", description: "Message ID to reply to." },
        content: { type: "string", description: "Reply content." },
      },
      required: ["channelId", "messageId", "content"],
    },
    async execute(input) {
      if (!isRecord(input)) throw new Error("Invalid input");
      const { channelId, messageId, content } = input as { channelId: string; messageId: string; content: string };
      return await discord.replyTo(channelId, messageId, content);
    },
  });

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
      const { userId, content } = input as { userId: string; content: string };
      return await discord.sendDM(userId, content);
    },
  });
}
