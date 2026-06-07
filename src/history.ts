import { Collection, Message, Snowflake } from "discord.js";
import { summarizeAssistantMediaContent } from "./media.ts";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

type FetchableMessages = {
  fetch: (
    options: { limit: number; before?: Snowflake },
  ) => Promise<Collection<Snowflake, Message>>;
};

type HistoryChannel = {
  messages: FetchableMessages;
};

export type HistoryContextOptions = {
  after?: Date;
  limit?: number;
};

function getConfiguredDefaultLimit(): number {
  const rawLimit = Number(Deno.env.get("DISCORD_CONTEXT_MESSAGES"));

  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(Math.trunc(rawLimit), MAX_HISTORY_LIMIT);
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return getConfiguredDefaultLimit();
  }

  return Math.min(Math.trunc(limit), MAX_HISTORY_LIMIT);
}

function canFetchHistory(channel: unknown): channel is HistoryChannel {
  const candidate = channel as Partial<HistoryChannel>;
  return typeof candidate.messages?.fetch === "function";
}

function formatMessage(message: Message): string {
  const author = message.author.bot
    ? `${message.author.tag} (bot)`
    : message.author.tag;
  const rawContent = message.cleanContent.trim();
  const content = message.author.bot
    ? summarizeAssistantMediaContent(rawContent)
    : rawContent;
  const attachments = [...message.attachments.values()].map((attachment) =>
    attachment.url
  );
  const parts = [
    `[${message.createdAt.toISOString()}] ${author}: ${content || "(no text)"}`,
    ...attachments.map((url) => `Attachment: ${url}`),
  ];

  return parts.join("\n");
}

export async function buildDiscordHistoryContext(
  message: Message,
  options: HistoryContextOptions = {},
): Promise<string | undefined> {
  if (!canFetchHistory(message.channel)) {
    return undefined;
  }

  const messages = await message.channel.messages.fetch({
    limit: clampLimit(options.limit),
    before: message.id,
  });
  const afterTimestamp = options.after?.getTime();

  const formatted = [...messages.values()]
    .filter((candidate) =>
      afterTimestamp === undefined ||
      candidate.createdTimestamp > afterTimestamp
    )
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(formatMessage)
    .join("\n");

  if (!formatted) {
    return undefined;
  }

  return `Recent Discord channel history:\n${formatted}`;
}

export async function buildInteractionHistoryContext(
  channel: unknown,
  options: HistoryContextOptions = {},
): Promise<string | undefined> {
  if (!canFetchHistory(channel)) {
    return undefined;
  }

  const messages = await channel.messages.fetch({
    limit: clampLimit(options.limit),
  });
  const afterTimestamp = options.after?.getTime();
  const formatted = [...messages.values()]
    .filter((candidate) =>
      afterTimestamp === undefined ||
      candidate.createdTimestamp > afterTimestamp
    )
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(formatMessage)
    .join("\n");

  if (!formatted) {
    return undefined;
  }

  return `Discord channel history:\n${formatted}`;
}

export function maxDiscordHistoryLimit(): number {
  return MAX_HISTORY_LIMIT;
}

export function shouldLookPastClearPoint(content: string): boolean {
  return /\blook\s+past\s+(your|the)\s+clear\s+point\b/i.test(content);
}
