/** Discord platform configuration. */

import type { AppConfig } from "../../../core/config.ts";

export interface DiscordPlatformConfig {
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

export function parseDiscordConfig(config: AppConfig): DiscordPlatformConfig {
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
    reactToHandledMessages: typeof d.reactToHandledMessages === "boolean" ? d.reactToHandledMessages : true,
    handledReactionEmoji: (d.handledReactionEmoji as string) ?? "✅",
    multiMessageDelimiter: (d.multiMessageDelimiter as string) ?? "|||",
    multiMessageDelayMs: typeof d.multiMessageDelayMs === "number" ? d.multiMessageDelayMs : 1500,
  };
}
