/**
 * Session-specific helpers: message splitting and tool input parsing.
 */

import { isRecord } from "../../../core/helpers.ts";
import type { ConversationMessage, MessageAttachment } from "../../../core/types.ts";
import type { SessionMessage, SessionPlatformConfig } from "./types.ts";
import { sessionAttachments } from "./attachments.ts";

/** Split a long message into platform-safe chunks (default max 4000 chars). */
export function splitMessage(content: string, maxLength = 0): string[] {
  const effectiveMax = maxLength > 0 ? maxLength : 4000;
  const normalized = content.trim();
  if (normalized.length <= effectiveMax) return [normalized || " "];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > effectiveMax) {
    let splitAt = remaining.lastIndexOf("\n", effectiveMax);
    if (splitAt < Math.floor(effectiveMax * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", effectiveMax);
    }
    if (splitAt < 1) splitAt = effectiveMax;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);

  return chunks;
}

/** Parse and validate input for the session.react tool. */
export function parseReactionInput(input: unknown): {
  messageTimestamp: number;
  messageAuthor: string;
  emoji: string;
} {
  if (!isRecord(input)) {
    throw new Error('session.react expects an object with messageTimestamp, messageAuthor, and emoji.');
  }
  const ts = input.messageTimestamp;
  const author = input.messageAuthor;
  const emoji = input.emoji;
  if (typeof ts !== "number" || typeof author !== "string" || typeof emoji !== "string") {
    throw new Error('session.react requires messageTimestamp (number), messageAuthor (string), and emoji (string).');
  }
  return { messageTimestamp: ts, messageAuthor: author, emoji: emoji.trim() };
}

/** Parse and validate input for the session.deleteMessage tool. */
export function parseDeleteInput(input: unknown): {
  timestamp: number;
  hash: string;
  channelId: string;
} {
  if (!isRecord(input)) {
    throw new Error('session.deleteMessage expects an object with timestamp, hash, and channelId.');
  }
  const ts = input.timestamp;
  const hash = input.hash;
  const channelId = input.channelId;
  if (typeof ts !== "number" || typeof hash !== "string" || typeof channelId !== "string") {
    throw new Error('session.deleteMessage requires timestamp (number), hash (string), and channelId (string).');
  }
  return { timestamp: ts, hash: hash, channelId };
}
