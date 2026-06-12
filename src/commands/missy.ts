import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  CommandInteraction,
  InteractionContextType,
  MessageContextMenuCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserContextMenuCommandInteraction,
} from "discord.js";
import {
  ButtonComponent,
  ContextMenu,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashOption,
} from "discordx";
import { canManageMcp, MCP_ADMIN_REQUIRED_MESSAGE } from "../admin.ts";
import {
  addAutomation,
  Automation,
  AUTOMATION_ADD_MODAL_ID,
  AUTOMATION_PROMPT_INPUT_ID,
  AUTOMATION_TRIGGER_INPUT_ID,
  automationComponentId,
  automationEditModalId,
  automationIdAutocompleteChoices,
  buildAutomationListMessage,
  clearAutomations,
  listAutomations,
  parseAutomationComponentId,
  parseAutomationEditModalId,
  removeAutomation,
  setAutomationEnabled,
  updateAutomation,
} from "../automations.ts";
import {
  getApiKey,
  getEffectiveApiKey,
  hasGuildApiKey,
  parseApiKeyCandidate,
  removeApiKey,
  removeGuildApiKey,
  removeResolvedApiKey,
  ResolvedApiKey,
  setApiKey,
  setGuildApiKey,
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
import {
  actorFromInteraction,
  displayNameFromInteraction,
} from "../discordActor.ts";
import { canAccessLocalComputer } from "../localAccess.ts";
import {
  addMemory,
  buildMemoryContext,
  buildMemoryListMessage,
  buildMessageMemoryContent,
  buildScopedMemoryListMessage,
  buildUserMemoryContent,
  clearMemories,
  clearUserServerMemories,
  getScopedMemories,
  listMemories,
  MEMORY_CONTENT_INPUT_ID,
  memoryAddModalId,
  memoryComponentId,
  MemoryEntry,
  memoryIdAutocompleteChoices,
  MemoryScope,
  parseMemoryAddModalId,
  parseMemoryComponentId,
  parseMemoryScope,
  removeMemory,
  saveInferredUserMemories,
} from "../memories.ts";
import {
  agentToolActivityContent,
  createInteractionAgentActivity,
  editReplyWithDiscordMessages,
} from "../discord.ts";
import { discordServerToolContextFromInteraction } from "../discordServerTools.ts";
import { buildHelpMessage } from "../help.ts";
import { MistralApiError } from "../mistral/mod.ts";
import { sendModelMessage } from "../modelProviders.ts";
import {
  formatMistralModelStatus,
  listMistralModels,
} from "../mistralStatus.ts";
import {
  addMcpServer,
  buildOAuthConsentUrl,
  completeOAuthFlow,
  McpOAuthConfig,
  McpServerConfig,
  OAuthFlowOptions,
} from "../mcp.ts";
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
import {
  buildSkillDetailMessage,
  buildSkillsOverviewMessage,
  SKILLS_SELECT_ID,
  skillSelectOptions,
} from "../skills.ts";
import {
  AUTOMATION_ACTIONS, AUTOMATION_COMPONENT_ID_PATTERN, AUTOMATION_EDIT_MODAL_ID_PATTERN,
  autocompleteAutomationIds, autocompleteMemoryIds, canEditAutomations, canEditMemoryScope,
  COMMAND_CONTEXTS, getInteractionApiKey, GUILD_COMMAND_CONTEXTS, MAX_AUTOMATION_COMPONENT_ITEMS,
  MAX_MEMORY_SELECT_ITEMS, MCP_SERVER_NAME_PATTERN, MEMORY_ACTIONS, MEMORY_ADD_MODAL_ID_PATTERN,
  MEMORY_BUTTON_ID_PATTERN, MEMORY_DELETE_SELECT_ID_PATTERN, MEMORY_SCOPES,
  NO_API_KEY_MESSAGE, parseOptionalStringArray, parseOptionalStringRecord, rejectedApiKeyMessage,
} from "./helpers.ts";
import {
  automationPanelContent, buildAutomationAddModal, buildAutomationComponents,
  buildAutomationEditModal, buildMemoryAddModal, buildMemoryComponents,
  memoryPanelContent, skillComponents,
} from "./components.ts";


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
    description: "Save a model provider API key for this server or DM",
    name: "set-api-key",
  })
  async setApiKey(
    @SlashOption({
      description: "Your model provider API key",
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

    if (interaction.guildId) {
      await setGuildApiKey(interaction.guildId, parsedApiKey);
      await interaction.reply({
        content:
          "Got it - this server's model provider API key is saved. Everyone in this server can use Missy with it.",
        ephemeral: true,
      });
      return;
    }

    await setApiKey(interaction.user.id, parsedApiKey, "slash");
    await interaction.reply({
      content: "Got it - your model provider API key is saved.",
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Chat with Missy using the configured model provider",
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
    const resolvedApiKey = await getInteractionApiKey(interaction);

    if (!resolvedApiKey) {
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
      const agentActivity = createInteractionAgentActivity(interaction);
      const context = shouldUsePriorConversation(message)
        ? await getConversationContext(conversationId)
        : [];
      await saveInferredUserMemories({
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      }, message);
      const memoryContext = await buildMemoryContext({
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      });
      const model = await getEffectiveModel(interaction.user.id);
      const reply = await sendModelMessage(resolvedApiKey.apiKey, {
        message,
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          displayName: displayNameFromInteraction(interaction),
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
          roleIds: actor.roleIds,
        },
      }, {
        context,
        discordServerToolContext: discordServerToolContextFromInteraction(
          interaction,
        ),
        memoryContext,
        model,
        onToolActivity: (activity) =>
          agentActivity.update(agentToolActivityContent(activity)),
        requestFileOperationApproval: canAccessLocalComputer(actor)
          ? (request) => agentActivity.requestFileOperationApproval(request)
          : undefined,
      });
      await appendConversationTurn(conversationId, message, reply);
      const finalReplySent = await editReplyWithDiscordMessages(
        interaction,
        reply,
        {
          requestFileOperationApproval: canAccessLocalComputer(actor)
            ? (request) => agentActivity.requestFileOperationApproval(request)
            : undefined,
        },
      );
      await agentActivity.finish(finalReplySent);
    } catch (error) {
      if (error instanceof MistralApiError && error.status === 401) {
        await removeResolvedApiKey(resolvedApiKey);
        await interaction.editReply(rejectedApiKeyMessage(resolvedApiKey));
        return;
      }

      console.error(error);
      await interaction.editReply(
        "Missy couldn't reach the model provider right now.",
      );
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
    const resolvedApiKey = await getInteractionApiKey(interaction);

    if (!resolvedApiKey) {
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
      const memoryContext = await buildMemoryContext({
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      });
      const model = await getEffectiveModel(interaction.user.id);
      const reply = await sendModelMessage(resolvedApiKey.apiKey, {
        message: prompt,
        source: "discord-slash",
        discord: {
          userId: interaction.user.id,
          username: interaction.user.tag,
          displayName: displayNameFromInteraction(interaction),
          channelId: interaction.channelId,
          guildId: interaction.guildId ?? undefined,
          roleIds: actorFromInteraction(interaction).roleIds,
        },
      }, {
        context,
        discordHistory,
        discordServerToolContext: discordServerToolContextFromInteraction(
          interaction,
        ),
        memoryContext,
        model,
      });

      await appendConversationTurn(conversationId, prompt, reply);
      await editReplyWithDiscordMessages(interaction, reply);
    } catch (error) {
      if (error instanceof MistralApiError && error.status === 401) {
        await removeResolvedApiKey(resolvedApiKey);
        await interaction.editReply(rejectedApiKeyMessage(resolvedApiKey));
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
    const clearedMemories = await clearUserServerMemories({
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    });

    await interaction.reply({
      content: clearedMemories
        ? `Cleared this conversation context and ${clearedMemories} user+server memories.`
        : "Cleared this conversation context.",
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "List Missy's skills",
    name: "skills",
  })
  async skills(interaction: CommandInteraction): Promise<void> {
    const actor = actorFromInteraction(interaction);
    const hasLocalAccess = canAccessLocalComputer(actor);

    await interaction.reply({
      components: skillComponents(hasLocalAccess),
      content: buildSkillsOverviewMessage(hasLocalAccess),
      ephemeral: true,
    });
  }

  @SelectMenuComponent({
    id: SKILLS_SELECT_ID,
  })
  async skillsSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const hasLocalAccess = canAccessLocalComputer(actorFromInteraction(
      interaction,
    ));
    const skillId = interaction.values.at(0) ?? "";

    await interaction.update({
      components: skillComponents(hasLocalAccess),
      content: buildSkillDetailMessage(skillId, hasLocalAccess),
    });
  }

  @ContextMenu({
    contexts: COMMAND_CONTEXTS,
    name: "Missy: remember message",
    type: ApplicationCommandType.Message,
  })
  async rememberMessage(
    interaction: MessageContextMenuCommandInteraction,
  ): Promise<void> {
    const targetMessage = interaction.targetMessage;
    const content = buildMessageMemoryContent({
      attachmentCount: targetMessage.attachments.size,
      authorLabel: targetMessage.author.tag,
      content: targetMessage.content,
    });

    if (!content) {
      await interaction.reply({
        content: "That message has no text or attachments to remember.",
        ephemeral: true,
      });
      return;
    }

    const scope = interaction.guildId ? "user-server" : "user";
    const memory = await addMemory(
      scope,
      {
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      },
      content,
      interaction.user.id,
    );

    await interaction.reply({
      content: `Saved ${scope} memory \`${memory.id}\` from that message.`,
      ephemeral: true,
    });
  }

  @ContextMenu({
    contexts: COMMAND_CONTEXTS,
    name: "Missy: remember user",
    type: ApplicationCommandType.User,
  })
  async rememberUser(
    interaction: UserContextMenuCommandInteraction,
  ): Promise<void> {
    const targetUser = interaction.targetUser;
    const targetMember = interaction.targetMember;
    const displayName = targetMember && "displayName" in targetMember
      ? targetMember.displayName
      : undefined;
    const scope = interaction.guildId ? "user-server" : "user";
    const memory = await addMemory(
      scope,
      {
        guildId: interaction.guildId ?? undefined,
        userId: targetUser.id,
      },
      buildUserMemoryContent({
        displayName,
        userId: targetUser.id,
        username: targetUser.tag,
      }),
      interaction.user.id,
    );

    await interaction.reply({
      content: `Saved ${scope} memory \`${memory.id}\` for ${targetUser.tag}.`,
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "List, add, remove, or clear persistent memories",
    name: "memory",
  })
  async memory(
    @SlashChoice(...MEMORY_ACTIONS)
    @SlashOption({
      description: "list, add, remove, or clear",
      name: "action",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    action: string | undefined,
    @SlashChoice(...MEMORY_SCOPES)
    @SlashOption({
      description: "user, server, or user-server",
      name: "scope",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    scope: string | undefined,
    @SlashOption({
      description: "Memory text for action:add",
      name: "content",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) content: string | undefined,
    @SlashOption({
      autocomplete: autocompleteMemoryIds,
      description: "Memory id for action:remove",
      name: "id",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) id: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const normalizedAction = action?.trim().toLowerCase() || "list";
    const parsedScope = scope
      ? parseMemoryScope(scope)
      : interaction.guildId
      ? "user-server"
      : "user";
    const context = {
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    };

    if (!parsedScope) {
      await interaction.reply({
        content: "Memory scope must be `user`, `server`, or `user-server`.",
        ephemeral: true,
      });
      return;
    }

    if (
      !interaction.guildId &&
      (parsedScope === "server" || parsedScope === "user-server")
    ) {
      await interaction.reply({
        content: "Server-scoped memories can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    try {
      if (normalizedAction === "list") {
        const entries = await listMemories(parsedScope, context);
        await interaction.reply({
          components: buildMemoryComponents(parsedScope, entries),
          content: memoryPanelContent(parsedScope, entries),
          ephemeral: true,
        });
        return;
      }

      if (!canEditMemoryScope(interaction, parsedScope)) {
        await interaction.reply({
          content:
            "You need Discord's Manage Server permission to edit server memories.",
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "add") {
        if (!content?.trim()) {
          await interaction.reply({
            content: "Use `content` with `action:add`.",
            ephemeral: true,
          });
          return;
        }

        const memory = await addMemory(
          parsedScope,
          context,
          content,
          interaction.user.id,
        );
        await interaction.reply({
          content:
            `Saved ${parsedScope} memory \`${memory.id}\`: ${memory.content}`,
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "remove") {
        if (!id?.trim()) {
          await interaction.reply({
            content: "Use `id` with `action:remove`.",
            ephemeral: true,
          });
          return;
        }

        const removed = await removeMemory(parsedScope, context, id);
        await interaction.reply({
          content: removed
            ? `Removed ${parsedScope} memory \`${id.trim()}\`.`
            : `No ${parsedScope} memory found with id \`${id.trim()}\`.`,
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "clear") {
        const cleared = await clearMemories(parsedScope, context);
        await interaction.reply({
          content: `Cleared ${cleared} ${parsedScope} memories.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: "Memory action must be `list`, `add`, `remove`, or `clear`.",
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: error instanceof Error
          ? `Could not update memories: ${error.message}`
          : "Could not update memories.",
        ephemeral: true,
      });
    }
  }

  @ButtonComponent({
    id: MEMORY_BUTTON_ID_PATTERN,
  })
  async memoryButton(interaction: ButtonInteraction): Promise<void> {
    const component = parseMemoryComponentId(interaction.customId);

    if (!component) {
      await interaction.reply({
        content: "That memory control is no longer valid.",
        ephemeral: true,
      });
      return;
    }

    if (
      !interaction.guildId &&
      (component.scope === "server" || component.scope === "user-server")
    ) {
      await interaction.reply({
        content: "Server-scoped memories can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (
      component.action !== "refresh" &&
      !canEditMemoryScope(interaction, component.scope)
    ) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit server memories.",
        ephemeral: true,
      });
      return;
    }

    const context = {
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    };

    if (component.action === "add") {
      await interaction.showModal(buildMemoryAddModal(component.scope));
      return;
    }

    if (component.action === "clear") {
      await clearMemories(component.scope, context);
    }

    const entries = await listMemories(component.scope, context);
    await interaction.update({
      components: buildMemoryComponents(component.scope, entries),
      content: memoryPanelContent(component.scope, entries),
    });
  }

  @SelectMenuComponent({
    id: MEMORY_DELETE_SELECT_ID_PATTERN,
  })
  async memoryDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const component = parseMemoryComponentId(interaction.customId);
    const memoryId = interaction.values.at(0);

    if (!component || component.action !== "delete" || !memoryId) {
      await interaction.reply({
        content: "That memory delete menu is no longer valid.",
        ephemeral: true,
      });
      return;
    }

    if (
      !interaction.guildId &&
      (component.scope === "server" || component.scope === "user-server")
    ) {
      await interaction.reply({
        content: "Server-scoped memories can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (!canEditMemoryScope(interaction, component.scope)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit server memories.",
        ephemeral: true,
      });
      return;
    }

    const context = {
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    };
    await removeMemory(component.scope, context, memoryId);
    const entries = await listMemories(component.scope, context);

    await interaction.update({
      components: buildMemoryComponents(component.scope, entries),
      content: memoryPanelContent(component.scope, entries),
    });
  }

  @ModalComponent({
    id: MEMORY_ADD_MODAL_ID_PATTERN,
  })
  async memoryAddModal(interaction: ModalSubmitInteraction): Promise<void> {
    const scope = parseMemoryAddModalId(interaction.customId);

    if (!scope) {
      await interaction.reply({
        content: "That memory modal is no longer valid.",
        ephemeral: true,
      });
      return;
    }

    if (
      !interaction.guildId &&
      (scope === "server" || scope === "user-server")
    ) {
      await interaction.reply({
        content: "Server-scoped memories can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (!canEditMemoryScope(interaction, scope)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit server memories.",
        ephemeral: true,
      });
      return;
    }

    const context = {
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
    };
    const memory = await addMemory(
      scope,
      context,
      interaction.fields.getTextInputValue(MEMORY_CONTENT_INPUT_ID),
      interaction.user.id,
    );
    const entries = await listMemories(scope, context);

    await interaction.reply({
      components: buildMemoryComponents(scope, entries),
      content: `Saved ${scope} memory \`${memory.id}\`.\n\n${
        memoryPanelContent(scope, entries)
      }`,
      ephemeral: true,
    });
  }

  @Slash({
    contexts: GUILD_COMMAND_CONTEXTS,
    description: "List, add, edit, remove, or clear server automations",
    name: "automation",
  })
  async automation(
    @SlashChoice(...AUTOMATION_ACTIONS)
    @SlashOption({
      description: "list, add, edit, remove, or clear",
      name: "action",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    action: string | undefined,
    @SlashOption({
      description: "Trigger text for action:add",
      name: "trigger",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) trigger: string | undefined,
    @SlashOption({
      description: "Instruction Missy should follow for action:add",
      name: "prompt",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) prompt: string | undefined,
    @SlashOption({
      channelTypes: [
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
        ChannelType.GuildText,
        ChannelType.PublicThread,
      ],
      description:
        "Optional channel where this automation can trigger for add/edit",
      name: "channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    }) channel: { id: string } | undefined,
    @SlashOption({
      autocomplete: autocompleteAutomationIds,
      description: "Automation id for action:edit or action:remove",
      name: "id",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) id: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "Automations can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const normalizedAction = action?.trim().toLowerCase() || "list";

    if (normalizedAction === "list") {
      const automations = await listAutomations(guildId);
      await interaction.reply({
        components: buildAutomationComponents(automations),
        content: automationPanelContent(automations),
        ephemeral: true,
      });
      return;
    }

    if (!canEditAutomations(interaction)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit automations.",
        ephemeral: true,
      });
      return;
    }

    try {
      if (normalizedAction === "add") {
        if (!trigger?.trim() || !prompt?.trim()) {
          await interaction.reply({
            content: "Use `trigger` and `prompt` with `action:add`.",
            ephemeral: true,
          });
          return;
        }

        const automation = await addAutomation(
          guildId,
          trigger,
          prompt,
          interaction.user.id,
          channel?.id,
        );
        await interaction.reply({
          content: `Added automation \`${automation.id}\` ${
            automation.channelId ? `for <#${automation.channelId}> ` : ""
          }for messages containing \`${automation.trigger}\`.`,
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "edit") {
        if (!id?.trim()) {
          await interaction.reply({
            content: "Use `id` with `action:edit`.",
            ephemeral: true,
          });
          return;
        }

        if (!trigger?.trim() && !prompt?.trim() && !channel?.id) {
          await interaction.reply({
            content:
              "Use at least one of `trigger`, `prompt`, or `channel` with `action:edit`.",
            ephemeral: true,
          });
          return;
        }

        const automation = await updateAutomation(guildId, id, {
          ...(trigger?.trim() ? { trigger } : {}),
          ...(prompt?.trim() ? { prompt } : {}),
          ...(channel?.id ? { channelId: channel.id } : {}),
        });
        await interaction.reply({
          content: automation
            ? `Updated automation \`${automation.id}\`: ${
              automation.channelId ? `in <#${automation.channelId}> ` : ""
            }when message contains \`${automation.trigger}\`.`
            : `No automation found with id \`${id.trim()}\`.`,
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "remove") {
        if (!id?.trim()) {
          await interaction.reply({
            content: "Use `id` with `action:remove`.",
            ephemeral: true,
          });
          return;
        }

        const removed = await removeAutomation(guildId, id);
        await interaction.reply({
          content: removed
            ? `Removed automation \`${id.trim()}\`.`
            : `No automation found with id \`${id.trim()}\`.`,
          ephemeral: true,
        });
        return;
      }

      if (normalizedAction === "clear") {
        const cleared = await clearAutomations(guildId);
        await interaction.reply({
          content: `Cleared ${cleared} automations.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content:
          "Automation action must be `list`, `add`, `edit`, `remove`, or `clear`.",
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: error instanceof Error
          ? `Could not update automations: ${error.message}`
          : "Could not update automations.",
        ephemeral: true,
      });
    }
  }

  @ButtonComponent({
    id: AUTOMATION_COMPONENT_ID_PATTERN,
  })
  async automationButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const component = parseAutomationComponentId(interaction.customId);

    if (!guildId || !component) {
      await interaction.reply({
        content: "That automation control is no longer valid.",
        ephemeral: true,
      });
      return;
    }

    if (component.action === "add") {
      if (!canEditAutomations(interaction)) {
        await interaction.reply({
          content:
            "You need Discord's Manage Server permission to edit automations.",
          ephemeral: true,
        });
        return;
      }

      await interaction.showModal(buildAutomationAddModal());
      return;
    }

    if (component.action === "refresh") {
      const automations = await listAutomations(guildId);
      await interaction.update({
        components: buildAutomationComponents(automations),
        content: automationPanelContent(automations),
      });
      return;
    }

    if (!canEditAutomations(interaction)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit automations.",
        ephemeral: true,
      });
      return;
    }

    const automationId = component.automationId;
    if (!automationId) {
      await interaction.reply({
        content: "That automation control is missing an automation id.",
        ephemeral: true,
      });
      return;
    }

    if (component.action === "edit") {
      const automations = await listAutomations(guildId);
      const automation = automations.find((automation) =>
        automation.id === automationId
      );

      if (!automation) {
        await interaction.reply({
          content: `No automation found with id \`${automationId}\`.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.showModal(buildAutomationEditModal(automation));
      return;
    }

    if (component.action === "delete") {
      await removeAutomation(guildId, automationId);
    } else {
      const automations = await listAutomations(guildId);
      const automation = automations.find((automation) =>
        automation.id === automationId
      );
      if (automation) {
        await setAutomationEnabled(guildId, automationId, !automation.enabled);
      }
    }

    const automations = await listAutomations(guildId);
    await interaction.update({
      components: buildAutomationComponents(automations),
      content: automationPanelContent(automations),
    });
  }

  @ModalComponent({
    id: AUTOMATION_ADD_MODAL_ID,
  })
  async automationAddModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "Automations can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (!canEditAutomations(interaction)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit automations.",
        ephemeral: true,
      });
      return;
    }

    const automation = await addAutomation(
      guildId,
      interaction.fields.getTextInputValue(AUTOMATION_TRIGGER_INPUT_ID),
      interaction.fields.getTextInputValue(AUTOMATION_PROMPT_INPUT_ID),
      interaction.user.id,
    );
    const automations = await listAutomations(guildId);

    await interaction.reply({
      components: buildAutomationComponents(automations),
      content: `Added automation \`${automation.id}\`.\n\n${
        automationPanelContent(automations)
      }`,
      ephemeral: true,
    });
  }

  @ModalComponent({
    id: AUTOMATION_EDIT_MODAL_ID_PATTERN,
  })
  async automationEditModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const guildId = interaction.guildId;
    const automationId = parseAutomationEditModalId(interaction.customId);

    if (!guildId || !automationId) {
      await interaction.reply({
        content: "That automation modal is no longer valid.",
        ephemeral: true,
      });
      return;
    }

    if (!canEditAutomations(interaction)) {
      await interaction.reply({
        content:
          "You need Discord's Manage Server permission to edit automations.",
        ephemeral: true,
      });
      return;
    }

    const automation = await updateAutomation(guildId, automationId, {
      prompt: interaction.fields.getTextInputValue(
        AUTOMATION_PROMPT_INPUT_ID,
      ),
      trigger: interaction.fields.getTextInputValue(
        AUTOMATION_TRIGGER_INPUT_ID,
      ),
    });

    if (!automation) {
      await interaction.reply({
        content: `No automation found with id \`${automationId}\`.`,
        ephemeral: true,
      });
      return;
    }

    const automations = await listAutomations(guildId);
    await interaction.reply({
      components: buildAutomationComponents(automations),
      content: `Updated automation \`${automation.id}\`.\n\n${
        automationPanelContent(automations)
      }`,
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
    description: "View or change your model",
    name: "model",
  })
  async model(
    @SlashOption({
      description: "Model name, router, or default/reset to use MISTRAL_MODEL",
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
    description: "Add or replace an MCP server (local stdio or remote HTTP)",
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
      description:
        "Executable command (e.g. npx, node, deno) or a remote URL (https://...)",
      name: "command",
      required: true,
      type: ApplicationCommandOptionType.String,
    }) command: string,
    @SlashOption({
      description: "Optional JSON string array of command args (stdio only)",
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
    @SlashOption({
      description: "OAuth client ID (for remote HTTP servers needing auth)",
      name: "oauth-client-id",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthClientId: string | undefined,
    @SlashOption({
      description: "OAuth client secret (for remote HTTP servers needing auth)",
      name: "oauth-client-secret",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthClientSecret: string | undefined,
    @SlashOption({
      description: "OAuth refresh token (skip interactive flow if provided)",
      name: "oauth-refresh-token",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthRefreshToken: string | undefined,
    @SlashOption({
      description: "OAuth authorize URL for the remote MCP server",
      name: "oauth-auth-url",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthAuthUrl: string | undefined,
    @SlashOption({
      description: "OAuth token URL for the remote MCP server",
      name: "oauth-token-url",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthTokenUrl: string | undefined,
    @SlashOption({
      description: "OAuth scopes for the remote MCP server (space-separated)",
      name: "oauth-scopes",
      required: false,
      type: ApplicationCommandOptionType.String,
    }) oauthScopes: string | undefined,
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

      let oauth: McpOAuthConfig | undefined;
      const isRemote = /^https?:\/\//i.test(normalizedCommand);
      const scopes = oauthScopes?.trim().split(/\s+/).filter(Boolean) ?? [];
      const oauthOptions = oauthAuthUrl?.trim() && oauthTokenUrl?.trim() &&
          scopes.length > 0
        ? {
          authUrl: oauthAuthUrl.trim(),
          tokenUrl: oauthTokenUrl.trim(),
          scopes,
        } satisfies OAuthFlowOptions
        : undefined;

      if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
        if (!oauthTokenUrl?.trim()) {
          await interaction.reply({
            content:
              "`oauth-token-url` is required when saving an OAuth refresh token.",
            ephemeral: true,
          });
          return;
        }

        oauth = {
          clientId: oauthClientId.trim(),
          clientSecret: oauthClientSecret.trim(),
          refreshToken: oauthRefreshToken.trim(),
          tokenUrl: oauthTokenUrl.trim(),
          ...(oauthAuthUrl?.trim() ? { authUrl: oauthAuthUrl.trim() } : {}),
          ...(scopes.length > 0 ? { scopes } : {}),
        };
      } else if (oauthClientId && oauthClientSecret && !oauthRefreshToken) {
        if (!oauthOptions) {
          await interaction.reply({
            content:
              "Interactive OAuth requires `oauth-auth-url`, `oauth-token-url`, and `oauth-scopes` from the MCP plugin/provider.",
            ephemeral: true,
          });
          return;
        }

        // Start interactive OAuth flow
        const consentUrl = buildOAuthConsentUrl(
          oauthClientId.trim(),
          oauthOptions,
        );
        await interaction.reply({
          content:
            `Authorize Missy to access this service:\n${consentUrl}\n\nWaiting for you to complete consent (2 min timeout)...`,
          ephemeral: true,
        });

        try {
          await completeOAuthFlow(
            normalizedName,
            normalizedCommand,
            oauthClientId.trim(),
            oauthClientSecret.trim(),
            oauthOptions,
          );
          await interaction.followUp({
            content:
              `MCP server \`${normalizedName}\` authorized and saved. Its tools will be available on the next Missy request.`,
            ephemeral: true,
          });
        } catch (error) {
          await interaction.followUp({
            content: error instanceof Error
              ? `OAuth flow failed: ${error.message}`
              : "OAuth flow failed.",
            ephemeral: true,
          });
        }
        return;
      } else if (oauthClientId || oauthClientSecret || oauthRefreshToken) {
        await interaction.reply({
          content:
            "Provide `oauth-client-id` + `oauth-client-secret` to start an interactive OAuth flow, or all three fields including `oauth-refresh-token` to skip the flow.",
          ephemeral: true,
        });
        return;
      }

      const serverConfig: McpServerConfig = {
        command: normalizedCommand,
        args: parseOptionalStringArray(argsJson),
        env: parseOptionalStringRecord(envJson),
        ...(oauth ? { oauth } : {}),
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
    description: "Check Mistral model availability for the saved API key",
    name: "status",
  })
  async modelStatus(interaction: CommandInteraction): Promise<void> {
    const resolvedApiKey = await getInteractionApiKey(interaction);

    if (!resolvedApiKey) {
      await interaction.reply({
        content: NO_API_KEY_MESSAGE,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const [models, currentModel] = await Promise.all([
        listMistralModels(resolvedApiKey.apiKey),
        getEffectiveModel(interaction.user.id),
      ]);

      await editReplyWithDiscordMessages(
        interaction,
        formatMistralModelStatus(models, currentModel),
      );
    } catch (error) {
      if (error instanceof MistralApiError && error.status === 401) {
        await removeResolvedApiKey(resolvedApiKey);
        await interaction.editReply(rejectedApiKeyMessage(resolvedApiKey));
        return;
      }

      console.error(error);
      await interaction.editReply(
        "Missy couldn't reach Mistral's model status endpoint right now.",
      );
    }
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description:
      "Check whether this context has a saved model provider API key",
    name: "api-key-status",
  })
  async status(interaction: CommandInteraction): Promise<void> {
    const saved = interaction.guildId
      ? await hasGuildApiKey(interaction.guildId)
      : Boolean(await getApiKey(interaction.user.id));
    await interaction.reply({
      content: interaction.guildId
        ? saved
          ? "This server has a saved model provider API key."
          : "This server doesn't have a saved model provider API key."
        : saved
        ? "You have a saved model provider API key."
        : "You don't have a saved model provider API key.",
      ephemeral: true,
    });
  }

  @Slash({
    contexts: COMMAND_CONTEXTS,
    description: "Remove the saved model provider API key for this context",
    name: "remove-api-key",
  })
  async remove(interaction: CommandInteraction): Promise<void> {
    const removed = interaction.guildId
      ? await removeGuildApiKey(interaction.guildId)
      : await removeApiKey(interaction.user.id);
    await interaction.reply({
      content: interaction.guildId
        ? removed
          ? "This server's model provider API key was removed."
          : "This server didn't have a saved model provider API key."
        : removed
        ? "Your model provider API key was removed."
        : "You didn't have a saved model provider API key.",
      ephemeral: true,
    });
  }
}
