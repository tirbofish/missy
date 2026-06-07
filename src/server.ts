import { Message } from "discord.js";
import { getApiKey, removeApiKey } from "./apiKeys.ts";
import { sendTyping } from "./discord.ts";
import { buildMessageContent } from "./messageContent.ts";
import {
  fitDiscordMessage,
  MistralApiError,
  sendMistralMessage,
} from "./mistral.ts";

const NEEDS_API_KEY_MESSAGE =
  "Send me your Mistral API key first. You can create one at https://console.mistral.ai/api-keys";

async function isReplyToBot(
  message: Message,
  botUserId: string,
): Promise<boolean> {
  if (!message.reference?.messageId) {
    return false;
  }

  try {
    const referencedMessage = await message.fetchReference();
    return referencedMessage.author.id === botUserId;
  } catch (error) {
    console.error("Could not fetch referenced Discord message", error);
    return false;
  }
}

export async function handleServerMessage(
  message: Message,
  botUserId: string,
): Promise<void> {
  const mentionedBot = message.mentions.users.has(botUserId);
  const repliedToBot = await isReplyToBot(message, botUserId);

  if (!mentionedBot && !repliedToBot) {
    return;
  }

  const apiKey = await getApiKey(message.author.id);
  if (!apiKey) {
    await message.reply(NEEDS_API_KEY_MESSAGE);
    return;
  }

  const mistralMessage = buildMessageContent(message, botUserId);
  if (!mistralMessage) {
    await message.reply("Send me a message for Missy.");
    return;
  }

  try {
    await sendTyping(message);
    const reply = await sendMistralMessage(apiKey, {
      message: mistralMessage,
      source: "discord-server",
      discord: {
        userId: message.author.id,
        username: message.author.tag,
        channelId: message.channelId,
        guildId: message.guildId ?? undefined,
      },
    });
    await message.reply(fitDiscordMessage(reply));
  } catch (error) {
    if (error instanceof MistralApiError && error.status === 401) {
      await removeApiKey(message.author.id);
      await message.reply(
        "Mistral rejected your API key, so I removed it. Run `/set-api-key` with a new key.",
      );
      return;
    }

    console.error(error);
    await message.reply("Missy couldn't reach Mistral right now.");
  }
}
