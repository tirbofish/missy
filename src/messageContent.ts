import { Message } from "discord.js";

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

  const attachmentUrls = [...message.attachments.values()].map((attachment) =>
    attachment.url
  );

  if (attachmentUrls.length === 0) {
    return content;
  }

  const attachmentBlock = `Attachments:\n${attachmentUrls.join("\n")}`;
  return content ? `${content}\n\n${attachmentBlock}` : attachmentBlock;
}
