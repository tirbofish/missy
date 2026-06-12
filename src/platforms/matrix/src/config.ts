/** Matrix platform configuration parsing. */

import type { AppConfig } from "../../../core/config.ts";
import type { MatrixPlatformConfig } from "./types.ts";

export function parseMatrixConfig(config: AppConfig): MatrixPlatformConfig {
  const m = (config.data.matrix ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  const str = (key: string, envKey: string, fallback: string): string =>
    (m[key] as string) ?? env[envKey] ?? fallback;
  const optStr = (key: string, envKey: string): string | undefined =>
    (m[key] as string) ?? env[envKey];
  const bool = (key: string, envKey: string, fallback: boolean): boolean => {
    const v = m[key];
    if (typeof v === "boolean") return v;
    const ev = env[envKey];
    if (ev !== undefined) return ["1", "true", "yes", "on"].includes(ev.toLowerCase());
    return fallback;
  };
  const list = (key: string, envKey: string): string[] => {
    const v = m[key];
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
    const ev = env[envKey];
    return ev ? ev.split(",").map(s => s.trim()).filter(Boolean) : [];
  };

  return {
    homeserverUrl: optStr("homeserverUrl", "MATRIX_HOMESERVER_URL"),
    accessToken: optStr("accessToken", "MATRIX_ACCESS_TOKEN"),
    username: optStr("username", "MATRIX_USERNAME"),
    password: optStr("password", "MATRIX_PASSWORD"),
    userId: optStr("userId", "MATRIX_USER_ID"),
    deviceId: optStr("deviceId", "MATRIX_DEVICE_ID"),
    recoveryKey: optStr("recoveryKey", "MATRIX_RECOVERY_KEY"),
    restoreKeyBackup: bool("restoreKeyBackup", "MATRIX_RESTORE_KEY_BACKUP", true),
    verifyDevice: bool("verifyDevice", "MATRIX_VERIFY_DEVICE", true),
    deviceDisplayName: str("deviceDisplayName", "MATRIX_DEVICE_DISPLAY_NAME", "Missy Bot"),
    roomIds: list("roomIds", "MATRIX_ROOM_IDS"),
    mentionOnly: bool("mentionOnly", "MATRIX_MENTION_ONLY", true),
    commandPrefix: str("commandPrefix", "MATRIX_COMMAND_PREFIX", "!M!"),
    displayName: str("displayName", "MATRIX_DISPLAY_NAME", "Missy"),
    maxMessageLength: typeof m.maxMessageLength === "number" ? m.maxMessageLength : 0,
    respondToAllMessages: bool("respondToAllMessages", "MATRIX_RESPOND_TO_ALL_MESSAGES", false),
    includeReplyContext: bool("includeReplyContext", "MATRIX_INCLUDE_REPLY_CONTEXT", true),
    includeChannelContext: bool("includeChannelContext", "MATRIX_INCLUDE_CHANNEL_CONTEXT", true),
    channelContextCount: typeof m.channelContextCount === "number" ? m.channelContextCount : 10,
    multiMessageDelimiter: str("multiMessageDelimiter", "MATRIX_MULTI_MESSAGE_DELIMITER", "|||"),
    multiMessageDelayMs: typeof m.multiMessageDelayMs === "number" ? m.multiMessageDelayMs : 1500,
    autoJoinInvites: bool("autoJoinInvites", "MATRIX_AUTO_JOIN_INVITES", true),
  };
}
