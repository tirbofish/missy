export type Automation = {
  channelId?: string;
  id: string;
  trigger: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type AutocompleteChoice = {
  name: string;
  value: string;
};

type AutomationStore = {
  servers: Record<string, Automation[]>;
};

const dataDir = new URL("../data/", import.meta.url);
const storeFile = new URL("automations.json", dataDir);
const MAX_AUTOMATIONS_PER_SERVER = 50;
const MAX_TRIGGER_LENGTH = 120;
const MAX_PROMPT_LENGTH = 1_000;
const AUTOMATION_COMPONENT_PREFIX = "missy-automation";

let cachedStore: AutomationStore | undefined;

async function loadStore(): Promise<AutomationStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await Deno.readTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<AutomationStore>;
    cachedStore = { servers: parsed.servers ?? {} };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { servers: {} };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: AutomationStore): Promise<void> {
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

function normalizeTrigger(trigger: string): string {
  return trigger.trim().replace(/\s+/g, " ").slice(0, MAX_TRIGGER_LENGTH);
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").slice(0, MAX_PROMPT_LENGTH);
}

export async function addAutomation(
  guildId: string,
  trigger: string,
  prompt: string,
  createdBy: string,
  channelId?: string,
): Promise<Automation> {
  const normalizedTrigger = normalizeTrigger(trigger);
  const normalizedPrompt = normalizePrompt(prompt);

  if (!normalizedTrigger) {
    throw new Error("Automation trigger cannot be empty.");
  }

  if (!normalizedPrompt) {
    throw new Error("Automation prompt cannot be empty.");
  }

  const store = await loadStore();
  const now = new Date().toISOString();
  const automation: Automation = {
    channelId,
    id: crypto.randomUUID().slice(0, 8),
    trigger: normalizedTrigger,
    prompt: normalizedPrompt,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  store.servers[guildId] = [
    ...(store.servers[guildId] ?? []),
    automation,
  ].slice(-MAX_AUTOMATIONS_PER_SERVER);
  await saveStore(store);
  return automation;
}

export async function listAutomations(guildId: string): Promise<Automation[]> {
  const store = await loadStore();
  return store.servers[guildId] ?? [];
}

export async function removeAutomation(
  guildId: string,
  id: string,
): Promise<boolean> {
  const store = await loadStore();
  const automations = store.servers[guildId] ?? [];
  const remaining = automations.filter((automation) =>
    automation.id !== id.trim()
  );

  if (remaining.length === automations.length) {
    return false;
  }

  store.servers[guildId] = remaining;
  await saveStore(store);
  return true;
}

export async function setAutomationEnabled(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<Automation | undefined> {
  const store = await loadStore();
  const automations = store.servers[guildId] ?? [];
  const index = automations.findIndex((automation) =>
    automation.id === id.trim()
  );

  if (index < 0) {
    return undefined;
  }

  const updated = {
    ...automations[index],
    enabled,
    updatedAt: new Date().toISOString(),
  };
  automations[index] = updated;
  store.servers[guildId] = automations;
  await saveStore(store);
  return updated;
}

export async function updateAutomation(
  guildId: string,
  id: string,
  updates: {
    channelId?: string | null;
    prompt?: string;
    trigger?: string;
  },
): Promise<Automation | undefined> {
  const store = await loadStore();
  const automations = store.servers[guildId] ?? [];
  const index = automations.findIndex((automation) =>
    automation.id === id.trim()
  );

  if (index < 0) {
    return undefined;
  }

  const normalizedTrigger = updates.trigger === undefined
    ? undefined
    : normalizeTrigger(updates.trigger);
  const normalizedPrompt = updates.prompt === undefined
    ? undefined
    : normalizePrompt(updates.prompt);

  if (updates.trigger !== undefined && !normalizedTrigger) {
    throw new Error("Automation trigger cannot be empty.");
  }

  if (updates.prompt !== undefined && !normalizedPrompt) {
    throw new Error("Automation prompt cannot be empty.");
  }

  const updated: Automation = {
    ...automations[index],
    ...(normalizedTrigger === undefined ? {} : { trigger: normalizedTrigger }),
    ...(normalizedPrompt === undefined ? {} : { prompt: normalizedPrompt }),
    ...(updates.channelId === undefined
      ? {}
      : { channelId: updates.channelId ?? undefined }),
    updatedAt: new Date().toISOString(),
  };
  automations[index] = updated;
  store.servers[guildId] = automations;
  await saveStore(store);
  return updated;
}

export async function clearAutomations(guildId: string): Promise<number> {
  const store = await loadStore();
  const count = store.servers[guildId]?.length ?? 0;
  store.servers[guildId] = [];
  await saveStore(store);
  return count;
}

export function findMatchingAutomation(
  automations: readonly Automation[],
  content: string,
  channelId?: string,
): Automation | undefined {
  const normalizedContent = content.toLowerCase();

  return automations.find((automation) =>
    automation.enabled &&
    (!automation.channelId || automation.channelId === channelId) &&
    normalizedContent.includes(automation.trigger.toLowerCase())
  );
}

export async function getMatchingAutomation(
  guildId: string,
  content: string,
  channelId?: string,
): Promise<Automation | undefined> {
  return findMatchingAutomation(
    await listAutomations(guildId),
    content,
    channelId,
  );
}

export type AutomationComponentAction =
  | "add"
  | "delete"
  | "edit"
  | "refresh"
  | "toggle";

export type AutomationComponentId = {
  action: AutomationComponentAction;
  automationId?: string;
};

export function automationComponentId(
  action: AutomationComponentAction,
  automationId?: string,
): string {
  return [AUTOMATION_COMPONENT_PREFIX, action, automationId]
    .filter((part): part is string => Boolean(part))
    .join(":");
}

export function parseAutomationComponentId(
  customId: string,
): AutomationComponentId | undefined {
  const [prefix, action, automationId] = customId.split(":");

  if (prefix !== AUTOMATION_COMPONENT_PREFIX) {
    return undefined;
  }

  if (
    action !== "add" && action !== "delete" && action !== "refresh" &&
    action !== "toggle" && action !== "edit"
  ) {
    return undefined;
  }

  if (
    (action === "delete" || action === "edit" || action === "toggle") &&
    !automationId
  ) {
    return undefined;
  }

  return {
    action,
    automationId,
  };
}

export const AUTOMATION_ADD_MODAL_ID = "missy-automation-add-modal";
export const AUTOMATION_EDIT_MODAL_PREFIX = "missy-automation-edit-modal";
export const AUTOMATION_TRIGGER_INPUT_ID = "trigger";
export const AUTOMATION_PROMPT_INPUT_ID = "prompt";

export function automationEditModalId(automationId: string): string {
  return `${AUTOMATION_EDIT_MODAL_PREFIX}:${automationId}`;
}

export function parseAutomationEditModalId(
  customId: string,
): string | undefined {
  const [prefix, automationId] = customId.split(":");

  if (prefix !== AUTOMATION_EDIT_MODAL_PREFIX || !automationId) {
    return undefined;
  }

  return automationId;
}

function compactChoiceName(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

export function automationIdAutocompleteChoices(
  automations: readonly Automation[],
  focused: string,
): AutocompleteChoice[] {
  const normalizedFocused = focused.trim().toLowerCase();

  return automations
    .filter((automation) => {
      if (!normalizedFocused) {
        return true;
      }

      return automation.id.toLowerCase().includes(normalizedFocused) ||
        (automation.channelId?.toLowerCase().includes(normalizedFocused) ??
          false) ||
        automation.trigger.toLowerCase().includes(normalizedFocused) ||
        automation.prompt.toLowerCase().includes(normalizedFocused);
    })
    .slice(0, 25)
    .map((automation) => ({
      name: compactChoiceName(
        `${automation.id} - ${automation.enabled ? "on" : "off"} - ${
          automation.channelId ? `<#${automation.channelId}> - ` : ""
        }${automation.trigger}`,
      ),
      value: automation.id,
    }));
}

export function buildAutomationPrompt(
  automation: Automation,
  messageContent: string,
): string {
  return [
    `A Discord server automation matched trigger "${automation.trigger}".`,
    automation.channelId
      ? `Automation channel scope: <#${automation.channelId}>.`
      : "Automation channel scope: entire server.",
    `Automation instruction: ${automation.prompt}`,
    "",
    `Original user message: ${messageContent}`,
  ].join("\n");
}

export function buildAutomationListMessage(
  automations: readonly Automation[],
): string {
  if (automations.length === 0) {
    return "No automations are configured for this server.";
  }

  return [
    "Server automations:",
    "",
    ...automations.map((automation) =>
      `- \`${automation.id}\` ${automation.enabled ? "on" : "off"} ` +
      `${automation.channelId ? `in <#${automation.channelId}> ` : ""}` +
      `when message contains \`${automation.trigger}\`: ${automation.prompt}`
    ),
  ].join("\n");
}
