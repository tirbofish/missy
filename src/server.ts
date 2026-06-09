import { Message } from "discord.js";
import { getEffectiveApiKey, removeResolvedApiKey } from "./apiKeys.ts";
import { buildAutomationPrompt, getMatchingAutomation } from "./automations.ts";
import {
  appendConversationTurn,
  clearConversationContext,
  getConversationClearPoint,
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
import { discordServerToolContextFromMessage } from "./discordServerTools.ts";
import {
  buildHelpMessage,
  isHelpCommand,
  isSystemPromptRequest,
  SYSTEM_PROMPT_DENIAL_MESSAGE,
} from "./help.ts";
import {
  buildDiscordHistoryContext,
  shouldLookPastClearPoint,
} from "./history.ts";
import { canAccessLocalComputer } from "./localAccess.ts";
import {
  buildMemoryContext,
  clearUserServerMemories,
  saveInferredUserMemories,
} from "./memories.ts";
import {
  buildMessageContent,
  buildMessageContentWithReplyContext,
  buildMessageImageUrlsWithReplyContext,
  hasMessageCommandPrefix,
} from "./messageContent.ts";
import { MistralApiError } from "./mistral/mod.ts";
import { sendModelMessage } from "./modelProviders.ts";
import { getEffectiveModel } from "./models.ts";
import {
  canShutdownBot,
  SHUTDOWN_REQUIRED_MESSAGE,
  shutdownBot,
} from "./shutdown.ts";

const NEEDS_API_KEY_MESSAGE =
  "Run `/set-api-key` once in this server first with the configured model provider API key.";

function isClearCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "clear" || command === "/clear";
}

function isShutdownCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "/shutdown" || command === "shutdown";
}

function mentionedBotRole(message: Message, botUserId: string): boolean {
  if (!message.guild || message.mentions.roles.size === 0) {
    return false;
  }
  const botMember = message.guild.members.cache.get(botUserId);
  if (!botMember) {
    return false;
  }
  return message.mentions.roles.some((role) =>
    botMember.roles.cache.has(role.id)
  );
}

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
  try {
    const mentionedBot = message.mentions.users.has(botUserId) ||
      mentionedBotRole(message, botUserId);
    const prefixedCommand = hasMessageCommandPrefix(message.content);
    const repliedToBot = mentionedBot || prefixedCommand
      ? false
      : await isReplyToBot(message, botUserId);
    const directInvocation = mentionedBot || repliedToBot || prefixedCommand;
    const automation = !directInvocation && message.guildId
      ? await getMatchingAutomation(
        message.guildId,
        message.content,
        message.channelId,
      )
      : undefined;

    if (!directInvocation && !automation) {
      return;
    }

    const currentMessageContent = buildMessageContent(message, botUserId);
    const baseMistralMessage = await buildMessageContentWithReplyContext(
      message,
      botUserId,
    );
    const mistralMessage = automation && baseMistralMessage
      ? buildAutomationPrompt(automation, baseMistralMessage)
      : baseMistralMessage;
    const imageUrls = await buildMessageImageUrlsWithReplyContext(message);
    if (!mistralMessage) {
      await message.reply("Send me a message for Missy.");
      return;
    }

    const conversationId = getMessageConversationId(message);
    const actor = actorFromMessage(message);

    if (directInvocation && isHelpCommand(currentMessageContent)) {
      await message.reply(
        buildHelpMessage(canAccessLocalComputer(actor)),
      );
      return;
    }

    if (directInvocation && isSystemPromptRequest(currentMessageContent)) {
      await message.reply(SYSTEM_PROMPT_DENIAL_MESSAGE);
      return;
    }

    if (directInvocation && isClearCommand(currentMessageContent)) {
      await clearConversationContext(conversationId, {
        createdAt: message.createdAt,
        messageId: message.id,
      });
      const clearedMemories = await clearUserServerMemories({
        guildId: message.guildId ?? undefined,
        userId: message.author.id,
      });
      await message.reply(
        clearedMemories
          ? `Cleared this conversation context and ${clearedMemories} user+server memories.`
          : "Cleared this conversation context.",
      );
      return;
    }

    if (directInvocation && isShutdownCommand(currentMessageContent)) {
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
      shutdownBot(`Discord server command by ${message.author.id}`);
      return;
    }

    const resolvedApiKey = await getEffectiveApiKey(
      message.author.id,
      message.guildId,
    );
    if (!resolvedApiKey) {
      await message.reply(NEEDS_API_KEY_MESSAGE);
      return;
    }

    const isCurrentLookup = isCurrentLookupRequest(mistralMessage);
    const usePriorConversation = shouldUsePriorConversation(mistralMessage);
    const context = usePriorConversation
      ? await getConversationContext(conversationId)
      : [];
    const clearPoint = usePriorConversation &&
        !shouldLookPastClearPoint(mistralMessage)
      ? await getConversationClearPoint(conversationId)
      : undefined;
    const discordHistory = usePriorConversation
      ? await buildDiscordHistoryContext(message, {
        after: clearPoint?.createdAt,
      })
      : undefined;
    const pendingLookupStatus = isCurrentLookup
      ? currentLookupStatusMessage(mistralMessage)
      : undefined;
    const agentActivity = createMessageAgentActivity(message);

    if (pendingLookupStatus) {
      await agentActivity.update(pendingLookupStatus);
    }

    const model = await getEffectiveModel(message.author.id);
    await saveInferredUserMemories({
      guildId: message.guildId ?? undefined,
      userId: message.author.id,
    }, mistralMessage);
    const memoryContext = await buildMemoryContext({
      guildId: message.guildId ?? undefined,
      userId: message.author.id,
    });
    let reply = await sendModelMessage(resolvedApiKey.apiKey, {
      message: mistralMessage,
      imageUrls,
      source: "discord-server",
      discord: {
        userId: message.author.id,
        username: message.author.tag,
        displayName: displayNameFromMessage(message),
        channelId: message.channelId,
        guildId: message.guildId ?? undefined,
        roleIds: actor.roleIds,
      },
    }, {
      context,
      discordHistory,
      memoryContext,
      model,
      discordServerToolContext: discordServerToolContextFromMessage(message),
      onToolActivity: (activity) =>
        agentActivity.update(agentToolActivityContent(activity)),
      requestFileOperationApproval: canAccessLocalComputer(actor)
        ? (request) => agentActivity.requestFileOperationApproval(request)
        : undefined,
    });

    if (isCurrentLookup && isCurrentLookupWaitingOnlyResponse(reply)) {
      reply = await sendModelMessage(resolvedApiKey.apiKey, {
        message:
          `${mistralMessage}\n\nYou already sent a checking message. Answer now with your best current answer. Do not send another waiting/checking message.`,
        imageUrls,
        source: "discord-server",
        discord: {
          userId: message.author.id,
          username: message.author.tag,
          displayName: displayNameFromMessage(message),
          channelId: message.channelId,
          guildId: message.guildId ?? undefined,
          roleIds: actor.roleIds,
        },
      }, {
        context,
        discordHistory,
        memoryContext,
        model,
        discordServerToolContext: discordServerToolContextFromMessage(message),
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
      const resolvedApiKey = await getEffectiveApiKey(
        message.author.id,
        message.guildId,
      );
      if (resolvedApiKey) {
        await removeResolvedApiKey(resolvedApiKey);
      }
      await message.reply(
        "The model provider rejected the API key, so I removed it. Run `/set-api-key` with a new key.",
      );
      return;
    }

    console.error(error);
    try {
      await message.reply("Missy couldn't reach the model provider right now.");
    } catch {
      // Message reply itself may fail if the original error was severe.
    }
  }
}
