import { Message } from "discord.js";
import {
  getApiKey,
  parseApiKeyCandidate,
  removeApiKey,
  setApiKey,
} from "./apiKeys.ts";
import {
  appendConversationTurn,
  clearConversationContext,
  getConversationContext,
} from "./context.ts";
import { getMessageConversationId } from "./conversation.ts";
import {
  replyWithDiscordMessages,
  requestMessageFileOperationApproval,
  sendTyping,
} from "./discord.ts";
import { buildHelpMessage, isHelpCommand } from "./help.ts";
import { buildMessageContent } from "./messageContent.ts";
import {
  MistralApiError,
  sendMistralMessage,
} from "./mistral.ts";

const NEEDS_API_KEY_MESSAGE =
  "Send me your Mistral API key first. You can create one at https://console.mistral.ai/api-keys";

export async function handleDirectMessage(message: Message): Promise<void> {
  const existingApiKey = await getApiKey(message.author.id);
  const conversationId = getMessageConversationId(message);
  const messageContent = buildMessageContent(message);

  if (isHelpCommand(messageContent)) {
    await message.reply(buildHelpMessage(true));
    return;
  }

  if (!existingApiKey) {
    const apiKey = parseApiKeyCandidate(message.content);

    if (!apiKey) {
      await message.reply(NEEDS_API_KEY_MESSAGE);
      return;
    }

    await setApiKey(message.author.id, apiKey, "dm");
    await message.reply("Got it - your Mistral API key is saved.");
    return;
  }

  const mistralMessage = messageContent;
  if (!mistralMessage) {
    await message.reply("Send me a message for Missy.");
    return;
  }

  if (mistralMessage.trim().toLowerCase() === "/clear") {
    await clearConversationContext(conversationId);
    await message.reply("Cleared this conversation context.");
    return;
  }

  try {
    await sendTyping(message);
    const context = await getConversationContext(conversationId);
    const reply = await sendMistralMessage(existingApiKey, {
      message: mistralMessage,
      source: "discord-dm",
      discord: {
        userId: message.author.id,
        username: message.author.tag,
        channelId: message.channelId,
      },
    }, {
      context,
      requestFileOperationApproval: (request) =>
        requestMessageFileOperationApproval(message, request),
    });
    await appendConversationTurn(conversationId, mistralMessage, reply);
    await replyWithDiscordMessages(message, reply);
  } catch (error) {
    if (error instanceof MistralApiError && error.status === 401) {
      await removeApiKey(message.author.id);
      await message.reply(
        "Mistral rejected your API key, so I removed it. Send me a new key, or use `/set-api-key` in a server.",
      );
      return;
    }

    console.error(error);
    await message.reply("Missy couldn't reach Mistral right now.");
  }
}
