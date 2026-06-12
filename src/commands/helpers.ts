/** Constants and utility helpers for Missy Discord commands. */

import type { AutocompleteInteraction, CommandInteraction } from "discord.js";
import { InteractionContextType, PermissionFlagsBits } from "discord.js";
import type { Automation } from "../automations.ts";
import { automationIdAutocompleteChoices, listAutomations } from "../automations.ts";
import type { ResolvedApiKey } from "../apiKeys.ts";
import { getEffectiveApiKey } from "../apiKeys.ts";
import type { MemoryEntry, MemoryScope } from "../memories.ts";
import { listMemories, memoryIdAutocompleteChoices, parseMemoryScope } from "../memories.ts";

// ─── Constants ──────────────────────────────────────────────────────────

export const NO_API_KEY_MESSAGE =
  "Set an API key for the configured model provider first with `/set-api-key`.";
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
export const COMMAND_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
];
export const GUILD_COMMAND_CONTEXTS = [InteractionContextType.Guild];
export const MEMORY_ACTIONS = ["list", "add", "remove", "clear"] as const;
export const MEMORY_SCOPES = ["user", "server", "user-server"] as const;
export const AUTOMATION_ACTIONS = ["list", "add", "edit", "remove", "clear"] as const;
export const MEMORY_BUTTON_ID_PATTERN =
  /^missy-memory:(?:add|refresh|clear):(?:user|server|user-server)$/;
export const MEMORY_DELETE_SELECT_ID_PATTERN =
  /^missy-memory:delete:(?:user|server|user-server)$/;
export const MEMORY_ADD_MODAL_ID_PATTERN =
  /^missy-memory-add-modal:(?:user|server|user-server)$/;
export const MAX_MEMORY_SELECT_ITEMS = 25;
export const AUTOMATION_COMPONENT_ID_PATTERN =
  /^missy-automation:(?:add|refresh|toggle:[A-Za-z0-9_-]+|edit:[A-Za-z0-9_-]+|delete:[A-Za-z0-9_-]+)$/;
export const AUTOMATION_EDIT_MODAL_ID_PATTERN =
  /^missy-automation-edit-modal:[A-Za-z0-9_-]+$/;
export const MAX_AUTOMATION_COMPONENT_ITEMS = 4;

// ─── Permission checks ──────────────────────────────────────────────────

import type { ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction } from "discord.js";

export function canEditAutomations(
  interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
  );
}

export function canEditMemoryScope(
  interaction:
    | ButtonInteraction
    | CommandInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction,
  scope: MemoryScope,
): boolean {
  return scope !== "server" ||
    Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

// ─── Parsing helpers ────────────────────────────────────────────────────

export function parseOptionalStringArray(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Expected a JSON array of strings.");
  }
  return parsed;
}

export function parseOptionalStringRecord(value?: string): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
      !Object.values(parsed).every((item) => typeof item === "string")) {
    throw new Error("Expected a JSON object with string values.");
  }
  return parsed as Record<string, string>;
}

// ─── API key helpers ────────────────────────────────────────────────────

export async function getInteractionApiKey(
  interaction: CommandInteraction,
): Promise<ResolvedApiKey | undefined> {
  return await getEffectiveApiKey(interaction.user.id, interaction.guildId);
}

export function rejectedApiKeyMessage(resolvedApiKey: ResolvedApiKey): string {
  return resolvedApiKey.scope === "guild"
    ? "The model provider rejected this server's API key, so I removed it. Run `/set-api-key` with a new key."
    : "The model provider rejected your API key, so I removed it. Run `/set-api-key` with a new key.";
}

// ─── Autocomplete helpers ───────────────────────────────────────────────

export async function autocompleteMemoryIds(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const scope =
    parseMemoryScope(interaction.options.getString("scope") ?? "") ??
      (interaction.guildId ? "user-server" : "user");

  if (!interaction.guildId && (scope === "server" || scope === "user-server")) {
    await interaction.respond([]);
    return;
  }

  const focused = String(interaction.options.getFocused() ?? "");
  const entries = await listMemories(scope, {
    guildId: interaction.guildId ?? undefined,
    userId: interaction.user.id,
  });
  await interaction.respond(memoryIdAutocompleteChoices(entries, focused));
}

export async function autocompleteAutomationIds(
  interaction: AutocompleteInteraction,
): Promise<void> {
  if (!interaction.guildId) { await interaction.respond([]); return; }
  const focused = String(interaction.options.getFocused() ?? "");
  await interaction.respond(
    automationIdAutocompleteChoices(await listAutomations(interaction.guildId), focused),
  );
}

export function truncateComponentText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
