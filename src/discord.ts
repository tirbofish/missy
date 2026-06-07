import { Message } from "discord.js";

type TypingChannel = {
  sendTyping: () => Promise<void>;
};

export async function sendTyping(message: Message): Promise<void> {
  const channel = message.channel as Partial<TypingChannel>;

  if (typeof channel.sendTyping === "function") {
    await channel.sendTyping();
  }
}
