/** Signal platform internal types and interfaces. */

export interface SignalAttachment {
  id?: string;
  contentType?: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
}

export interface SignalDataMessage {
  timestamp: number;
  message?: string;
  groupInfo?: { groupId: string; type: string };
  quote?: SignalQuote;
  mentions?: SignalMention[];
  reaction?: SignalReaction;
  attachments?: SignalAttachment[];
  endSession?: boolean;
  expiresInSeconds?: number;
  profileKeyUpdate?: boolean;
  viewOnce?: boolean;
}

export interface SignalQuote {
  id: number;
  author: string;
  text?: string;
  mentions?: SignalMention[];
}

export interface SignalMention {
  name: string;
  number: string;
  uuid: string;
  start: number;
  length: number;
}

export interface SignalReaction {
  emoji: string;
  targetAuthor: string;
  targetSentTimestamp: number;
  isRemove: boolean;
}

export interface SignalEnvelope {
  source: string;
  sourceUuid: string;
  sourceDevice: number;
  timestamp: number;
  dataMessage?: SignalDataMessage;
  syncMessage?: unknown;
  receiptMessage?: unknown;
  typingMessage?: unknown;
}

export interface SignalReceiveParams {
  account: string;
  envelope: SignalEnvelope;
}

export interface SignalPlatformConfig {
  account?: string;
  socketPath?: string;
  commandPrefix: string;
  displayName: string;
  mentionOnly: boolean;
  respondToAllMessages: boolean;
  maxMessageLength: number;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
}
