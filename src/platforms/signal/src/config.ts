/** Signal platform configuration parsing. */

import type { AppConfig } from "../../../core/config.ts";
import type { SignalPlatformConfig } from "./types.ts";

export function parseSignalConfig(config: AppConfig): SignalPlatformConfig {
  const s = (config.data.signal ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    account: (s.account as string) ?? env["SIGNAL_ACCOUNT"],
    socketPath: (s.socketPath as string) ?? env["SIGNAL_SOCKET_PATH"],
    commandPrefix: (s.commandPrefix as string) ?? env["SIGNAL_COMMAND_PREFIX"] ?? "!M!",
    displayName: (s.displayName as string) ?? env["SIGNAL_DISPLAY_NAME"] ?? "Missy",
    mentionOnly: typeof s.mentionOnly === "boolean" ? s.mentionOnly : true,
    respondToAllMessages: typeof s.respondToAllMessages === "boolean" ? s.respondToAllMessages : false,
    maxMessageLength: typeof s.maxMessageLength === "number" ? s.maxMessageLength : 0,
    includeReplyContext: typeof s.includeReplyContext === "boolean" ? s.includeReplyContext : true,
    includeChannelContext: typeof s.includeChannelContext === "boolean" ? s.includeChannelContext : true,
    channelContextCount: typeof s.channelContextCount === "number" ? s.channelContextCount : 10,
    multiMessageDelimiter: (s.multiMessageDelimiter as string) ?? env["SIGNAL_MULTI_MESSAGE_DELIMITER"] ?? "|||",
    multiMessageDelayMs: typeof s.multiMessageDelayMs === "number" ? s.multiMessageDelayMs : 1500,
  };
}
