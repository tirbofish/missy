/** Internal types for the Matrix platform. */

export type MatrixEventContent = Record<string, unknown>;

export interface RawMatrixEvent {
  event_id: string;
  sender: string;
  type: string;
  origin_server_ts: number;
  content: MatrixEventContent;
}

export interface MatrixPlatformConfig {
  homeserverUrl?: string;
  accessToken?: string;
  username?: string;
  password?: string;
  userId?: string;
  deviceId?: string;
  recoveryKey?: string;
  restoreKeyBackup: boolean;
  verifyDevice: boolean;
  deviceDisplayName: string;
  roomIds: string[];
  mentionOnly: boolean;
  commandPrefix: string;
  displayName: string;
  maxMessageLength: number;
  respondToAllMessages: boolean;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
  autoJoinInvites: boolean;
}

export interface MatrixAuthSession {
  accessToken: string;
  managedDevice: boolean;
}

export interface MatrixAddressing {
  content: string;
  isPrefixCommand: boolean;
  mentioned: boolean;
}

/** Known verification-related to-device event types. */
export const VERIFICATION_EVENT_TYPES = new Set([
  "m.key.verification.request",
  "m.key.verification.ready",
  "m.key.verification.start",
  "m.key.verification.accept",
  "m.key.verification.key",
  "m.key.verification.mac",
  "m.key.verification.cancel",
  "m.key.verification.done",
]);
