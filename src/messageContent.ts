import { Message } from "discord.js";
import { formatMediaAttachments, visionImageUrls } from "./media.ts";

export const MESSAGE_COMMAND_PREFIX = "!M!";

export function hasMessageCommandPrefix(content: string): boolean {
  return content.trimStart().startsWith(MESSAGE_COMMAND_PREFIX);
}

function stripMessageCommandPrefix(content: string): string {
  const trimmedStart = content.trimStart();

  if (!trimmedStart.startsWith(MESSAGE_COMMAND_PREFIX)) {
    return content;
  }

  return trimmedStart.slice(MESSAGE_COMMAND_PREFIX.length).trim();
}

export function buildMessageContent(
  message: Message,
  botUserId?: string,
): string {
  let content = message.content.trim();

  if (botUserId) {
    content = content
      .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
      .trim();
  }

  content = stripMessageCommandPrefix(content);

  const attachmentBlock = formatMediaAttachments(
    [...message.attachments.values()].map((attachment) => ({
      contentType: attachment.contentType,
      name: attachment.name,
      size: attachment.size,
      url: attachment.url,
    })),
  );

  if (!attachmentBlock) {
    return content;
  }

  return content ? `${content}\n\n${attachmentBlock}` : attachmentBlock;
}

export function buildMessageImageUrls(message: Message): string[] {
  return visionImageUrls(
    [...message.attachments.values()].map((attachment) => ({
      contentType: attachment.contentType,
      name: attachment.name,
      size: attachment.size,
      url: attachment.url,
    })),
  );
}

function authorTag(message: Message): string {
  return message.author.bot
    ? `${message.author.tag} (bot)`
    : message.author.tag;
}

async function fetchReferencedMessage(
  message: Message,
): Promise<Message | undefined> {
  if (!message.reference?.messageId) {
    return undefined;
  }

  try {
    return await message.fetchReference();
  } catch (error) {
    console.error("Could not fetch referenced Discord message", error);
    return undefined;
  }
}

export async function buildMessageContentWithReplyContext(
  message: Message,
  botUserId?: string,
): Promise<string> {
  const content = buildMessageContent(message, botUserId);
  const referencedMessage = await fetchReferencedMessage(message);

  if (!referencedMessage) {
    return content;
  }

  const referencedContent = buildMessageContent(referencedMessage, botUserId);
  if (!referencedContent) {
    return content;
  }

  return [
    "Discord reply context:",
    `Original message from ${authorTag(referencedMessage)}:`,
    referencedContent,
    "",
    `Reply from ${authorTag(message)}:`,
    content || "(no text)",
  ].join("\n");
}

export async function buildMessageImageUrlsWithReplyContext(
  message: Message,
): Promise<string[]> {
  const imageUrls = buildMessageImageUrls(message);
  const referencedMessage = await fetchReferencedMessage(message);

  if (!referencedMessage) {
    return imageUrls;
  }

  return [
    ...buildMessageImageUrls(referencedMessage),
    ...imageUrls,
  ];
}
