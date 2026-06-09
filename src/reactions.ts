import {
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { getEffectiveApiKey, removeResolvedApiKey } from "./apiKeys.ts";
import { appendConversationTurn, getConversationContext } from "./context.ts";
import { replyWithDiscordMessages } from "./discord.ts";
import {
  formatMediaAttachments,
  MediaAttachment,
  visionImageUrls,
} from "./media.ts";
import { MistralApiError } from "./mistral/mod.ts";
import { sendModelMessage } from "./modelProviders.ts";
import { getEffectiveModel } from "./models.ts";

type ReactionUser = User | PartialUser;
type ReactionPayload = MessageReaction | PartialMessageReaction;

function reactionConversationId(message: Message, user: ReactionUser): string {
  if (!message.guildId) {
    return `dm:${user.id}`;
  }

  return `server:${message.guildId}:${message.channelId}:${user.id}`;
}

function userLabel(user: ReactionUser): string {
  return user.globalName?.trim() ||
    user.tag ||
    user.username?.trim() ||
    user.id;
}

async function reactionUserDisplayName(
  message: Message,
  user: ReactionUser,
): Promise<string> {
  if (!message.guild) {
    return userLabel(user);
  }

  try {
    const member = await message.guild.members.fetch(user.id);
    return member.displayName.trim() || userLabel(user);
  } catch {
    return userLabel(user);
  }
}

function messageAuthorLabel(message: Message): string {
  return message.member?.displayName?.trim() ||
    message.author.globalName?.trim() ||
    message.author.tag;
}

function reactionEmojiLabel(reaction: ReactionPayload): string {
  return reaction.emoji.toString() || reaction.emoji.name || "a reaction";
}

function reactionMeaning(emoji: string): string | undefined {
  if (emoji === "\u{1F345}") {
    return "Interpret the tomato emoji as throwing a tomato at the message: playful old-timey theater booing, heckling, or disapproval, not literal tomato discussion.";
  }

  return emoji === "🍅"
    ? "Interpret 🍅 as throwing a tomato at the message: playful old-timey theater booing, heckling, or disapproval, not literal tomato discussion."
    : undefined;
}

export function buildReactionPrompt(
  reaction: ReactionPayload,
  user: ReactionUser,
  message: Message,
): string {
  const messageContent = message.content.trim() || "[no text content]";
  const attachments = [...message.attachments.values()].map((attachment) => ({
    contentType: attachment.contentType,
    name: attachment.name,
    size: attachment.size,
    url: attachment.url,
  }));
  const ownMessage = message.author.id === message.client.user?.id;

  return formatReactionPrompt({
    attachments,
    emoji: reactionEmojiLabel(reaction),
    messageAuthor: messageAuthorLabel(message),
    messageContent,
    ownMessage,
    user: userLabel(user),
  });
}

export function formatReactionPrompt(input: {
  attachments?: readonly MediaAttachment[];
  emoji: string;
  messageAuthor: string;
  messageContent: string;
  ownMessage?: boolean;
  user: string;
}): string {
  const messageContent = input.messageContent.trim() || "[no text content]";
  const attachmentBlock = formatMediaAttachments(input.attachments ?? []);
  const ownMessageLine = input.ownMessage
    ? "The reacted message is one of your own messages."
    : undefined;

  const promptParts = [
    "Discord reaction event.",
    `${input.user} replied to this message from ${input.messageAuthor} with ${input.emoji}:`,
  ];

  if (ownMessageLine) {
    promptParts.push(ownMessageLine);
  }

  const meaning = reactionMeaning(input.emoji);
  if (meaning) {
    promptParts.push(meaning);
  }

  promptParts.push(messageContent);

  if (attachmentBlock) {
    promptParts.push(attachmentBlock);
  }

  promptParts.push(
    "",
    "Reply only if the reaction deserves a response. If no text reply is better, use MISSY_NO_REPLY. If reacting is better, use MISSY_REACT: <emoji>.",
  );

  return promptParts.join("\n").trim();
}

async function fetchReactionMessage(
  reaction: ReactionPayload,
): Promise<Message | undefined> {
  const resolvedReaction = reaction.partial ? await reaction.fetch() : reaction;
  const message = resolvedReaction.message.partial
    ? await resolvedReaction.message.fetch()
    : resolvedReaction.message;

  return message instanceof Message ? message : undefined;
}

async function fetchReactionUser(user: ReactionUser): Promise<ReactionUser> {
  return user.partial ? await user.fetch() : user;
}

export async function handleMessageReaction(
  reaction: ReactionPayload,
  user: ReactionUser,
): Promise<void> {
  let resolvedUser: ReactionUser;

  try {
    resolvedUser = await fetchReactionUser(user);
  } catch (error) {
    console.error("Could not fetch reacting Discord user", error);
    return;
  }

  if (resolvedUser.bot) {
    return;
  }

  let message: Message | undefined;

  try {
    message = await fetchReactionMessage(reaction);
  } catch (error) {
    console.error("Could not fetch reacted Discord message", error);
    return;
  }

  if (!message) {
    return;
  }

  const resolvedApiKey = await getEffectiveApiKey(
    resolvedUser.id,
    message.guildId,
  );

  if (!resolvedApiKey) {
    return;
  }

  const conversationId = reactionConversationId(message, resolvedUser);
  const prompt = buildReactionPrompt(reaction, resolvedUser, message);

  try {
    const model = await getEffectiveModel(resolvedUser.id);
    const displayName = await reactionUserDisplayName(message, resolvedUser);
    const reply = await sendModelMessage(resolvedApiKey.apiKey, {
      imageUrls: visionImageUrls(
        [...message.attachments.values()].map((attachment) => ({
          contentType: attachment.contentType,
          name: attachment.name,
          size: attachment.size,
          url: attachment.url,
        })),
      ),
      message: prompt,
      source: message.guildId ? "discord-server" : "discord-dm",
      discord: {
        userId: resolvedUser.id,
        username: userLabel(resolvedUser),
        displayName,
        channelId: message.channelId,
        guildId: message.guildId ?? undefined,
      },
    }, {
      context: await getConversationContext(conversationId),
      model,
    });

    await appendConversationTurn(conversationId, prompt, reply);
    await replyWithDiscordMessages(message, reply);
  } catch (error) {
    if (error instanceof MistralApiError && error.status === 401) {
      await removeResolvedApiKey(resolvedApiKey);
      return;
    }

    console.error(error);
  }
}
