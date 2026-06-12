/**
 * Internal types and interfaces for the Session platform.
 *
 * SessionMessage, SessionAttachment, SessionInstance, and PollerInstance mirror
 * the @session.js/client internal shapes — they are not exported from that
 * package's public API, so we mirror them here.
 */

import type { MessageAttachment } from "../../../core/types.ts";

// ─── Session.js mirror interfaces ──────────────────────────────────────────

export interface SessionMessage {
  type: "private" | "group";
  groupId?: string;
  id: string;
  from: string;
  author: { displayName: string };
  text?: string;
  attachments: SessionAttachment[];
  replyToMessage?: {
    timestamp: number;
    author: string;
    text?: string;
    attachments?: { contentType?: string; fileName?: string }[];
  };
  timestamp: number;
  getReplyToMessage():
    | {
        timestamp: number;
        author: string;
        text?: string;
        attachments?: { contentType?: string; fileName?: string }[];
      }
    | undefined;
}

export interface SessionAttachment {
  id: string;
  caption?: string;
  name?: string;
  size?: number;
  metadata: { width?: number; height?: number; contentType?: string };
}

/** Local interface mirroring @session.js/client Session class API we use. */
export interface SessionInstance {
  setMnemonic(mnemonic: string, displayName?: string): void;
  getSessionID(): string;
  getDisplayName(): string | undefined;
  setDisplayName(name: string): Promise<void>;
  sendMessage(args: {
    to: string;
    text?: string;
    attachments?: File[];
    voiceMessage?: Blob;
    replyToMessage?: {
      timestamp: number;
      author: string;
      text?: string;
    };
  }): Promise<{ messageHash: string; syncMessageHash: string; timestamp: number }>;
  addPoller(poller: PollerInstance): void;
  showTypingIndicator(args: { conversation: string }): Promise<void>;
  hideTypingIndicator(args: { conversation: string }): Promise<void>;
  markMessagesAsRead(args: {
    from: string;
    messagesTimestamps: number[];
    readAt?: number;
  }): Promise<void>;
  acceptConversationRequest(args: { from: string }): Promise<void>;
  addReaction(args: {
    messageTimestamp: number;
    messageAuthor: string;
    emoji: string;
  }): Promise<void>;
  removeReaction(args: {
    messageTimestamp: number;
    messageAuthor: string;
    emoji: string;
  }): Promise<void>;
  deleteMessage(args: {
    to: string;
    timestamp: number;
    hash: string;
  }): Promise<void>;
  deleteMessages(args: Array<{
    to: string;
    timestamp: number;
    hash: string;
  }>): Promise<void>;
  // deno-lint-ignore no-explicit-any
  on(eventName: string, callback: (data: any) => void): void;
  // deno-lint-ignore no-explicit-any
  off(eventName: string, callback: (data: any) => void): void;
}

/** Local interface mirroring @session.js/client Poller class. */
// deno-lint-ignore no-empty-interface
export interface PollerInstance {}

// ─── Service interface (consumed by plugins/tools) ────────────────────────

export interface SessionService {
  readonly platformName: "session";
  react(channelId: string, messageTimestamp: number, messageAuthor: string, emoji: string): Promise<void>;
  removeReaction(channelId: string, messageTimestamp: number, messageAuthor: string, emoji: string): Promise<void>;
  deleteMessage(channelId: string, timestamp: number, hash: string): Promise<void>;
}

// ─── Platform configuration ────────────────────────────────────────────────

export interface SessionPlatformConfig {
  mnemonic?: string;
  displayName: string;
  commandPrefix: string;
  mentionOnly: boolean;
  respondToAllMessages: boolean;
  maxMessageLength: number;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
  autoAcceptRequests: boolean;
}
