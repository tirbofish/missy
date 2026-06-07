import { CommandInteraction, Message } from "discord.js";

export function getMessageConversationId(message: Message): string {
  if (!message.guildId) {
    return `dm:${message.author.id}`;
  }

  return `server:${message.guildId}:${message.channelId}:${message.author.id}`;
}

export function getInteractionConversationId(
  interaction: CommandInteraction,
): string {
  if (!interaction.guildId) {
    return `dm:${interaction.user.id}`;
  }

  return `server:${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`;
}
