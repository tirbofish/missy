import {
  ApplicationCommandOptionType,
  CommandInteraction,
  InteractionContextType,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { canManageMcp, MCP_ADMIN_REQUIRED_MESSAGE } from "../admin.ts";
import {
  getApiKey,
  hasApiKey,
  parseApiKeyCandidate,
  removeApiKey,
  setApiKey,
} from "../apiKeys.ts";
import {
  appendConversationTurn,
  clearConversationContext,
  getConversationClearPoint,
  getConversationContext,
} from "../context.ts";
import { shouldUsePriorConversation } from "../contextIntent.ts";
import { getInteractionConversationId } from "../conversation.ts";
import {
  buildInteractionHistoryContext,
  maxDiscordHistoryLimit,
  shouldLookPastClearPoint,
} from "../history.ts";
import { actorFromInteraction } from "../discordActor.ts";
import { canAccessLocalComputer } from "../localAccess.ts";
import {
  editReplyWithDiscordMessages,
  requestInteractionFileOperationApproval,
} from "../discord.ts";
import { buildHelpMessage } from "../help.ts";
import { MistralApiError, sendMistralMessage } from "../mistral.ts";
import { addMcpServer, McpServerConfig } from "../mcp.ts";
import {
  clearUserModel,
  defaultMistralModel,
  getEffectiveModel,
  getUserModel,
  parseModelCandidate,
  setUserModel,
} from "../models.ts";
import {
  canShutdownBot,
  SHUTDOWN_REQUIRED_MESSAGE,
  shutdownBot,
} from "../shutdown.ts";

const NO_API_KEY_MESSAGE =
  "Send me your Mistral API key first. You can create one at https://console.mistral.ai/api-keys";
const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const COMMAND_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
];

function parseOptionalStringArray(value?: string): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;

  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("Expected a JSON array of strings.");
  }

  return parsed;
}

function parseOptionalStringRecord(
  value?: string,
): Record<string, string> | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;

  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    !Object.values(parsed).every((item) => typeof item === "string")
  ) {
    throw new Error("Expected a JSON object with string values.");
  }

  return parsed as Record<string, string>;
}

@Discord()
export class MissyCommands {
  private async runShutdownCommand(
    interaction: CommandInteraction,
    commandName: string,
  ): Promise<void> {
    const actor = actorFromInteraction(interaction);

    if (!canShutdownBot(actor)) {
      await interaction.reply({
        content: SHUTDOWN_REQUIRED_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      channelId: interaction.channelId,
      commandName,
      event: "shutdown_command",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      roleIds: actor.roleIds,
    }));
    await interaction.reply({
      content: "Shutting down Missy now.",
      ephemeral: true,
    });
    shutdownBot(
      `Discord slash command ${commandName} by ${interaction.user.id}`,
    );
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
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
    contexts: COMMAND_CONTEXTS,
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
      const conversationId = getInteractionConversationId(interaction);
      const actor = actorFromInteraction(interaction);
      const context = shouldUsePriorConversation(message)
        ? await getConversationContext(conversationId)
        : [];
      const model = await getEffectiveModel(interaction.user.id);
      const reply = await sendMistralMessage(apiKey, {
        message,
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
          roleIds: actor.roleIds,
        },
      }, {
        context,
        model,
        requestFileOperationApproval: canAccessLocalComputer(actor)
          ? (request) =>
            requestInteractionFileOperationApproval(interaction, request)
          : undefined,
      });
      await appendConversationTurn(conversationId, message, reply);
      await editReplyWithDiscordMessages(interaction, reply);
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
    contexts: COMMAND_CONTEXTS,
    description: "Analyze recent messages from this Discord channel",
    name: "analyze-history",
  })
  async analyzeHistory(
    @SlashOption({
      description: "What Missy should look for in the channel history",
      name: "question",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) question: string | undefined,
    @SlashOption({
      description: `Messages to inspect, up to ${maxDiscordHistoryLimit()}`,
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    }) limit: number | undefined,
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
      const conversationId = getInteractionConversationId(interaction);
      const clearPoint = shouldLookPastClearPoint(question ?? "")
        ? undefined
        : await getConversationClearPoint(conversationId);
      const discordHistory = await buildInteractionHistoryContext(
        interaction.channel,
        {
          after: clearPoint?.createdAt,
          limit,
        },
      );

      if (!discordHistory) {
        await interaction.editReply(
          "I couldn't read message history in this channel.",
        );
        return;
      }

      const prompt = question?.trim() ||
        "Analyze this Discord message history. Summarize the main topics, decisions, open questions, and any useful next steps.";
      const context = await getConversationContext(conversationId);
      const model = await getEffectiveModel(interaction.user.id);
      const reply = await sendMistralMessage(apiKey, {
        message: prompt,
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
          roleIds: actorFromInteraction(interaction).roleIds,
        },
      }, {
        context,
        discordHistory,
        model,
      });

      await appendConversationTurn(conversationId, prompt, reply);
      await editReplyWithDiscordMessages(interaction, reply);
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
        "Missy couldn't analyze this channel history right now.",
      );
    }
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Clear Missy's saved context for this conversation",
    name: "clear",
  })
  async clear(interaction: CommandInteraction): Promise<void> {
    await clearConversationContext(
      getInteractionConversationId(interaction),
      {
        createdAt: new Date(interaction.createdTimestamp),
        messageId: interaction.id,
      },
    );

    await interaction.reply({
      content: "Cleared this conversation context.",
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Show Missy's commands and available tools",
    name: "help",
  })
  async help(interaction: CommandInteraction): Promise<void> {
    const actor = actorFromInteraction(interaction);

    await interaction.reply({
      content: buildHelpMessage(canAccessLocalComputer(actor)),
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "View or change your Mistral model",
    name: "model",
  })
  async model(
    @SlashOption({
      description: "Model name, or default/reset to use MISTRAL_MODEL",
      name: "model",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) model: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const requestedModel = model?.trim();

    if (!requestedModel) {
      const userModel = await getUserModel(interaction.user.id);
      const effectiveModel = userModel ?? defaultMistralModel();
      const source = userModel ? "your override" : "the default";

      await interaction.reply({
        content: `Current model: \`${effectiveModel}\` from ${source}.`,
        ephemeral: true,
      });
      return;
    }

    if (/^(default|reset|clear)$/i.test(requestedModel)) {
      await clearUserModel(interaction.user.id);
      await interaction.reply({
        content:
          `Cleared your model override. Current model: \`${defaultMistralModel()}\`.`,
        ephemeral: true,
      });
      return;
    }

    const parsedModel = parseModelCandidate(requestedModel);

    if (!parsedModel) {
      await interaction.reply({
        content:
          "Model names must be 1-128 characters and use only letters, numbers, dots, underscores, colons, slashes, or hyphens.",
        ephemeral: true,
      });
      return;
    }

    await setUserModel(interaction.user.id, parsedModel);
    await interaction.reply({
      content: `Using model \`${parsedModel}\` for your Missy requests.`,
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Stop Missy's running process",
    name: "shutdown",
  })
  async shutdown(interaction: CommandInteraction): Promise<void> {
    await this.runShutdownCommand(interaction, "/shutdown");
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Add or replace a local stdio MCP server",
    name: "mcp-add",
  })
  async mcpAdd(
    @SlashOption({
      description:
        "MCP server name, using letters, numbers, underscores, or hyphens",
      name: "name",
      required: true,
      type: ApplicationCommandOptionType.String,
    }) name: string,
    @SlashOption({
      description: "Executable command, for example npx, node, deno, or python",
      name: "command",
      required: true,
      type: ApplicationCommandOptionType.String,
    }) command: string,
    @SlashOption({
      description: "Optional JSON string array of command args",
      name: "args-json",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) argsJson: string | undefined,
    @SlashOption({
      description: "Optional JSON object of environment variables",
      name: "env-json",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) envJson: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!canManageMcp(actorFromInteraction(interaction))) {
      await interaction.reply({
        content: MCP_ADMIN_REQUIRED_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    try {
      const normalizedName = name.trim();
      const normalizedCommand = command.trim();

      if (!MCP_SERVER_NAME_PATTERN.test(normalizedName)) {
        await interaction.reply({
          content:
            "MCP server names must be 1-32 characters and use only letters, numbers, underscores, or hyphens.",
          ephemeral: true,
        });
        return;
      }

      if (!normalizedCommand) {
        await interaction.reply({
          content: "The MCP command cannot be empty.",
          ephemeral: true,
        });
        return;
      }

      const serverConfig: McpServerConfig = {
        command: normalizedCommand,
        args: parseOptionalStringArray(argsJson),
        env: parseOptionalStringRecord(envJson),
      };

      await addMcpServer(normalizedName, serverConfig);
      await interaction.reply({
        content:
          `Added MCP server \`${normalizedName}\`. Its tools will be available on the next Missy request.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: error instanceof Error
          ? `Could not add that MCP server: ${error.message}`
          : "Could not add that MCP server.",
        ephemeral: true,
      });
    }
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
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
    contexts: COMMAND_CONTEXTS,
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
