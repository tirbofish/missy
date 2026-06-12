import type { AgentContext, ToolExecutionContext } from "../../../../core/types.ts";
import type { DiscordService } from "../../../../platforms/discord/src/service.ts";
import { isRecord } from "../../../../core/helpers.ts";

export function registerSearchTools(context: AgentContext, discord: DiscordService): void {
  context.tools.register({
    name: "discord.search_messages",
    description: "Search recent messages in a Discord channel. Can filter by author or content.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel ID to search in." },
        limit: { type: "number", description: "Max messages to fetch (1-100, default 50)." },
        before: { type: "string", description: "Fetch messages before this message ID." },
        after: { type: "string", description: "Fetch messages after this message ID." },
        authorId: { type: "string", description: "Filter to messages by this user ID." },
        contains: { type: "string", description: "Filter to messages containing this text." },
      },
      required: ["channelId"],
    },
    async execute(input) {
      if (!isRecord(input)) throw new Error("Invalid input");
      const { channelId, ...options } = input as {
        channelId: string; limit?: number; before?: string; after?: string; authorId?: string; contains?: string;
      };
      return await discord.searchMessages(channelId, options);
    },
  });

  context.tools.register({
    name: "discord.fetch_history",
    description: "Fetch more message history from the current channel. Use this when you need more context about what was said earlier in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of messages to fetch (1-100, default 25)." },
        before: { type: "string", description: "Fetch messages before this message ID. Omit to get messages before the current message." },
      },
    },
    async execute(input, executionContext: ToolExecutionContext) {
      if (input !== null && input !== undefined && !isRecord(input)) throw new Error("Invalid input");
      const opts = (input ?? {}) as { limit?: number; before?: string };
      const channelId = executionContext.message.channelId;
      const before = opts.before ?? executionContext.message.id;
      const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
      return await discord.searchMessages(channelId, { limit, before });
    },
  });
}
