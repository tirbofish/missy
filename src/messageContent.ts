import { Message } from "discord.js";

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

  const attachmentUrls = [...message.attachments.values()].map((attachment) =>
    attachment.url
  );

  if (attachmentUrls.length === 0) {
    return content;
  }

  const attachmentBlock = `Attachments:\n${attachmentUrls.join("\n")}`;
  return content ? `${content}\n\n${attachmentBlock}` : attachmentBlock;
}
