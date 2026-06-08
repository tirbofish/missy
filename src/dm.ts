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
import { shouldUsePriorConversation } from "./contextIntent.ts";
import { getMessageConversationId } from "./conversation.ts";
import {
  currentLookupStatusMessage,
  isCurrentLookupRequest,
  isCurrentLookupWaitingOnlyResponse,
} from "./currentLookup.ts";
import { actorFromMessage, displayNameFromMessage } from "./discordActor.ts";
import {
  agentToolActivityContent,
  createMessageAgentActivity,
  replyWithDiscordMessages,
} from "./discord.ts";
import {
  buildHelpMessage,
  isHelpCommand,
  isSystemPromptRequest,
  SYSTEM_PROMPT_DENIAL_MESSAGE,
} from "./help.ts";
import { canAccessLocalComputer } from "./localAccess.ts";
import { buildMemoryContext, clearMemories } from "./memories.ts";
import {
  buildMessageContent,
  buildMessageContentWithReplyContext,
  buildMessageImageUrlsWithReplyContext,
} from "./messageContent.ts";
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
  try {
    const existingApiKey = await getApiKey(message.author.id);
    const conversationId = getMessageConversationId(message);
    const currentMessageContent = buildMessageContent(message);
    const messageContent = await buildMessageContentWithReplyContext(message);
    const imageUrls = await buildMessageImageUrlsWithReplyContext(message);
    const actor = actorFromMessage(message);

    if (isHelpCommand(currentMessageContent)) {
      await message.reply(
        buildHelpMessage(canAccessLocalComputer(actor)),
      );
      return;
    }

    if (isSystemPromptRequest(currentMessageContent)) {
      await message.reply(SYSTEM_PROMPT_DENIAL_MESSAGE);
      return;
    }

    if (isShutdownCommand(currentMessageContent)) {
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

    if (currentMessageContent.trim().toLowerCase() === "/clear") {
      await clearConversationContext(conversationId, {
        createdAt: message.createdAt,
        messageId: message.id,
      });
      const clearedMemories = await clearMemories("user", {
        userId: message.author.id,
      });
      await message.reply(
        clearedMemories
          ? `Cleared this conversation context and ${clearedMemories} user memories.`
          : "Cleared this conversation context.",
      );
      return;
    }

    const isCurrentLookup = isCurrentLookupRequest(mistralMessage);
    const context = shouldUsePriorConversation(mistralMessage)
      ? await getConversationContext(conversationId)
      : [];
    const pendingLookupStatus = isCurrentLookup
      ? currentLookupStatusMessage(mistralMessage)
      : undefined;
    const agentActivity = createMessageAgentActivity(message);

    if (pendingLookupStatus) {
      await agentActivity.update(pendingLookupStatus);
    }

    const model = await getEffectiveModel(message.author.id);
    const memoryContext = await buildMemoryContext({
      userId: message.author.id,
    });
    let reply = await sendMistralMessage(existingApiKey, {
      message: mistralMessage,
      imageUrls,
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
      memoryContext,
      model,
      onToolActivity: (activity) =>
        agentActivity.update(agentToolActivityContent(activity)),
      requestFileOperationApproval: canAccessLocalComputer(actor)
        ? (request) => agentActivity.requestFileOperationApproval(request)
        : undefined,
    });

    if (isCurrentLookup && isCurrentLookupWaitingOnlyResponse(reply)) {
      reply = await sendMistralMessage(existingApiKey, {
        message:
          `${mistralMessage}\n\nYou already sent a checking message. Answer now with your best current answer. Do not send another waiting/checking message.`,
        imageUrls,
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
        memoryContext,
        model,
        onToolActivity: (activity) =>
          agentActivity.update(agentToolActivityContent(activity)),
        requestFileOperationApproval: canAccessLocalComputer(actor)
          ? (request) => agentActivity.requestFileOperationApproval(request)
          : undefined,
      });
    }

    await appendConversationTurn(conversationId, mistralMessage, reply);

    const finalReplySent = await replyWithDiscordMessages(message, reply, {
      requestFileOperationApproval: canAccessLocalComputer(actor)
        ? (request) => agentActivity.requestFileOperationApproval(request)
        : undefined,
    });
    await agentActivity.finish(finalReplySent);
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
