import { dirname, importx } from "@discordx/importer";
import { Events, IntentsBitField, Partials } from "discord.js";
import { Client } from "discordx";
import process from "node:process";
import { handleDirectMessage } from "./dm.ts";
import { handleMessageReaction } from "./reactions.ts";
import { handleServerMessage } from "./server.ts";

export class Main {
  private static client: Client;

  static async start(): Promise<void> {
    const botGuilds = (process.env.DISCORD_GUILD_IDS ?? "")
      .split(/[,\s]+/)
      .map((guildId) => guildId.trim())
      .filter(Boolean);
    const registerGlobalCommands = shouldRegisterGlobalCommands(botGuilds);

    Main.client = new Client({
      botGuilds,
      intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.DirectMessageReactions,
        IntentsBitField.Flags.MessageContent,
      ],
      // enable partials to receive direct messages
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
      ],

      silent: false,
    });

    Main.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot) {
        return;
      }

      if (!message.guild) {
        void handleDirectMessage(message);
        return;
      }

      const botUserId = Main.client.user?.id;
      if (botUserId) {
        void handleServerMessage(message, botUserId);
      }
    });

    Main.client.once(Events.ClientReady, async () => {
      await Main.client.initApplicationCommands();

      if (botGuilds.length && registerGlobalCommands) {
        const guildScopedBotGuilds = Main.client.botGuilds;
        Main.client.botGuilds = [];

        try {
          await Main.client.initApplicationCommands();
        } finally {
          Main.client.botGuilds = guildScopedBotGuilds;
        }
      } else if (botGuilds.length) {
        await Main.client.application?.commands.set([]);
      }

      console.log(
        botGuilds.length
          ? `Bot started with guild-scoped commands for ${
            botGuilds.join(", ")
          }${
            registerGlobalCommands
              ? " and global commands"
              : " and no global commands"
          }`
          : "Bot started with global commands",
      );
    });

    Main.client.on(Events.InteractionCreate, (interaction) => {
      void Main.client.executeInteraction(interaction);
    });

    Main.client.on(Events.MessageReactionAdd, (reaction, user) => {
      void handleMessageReaction(reaction, user);
    });

    await importx(`${dirname(import.meta.url)}/commands/**/*.{js,ts}`);

    if (!process.env.BOT_TOKEN) {
      throw Error("Could not find BOT_TOKEN in your environment");
    }
    await Main.client.login(process.env.BOT_TOKEN);
  }
}

function shouldRegisterGlobalCommands(botGuilds: string[]): boolean {
  if (botGuilds.length === 0) {
    return true;
  }

  return /^(1|true|yes)$/i.test(
    process.env.DISCORD_REGISTER_GLOBAL_COMMANDS?.trim() ?? "",
  );
}

void Main.start();
