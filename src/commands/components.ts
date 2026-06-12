/** Discord UI component builders for Missy commands. */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Automation } from "../automations.ts";
import {
  AUTOMATION_ADD_MODAL_ID,
  AUTOMATION_PROMPT_INPUT_ID,
  AUTOMATION_TRIGGER_INPUT_ID,
  automationComponentId,
  automationEditModalId,
  buildAutomationListMessage,
} from "../automations.ts";
import type { MemoryEntry, MemoryScope } from "../memories.ts";
import {
  MEMORY_CONTENT_INPUT_ID,
  memoryAddModalId,
  memoryComponentId,
  buildScopedMemoryListMessage,
} from "../memories.ts";
import { SKILLS_SELECT_ID, skillSelectOptions } from "../skills.ts";
import { truncateComponentText, MAX_AUTOMATION_COMPONENT_ITEMS, MAX_MEMORY_SELECT_ITEMS } from "./helpers.ts";

// ─── Skill selector ─────────────────────────────────────────────────────

export function skillComponents(
  hasLocalAccess: boolean,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(SKILLS_SELECT_ID)
        .setPlaceholder("Choose a skill")
        .addOptions(skillSelectOptions(hasLocalAccess)),
    ),
  ];
}

// ─── Automation components ──────────────────────────────────────────────

export function buildAutomationComponents(
  automations: readonly Automation[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(automationComponentId("add")).setLabel("Add").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(automationComponentId("refresh")).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    ),
  ];
  for (const automation of automations.slice(0, MAX_AUTOMATION_COMPONENT_ITEMS)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(automationComponentId("toggle", automation.id))
          .setLabel(automation.enabled ? "Disable" : "Enable")
          .setStyle(automation.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(automationComponentId("edit", automation.id))
          .setLabel(`Edit ${automation.id}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(automationComponentId("delete", automation.id))
          .setLabel(`Delete ${automation.id}`).setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return rows;
}

export function automationPanelContent(automations: readonly Automation[]): string {
  const extraCount = Math.max(0, automations.length - MAX_AUTOMATION_COMPONENT_ITEMS);
  const note = extraCount
    ? `\n\nButtons are shown for the first ${MAX_AUTOMATION_COMPONENT_ITEMS}; use \`/automation action:remove id:<id>\` for ${extraCount} more.`
    : "";
  return `${buildAutomationListMessage(automations)}${note}`;
}

export function buildAutomationAddModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(AUTOMATION_ADD_MODAL_ID)
    .setTitle("Add Missy automation")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(AUTOMATION_TRIGGER_INPUT_ID).setLabel("Trigger text")
          .setMaxLength(120).setRequired(true).setStyle(TextInputStyle.Short)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(AUTOMATION_PROMPT_INPUT_ID).setLabel("Missy's instruction")
          .setMaxLength(1_000).setRequired(true).setStyle(TextInputStyle.Paragraph)),
    );
}

export function buildAutomationEditModal(automation: Automation): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(automationEditModalId(automation.id))
    .setTitle(`Edit automation ${automation.id}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(AUTOMATION_TRIGGER_INPUT_ID).setLabel("Trigger text")
          .setMaxLength(120).setRequired(true).setStyle(TextInputStyle.Short).setValue(automation.trigger)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(AUTOMATION_PROMPT_INPUT_ID).setLabel("Missy's instruction")
          .setMaxLength(1_000).setRequired(true).setStyle(TextInputStyle.Paragraph).setValue(automation.prompt)),
    );
}

// ─── Memory components ──────────────────────────────────────────────────

export function buildMemoryComponents(
  scope: MemoryScope,
  entries: readonly MemoryEntry[],
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(memoryComponentId("add", scope)).setLabel("Add").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(memoryComponentId("refresh", scope)).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(memoryComponentId("clear", scope)).setDisabled(entries.length === 0)
        .setLabel("Clear").setStyle(ButtonStyle.Danger),
    ),
  ];
  if (entries.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(memoryComponentId("delete", scope))
          .setPlaceholder("Delete a memory")
          .addOptions(entries.slice(0, MAX_MEMORY_SELECT_ITEMS).map((entry) => ({
            description: truncateComponentText(entry.content, 100),
            label: `Delete ${entry.id}`,
            value: entry.id,
          }))),
      ),
    );
  }
  return rows;
}

export function memoryPanelContent(scope: MemoryScope, entries: readonly MemoryEntry[]): string {
  const extraCount = Math.max(0, entries.length - MAX_MEMORY_SELECT_ITEMS);
  const serverNote = scope === "server" ? "\n\nServer memory edits require Manage Server permission." : "";
  const extraNote = extraCount
    ? `\n\nThe delete menu shows the first ${MAX_MEMORY_SELECT_ITEMS}; use \`/memory action:remove scope:${scope} id:<id>\` for ${extraCount} more.`
    : "";
  return `${buildScopedMemoryListMessage(scope, entries)}${serverNote}${extraNote}`;
}

export function buildMemoryAddModal(scope: MemoryScope): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(memoryAddModalId(scope))
    .setTitle(`Add ${scope} memory`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(MEMORY_CONTENT_INPUT_ID).setLabel("Memory")
          .setMaxLength(1_000).setRequired(true).setStyle(TextInputStyle.Paragraph),
      ),
    );
}
