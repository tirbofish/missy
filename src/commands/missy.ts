import { ApplicationCommandOptionType, CommandInteraction } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import {
  getApiKey,
  hasApiKey,
  parseApiKeyCandidate,
  removeApiKey,
  setApiKey,
} from "../apiKeys.ts";
import {
  fitDiscordMessage,
  MistralApiError,
  sendMistralMessage,
} from "../mistral.ts";

const NO_API_KEY_MESSAGE =
  "Send me your Mistral API key first. You can create one at https://console.mistral.ai/api-keys";

@Discord()
export class MissyCommands {
  @Slash({
    description: "Save your Mistral API key",
    name: "set-api-key",
  })
  async setApiKey(
    @SlashOption({
      description: "Your Mistral API key",
      name: "api-key",
      required: true,
      type: ApplicationCommandOptionType.String,
    }) apiKey: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const parsedApiKey = parseApiKeyCandidate(apiKey) ?? apiKey.trim();

    if (!parsedApiKey) {
      await interaction.reply({
        content: NO_API_KEY_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    await setApiKey(interaction.user.id, parsedApiKey, "slash");
    await interaction.reply({
      content: "Got it - your Mistral API key is saved.",
      ephemeral: true,
    });
  }

  @Slash({
    description: "Chat with Missy using Mistral",
    name: "missy",
  })
  async missy(
    @SlashOption({
      description: "Message to send to Missy",
      name: "message",
      required: true,
      type: ApplicationCommandOptionType.String,
    }) message: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const apiKey = await getApiKey(interaction.user.id);

    if (!apiKey) {
      await interaction.reply({
        content: NO_API_KEY_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const reply = await sendMistralMessage(apiKey, {
        message,
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
        },
      });
      await interaction.editReply(fitDiscordMessage(reply));
    } catch (error) {
      if (error instanceof MistralApiError && error.status === 401) {
        await removeApiKey(interaction.user.id);
        await interaction.editReply(
          "Mistral rejected your API key, so I removed it. Run `/set-api-key` with a new key.",
        );
        return;
      }

      console.error(error);
      await interaction.editReply("Missy couldn't reach Mistral right now.");
    }
  }

  @Slash({
    description: "Send a test message to Missy",
    name: "missy-test",
  })
  async test(interaction: CommandInteraction): Promise<void> {
    const apiKey = await getApiKey(interaction.user.id);

    if (!apiKey) {
      await interaction.reply({
        content: NO_API_KEY_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const reply = await sendMistralMessage(apiKey, {
        message: "Reply with exactly: Missy is connected.",
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
        },
      });
      await interaction.editReply(fitDiscordMessage(reply));
    } catch (error) {
      if (error instanceof MistralApiError && error.status === 401) {
        await removeApiKey(interaction.user.id);
        await interaction.editReply(
          "Mistral rejected your API key, so I removed it. Run `/set-api-key` with a new key.",
        );
        return;
      }

      console.error(error);
      await interaction.editReply(
        "The test message could not be sent to Mistral.",
      );
    }
  }

  @Slash({
    description: "Check whether you have a saved Mistral API key",
    name: "api-key-status",
  })
  async status(interaction: CommandInteraction): Promise<void> {
    const saved = await hasApiKey(interaction.user.id);
    await interaction.reply({
      content: saved
        ? "You have a saved Mistral API key."
        : "You don't have a saved Mistral API key.",
      ephemeral: true,
    });
  }

  @Slash({
    description: "Remove your saved Mistral API key",
    name: "remove-api-key",
  })
  async remove(interaction: CommandInteraction): Promise<void> {
    const removed = await removeApiKey(interaction.user.id);
    await interaction.reply({
      content: removed
        ? "Your Mistral API key was removed."
        : "You didn't have a saved Mistral API key.",
      ephemeral: true,
    });
  }
}
