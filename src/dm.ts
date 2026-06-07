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
  replaceLastAssistantMessage,
} from "./context.ts";
import { shouldUsePriorConversation } from "./contextIntent.ts";
import { getMessageConversationId } from "./conversation.ts";
import {
  currentLookupStatusMessage,
  isCurrentLookupRequest,
  isCurrentLookupWaitingOnlyResponse,
} from "./currentLookup.ts";
import { actorFromMessage, displayNameFromMessage } from "./discordActor.ts";
import {
  replyWithDiscordMessages,
  requestMessageFileOperationApproval,
  sendTyping,
} from "./discord.ts";
import {
  buildHelpMessage,
  isHelpCommand,
  isSystemPromptRequest,
  SYSTEM_PROMPT_DENIAL_MESSAGE,
} from "./help.ts";
import { canAccessLocalComputer } from "./localAccess.ts";
import { buildMessageContent } from "./messageContent.ts";
import { MistralApiError, sendMistralMessage } from "./mistral.ts";
import { getEffectiveModel } from "./models.ts";
import {
  canShutdownBot,
  SHUTDOWN_REQUIRED_MESSAGE,
  shutdownBot,
} from "./shutdown.ts";

const NEEDS_API_KEY_MESSAGE =
  "Send me your Mistral API key first. You can create one at https://console.mistral.ai/api-keys";

function isShutdownCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "/shutdown" || command === "shutdown";
}

export async function handleDirectMessage(message: Message): Promise<void> {
  const existingApiKey = await getApiKey(message.author.id);
  const conversationId = getMessageConversationId(message);
  const messageContent = buildMessageContent(message);
  const actor = actorFromMessage(message);

  if (isHelpCommand(messageContent)) {
    await message.reply(
      buildHelpMessage(canAccessLocalComputer(actor)),
    );
    return;
  }

  if (isSystemPromptRequest(messageContent)) {
    await message.reply(SYSTEM_PROMPT_DENIAL_MESSAGE);
    return;
  }

  if (isShutdownCommand(messageContent)) {
    if (!canShutdownBot(actor)) {
      await message.reply(SHUTDOWN_REQUIRED_MESSAGE);
      return;
    }

    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      channelId: message.channelId,
      event: "shutdown_command",
      guildId: message.guildId,
      userId: message.author.id,
      username: message.author.tag,
      roleIds: actor.roleIds,
    }));
    await message.reply("Shutting down Missy now.");
    shutdownBot(`Discord DM command by ${message.author.id}`);
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
    await clearConversationContext(conversationId, {
      createdAt: message.createdAt,
      messageId: message.id,
    });
    await message.reply("Cleared this conversation context.");
    return;
  }

  try {
    const isCurrentLookup = isCurrentLookupRequest(mistralMessage);
    const context = shouldUsePriorConversation(mistralMessage)
      ? await getConversationContext(conversationId)
      : [];
    const pendingLookupStatus = isCurrentLookup
      ? currentLookupStatusMessage(mistralMessage)
      : undefined;

    if (pendingLookupStatus) {
      await message.reply(pendingLookupStatus);
      await appendConversationTurn(
        conversationId,
        mistralMessage,
        pendingLookupStatus,
      );
    }

    await sendTyping(message);
    const model = await getEffectiveModel(message.author.id);
    let reply = await sendMistralMessage(existingApiKey, {
      message: mistralMessage,
      source: "discord-dm",
      discord: {
        userId: message.author.id,
        username: message.author.tag,
        displayName: displayNameFromMessage(message),
        channelId: message.channelId,
        roleIds: actor.roleIds,
      },
    }, {
      context,
      model,
      requestFileOperationApproval: canAccessLocalComputer(actor)
        ? (request) => requestMessageFileOperationApproval(message, request)
        : undefined,
    });

    if (isCurrentLookup && isCurrentLookupWaitingOnlyResponse(reply)) {
      reply = await sendMistralMessage(existingApiKey, {
        message:
          `${mistralMessage}\n\nYou already sent a checking message. Answer now with your best current answer. Do not send another waiting/checking message.`,
        source: "discord-dm",
        discord: {
          userId: message.author.id,
          username: message.author.tag,
          displayName: displayNameFromMessage(message),
          channelId: message.channelId,
          roleIds: actor.roleIds,
        },
      }, {
        context,
        model,
        requestFileOperationApproval: canAccessLocalComputer(actor)
          ? (request) => requestMessageFileOperationApproval(message, request)
          : undefined,
      });
    }

    if (pendingLookupStatus) {
      const replaced = await replaceLastAssistantMessage(conversationId, reply);

      if (!replaced) {
        await appendConversationTurn(conversationId, mistralMessage, reply);
      }
    } else {
      await appendConversationTurn(conversationId, mistralMessage, reply);
    }

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
