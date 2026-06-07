import { Message } from "discord.js";
import { getEffectiveApiKey, removeResolvedApiKey } from "./apiKeys.ts";
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
} from "./currentLookup.ts";
import { actorFromMessage } from "./discordActor.ts";
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
import {
  buildDiscordHistoryContext,
  shouldLookPastClearPoint,
} from "./history.ts";
import { canAccessLocalComputer } from "./localAccess.ts";
import {
  buildMessageContent,
  hasMessageCommandPrefix,
} from "./messageContent.ts";
import { MistralApiError, sendMistralMessage } from "./mistral.ts";
import { getEffectiveModel } from "./models.ts";
import {
  canShutdownBot,
  SHUTDOWN_REQUIRED_MESSAGE,
  shutdownBot,
} from "./shutdown.ts";

const NEEDS_API_KEY_MESSAGE =
  "Run `/set-api-key` once in this server first. You can create a Mistral API key at https://console.mistral.ai/api-keys";

function isClearCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "clear" || command === "/clear";
}

function isShutdownCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "/shutdown" || command === "shutdown";
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
  const mentionedBot = message.mentions.users.has(botUserId);
  const prefixedCommand = hasMessageCommandPrefix(message.content);
  const repliedToBot = mentionedBot || prefixedCommand
    ? false
    : await isReplyToBot(message, botUserId);

  if (!mentionedBot && !repliedToBot && !prefixedCommand) {
    return;
  }

  const mistralMessage = buildMessageContent(message, botUserId);
  if (!mistralMessage) {
    await message.reply("Send me a message for Missy.");
    return;
  }

  const conversationId = getMessageConversationId(message);
  const actor = actorFromMessage(message);

  if (isHelpCommand(mistralMessage)) {
    await message.reply(
      buildHelpMessage(canAccessLocalComputer(actor)),
    );
    return;
  }

  if (isSystemPromptRequest(mistralMessage)) {
    await message.reply(SYSTEM_PROMPT_DENIAL_MESSAGE);
    return;
  }

  if (isClearCommand(mistralMessage)) {
    await clearConversationContext(conversationId, {
      createdAt: message.createdAt,
      messageId: message.id,
    });
    await message.reply("Cleared this conversation context.");
    return;
  }

  if (isShutdownCommand(mistralMessage)) {
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

  try {
    if (isCurrentLookupRequest(mistralMessage)) {
      await message.reply(currentLookupStatusMessage(mistralMessage));
    }

    await sendTyping(message);
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
    const model = await getEffectiveModel(message.author.id);
    const reply = await sendMistralMessage(resolvedApiKey.apiKey, {
      message: mistralMessage,
      source: "discord-server",
      discord: {
        userId: message.author.id,
        username: message.author.tag,
        channelId: message.channelId,
        guildId: message.guildId ?? undefined,
        roleIds: actor.roleIds,
      },
    }, {
      context,
      discordHistory,
      model,
      requestFileOperationApproval: canAccessLocalComputer(actor)
        ? (request) => requestMessageFileOperationApproval(message, request)
        : undefined,
    });
    await appendConversationTurn(conversationId, mistralMessage, reply);
    await replyWithDiscordMessages(message, reply);
  } catch (error) {
    if (error instanceof MistralApiError && error.status === 401) {
      await removeResolvedApiKey(resolvedApiKey);
      await message.reply(
        resolvedApiKey.scope === "guild"
          ? "Mistral rejected this server's API key, so I removed it. Run `/set-api-key` with a new key."
          : "Mistral rejected your API key, so I removed it. Run `/set-api-key` with a new key.",
      );
      return;
    }

    console.error(error);
    await message.reply("Missy couldn't reach Mistral right now.");
  }
}
