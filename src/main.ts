import { dirname, importx } from "@discordx/importer";
import { Events, IntentsBitField, Partials } from "discord.js";
import { Client } from "discordx";
import process from "node:process";
import { handleDirectMessage } from "./dm.ts";
import { handleServerMessage } from "./server.ts";

export class Main {
  private static client: Client;

  static async start(): Promise<void> {
    const botGuilds = (process.env.DISCORD_GUILD_IDS ?? "")
      .split(/[,\s]+/)
      .map((guildId) => guildId.trim())
      .filter(Boolean);

    Main.client = new Client({
      botGuilds,
      intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.MessageContent,
      ],
      // enable partials to receive direct messages
      partials: [Partials.Channel, Partials.Message],

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

      console.log(
        botGuilds.length
          ? `Bot started with guild-scoped commands for ${botGuilds.join(", ")}`
          : "Bot started with global commands",
      );
    });

    Main.client.on(Events.InteractionCreate, (interaction) => {
      void Main.client.executeInteraction(interaction);
    });

    await importx(`${dirname(import.meta.url)}/commands/**/*.{js,ts}`);

    if (!process.env.BOT_TOKEN) {
      throw Error("Could not find BOT_TOKEN in your environment");
    }
    await Main.client.login(process.env.BOT_TOKEN);
  }
}

void Main.start();
