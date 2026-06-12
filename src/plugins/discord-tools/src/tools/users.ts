import type { AgentContext } from "../../../../core/types.ts";
import type { DiscordService } from "../../../../platforms/discord/src/service.ts";
import { isRecord } from "../../../../core/helpers.ts";

export function registerUserTools(context: AgentContext, discord: DiscordService): void {
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
      const { guildId, userId } = input as { guildId: string; userId: string };
      const nickname = await discord.getNickname(guildId, userId);
      return { nickname };
    },
  });

  context.tools.register({
    name: "discord.set_nickname",
    description: "Set the bot's nickname in a guild. Pass null to reset to default.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: { type: "string", description: "Guild (server) ID." },
        nickname: { type: ["string", "null"], description: "New nickname, or null to reset." },
      },
      required: ["guildId", "nickname"],
    },
    async execute(input) {
      if (!isRecord(input)) throw new Error("Invalid input");
      const { guildId, nickname } = input as { guildId: string; nickname: string | null };
      await discord.setBotNickname(guildId, nickname);
      return { success: true };
    },
  });

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
}
