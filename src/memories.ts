import { MistralToolDefinition } from "./mcp.ts";

export type MemoryScope = "user" | "server" | "user-server";

export type MemoryEntry = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type AutocompleteChoice = {
  name: string;
  value: string;
};

type MemoryStore = {
  servers: Record<string, MemoryEntry[]>;
  users: Record<string, MemoryEntry[]>;
  userServers: Record<string, MemoryEntry[]>;
};

export type MemoryContext = {
  guildId?: string;
  userId: string;
};

const dataDir = new URL("../data/", import.meta.url);
const storeFile = new URL("memories.json", dataDir);
const MAX_MEMORY_LENGTH = 1_000;
const MAX_MEMORIES_PER_SCOPE = 50;
const MAX_CONTEXT_MENU_MEMORY_LENGTH = 700;
const MEMORY_COMPONENT_PREFIX = "missy-memory";

export const MEMORY_TOOL_NAMES = {
  remember: "missy_remember",
} as const;

let cachedStore: MemoryStore | undefined;

async function loadStore(): Promise<MemoryStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await Deno.readTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<MemoryStore>;
    cachedStore = {
      servers: parsed.servers ?? {},
      users: parsed.users ?? {},
      userServers: parsed.userServers ?? {},
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { servers: {}, users: {}, userServers: {} };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: MemoryStore): Promise<void> {
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

function userServerKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function sanitizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").slice(0, MAX_MEMORY_LENGTH);
}

function entriesForScope(
  store: MemoryStore,
  scope: MemoryScope,
  context: MemoryContext,
): MemoryEntry[] {
  switch (scope) {
    case "user":
      return store.users[context.userId] ?? [];
    case "server":
      return context.guildId ? store.servers[context.guildId] ?? [] : [];
    case "user-server":
      return context.guildId
        ? store.userServers[userServerKey(context.guildId, context.userId)] ??
          []
        : [];
  }
}

function setEntriesForScope(
  store: MemoryStore,
  scope: MemoryScope,
  context: MemoryContext,
  entries: MemoryEntry[],
): void {
  switch (scope) {
    case "user":
      store.users[context.userId] = entries;
      return;
    case "server":
      if (!context.guildId) {
        throw new Error("Server memories require a Discord server.");
      }
      store.servers[context.guildId] = entries;
      return;
    case "user-server":
      if (!context.guildId) {
        throw new Error("User+server memories require a Discord server.");
      }
      store.userServers[userServerKey(context.guildId, context.userId)] =
        entries;
      return;
  }
}

export function parseMemoryScope(value: string): MemoryScope | undefined {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");

  if (normalized === "user" || normalized === "me" || normalized === "dm") {
    return "user";
  }

  if (
    normalized === "server" || normalized === "guild" ||
    normalized === "channel"
  ) {
    return "server";
  }

  if (
    normalized === "user-server" || normalized === "server-user" ||
    normalized === "combined" || normalized === "this-server"
  ) {
    return "user-server";
  }

  return undefined;
}

export async function addMemory(
  scope: MemoryScope,
  context: MemoryContext,
  content: string,
  createdBy = context.userId,
): Promise<MemoryEntry> {
  const sanitized = sanitizeMemoryContent(content);

  if (!sanitized) {
    throw new Error("Memory content cannot be empty.");
  }

  const store = await loadStore();
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: crypto.randomUUID().slice(0, 8),
    content: sanitized,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  const entries = [...entriesForScope(store, scope, context), entry]
    .slice(-MAX_MEMORIES_PER_SCOPE);

  setEntriesForScope(store, scope, context, entries);
  await saveStore(store);
  return entry;
}

export async function removeMemory(
  scope: MemoryScope,
  context: MemoryContext,
  id: string,
): Promise<boolean> {
  const store = await loadStore();
  const entries = entriesForScope(store, scope, context);
  const remaining = entries.filter((entry) => entry.id !== id.trim());

  if (remaining.length === entries.length) {
    return false;
  }

  setEntriesForScope(store, scope, context, remaining);
  await saveStore(store);
  return true;
}

export async function clearMemories(
  scope: MemoryScope,
  context: MemoryContext,
): Promise<number> {
  const store = await loadStore();
  const count = entriesForScope(store, scope, context).length;

  setEntriesForScope(store, scope, context, []);
  await saveStore(store);
  return count;
}

export async function clearUserServerMemories(
  context: MemoryContext,
): Promise<number> {
  if (!context.guildId) {
    return 0;
  }

  return await clearMemories("user-server", context);
}

export async function getScopedMemories(
  context: MemoryContext,
): Promise<Record<MemoryScope, MemoryEntry[]>> {
  const store = await loadStore();

  return {
    user: entriesForScope(store, "user", context),
    server: entriesForScope(store, "server", context),
    "user-server": entriesForScope(store, "user-server", context),
  };
}

export async function listMemories(
  scope: MemoryScope,
  context: MemoryContext,
): Promise<MemoryEntry[]> {
  const store = await loadStore();
  return entriesForScope(store, scope, context);
}

export async function buildMemoryContext(
  context: MemoryContext,
): Promise<string | undefined> {
  const memories = await getScopedMemories(context);
  const sections = [
    formatMemorySection("User memories", memories.user),
    context.guildId
      ? formatMemorySection("Server memories", memories.server)
      : undefined,
    context.guildId
      ? formatMemorySection(
        "Memories for this user in this server",
        memories["user-server"],
      )
      : undefined,
  ].filter((section): section is string => Boolean(section));

  if (sections.length === 0) {
    return undefined;
  }

  return [
    "Use these persistent Discord memories as factual context. Do not mention them unless they are relevant.",
    ...sections,
  ].join("\n\n");
}

function formatMemorySection(
  title: string,
  entries: readonly MemoryEntry[],
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return [
    `${title}:`,
    ...entries.map((entry) => `- (${entry.id}) ${entry.content}`),
  ].join("\n");
}

export function buildMemoryListMessage(
  memories: Record<MemoryScope, MemoryEntry[]>,
): string {
  const sections = [
    formatMemorySection("User memories", memories.user),
    formatMemorySection("Server memories", memories.server),
    formatMemorySection(
      "Memories for this user in this server",
      memories["user-server"],
    ),
  ].filter((section): section is string => Boolean(section));

  return sections.length
    ? sections.join("\n\n")
    : "No memories are saved for this context.";
}

export function buildScopedMemoryListMessage(
  scope: MemoryScope,
  entries: readonly MemoryEntry[],
): string {
  const titleByScope: Record<MemoryScope, string> = {
    server: "Server memories",
    user: "User memories",
    "user-server": "Memories for this user in this server",
  };

  return formatMemorySection(titleByScope[scope], entries) ??
    `No ${scope} memories are saved for this context.`;
}

export type MemoryComponentAction =
  | "add"
  | "clear"
  | "delete"
  | "refresh";

export type MemoryComponentId = {
  action: MemoryComponentAction;
  scope: MemoryScope;
};

export function memoryComponentId(
  action: MemoryComponentAction,
  scope: MemoryScope,
): string {
  return `${MEMORY_COMPONENT_PREFIX}:${action}:${scope}`;
}

export function parseMemoryComponentId(
  customId: string,
): MemoryComponentId | undefined {
  const [prefix, action, rawScope] = customId.split(":");
  const scope = rawScope ? parseMemoryScope(rawScope) : undefined;

  if (prefix !== MEMORY_COMPONENT_PREFIX || !scope) {
    return undefined;
  }

  if (
    action !== "add" && action !== "clear" && action !== "delete" &&
    action !== "refresh"
  ) {
    return undefined;
  }

  return { action, scope };
}

export const MEMORY_ADD_MODAL_PREFIX = "missy-memory-add-modal";
export const MEMORY_CONTENT_INPUT_ID = "content";

export function memoryAddModalId(scope: MemoryScope): string {
  return `${MEMORY_ADD_MODAL_PREFIX}:${scope}`;
}

export function parseMemoryAddModalId(
  customId: string,
): MemoryScope | undefined {
  const [prefix, rawScope] = customId.split(":");
  return prefix === MEMORY_ADD_MODAL_PREFIX && rawScope
    ? parseMemoryScope(rawScope)
    : undefined;
}

function compactChoiceName(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

export function memoryIdAutocompleteChoices(
  entries: readonly MemoryEntry[],
  focused: string,
): AutocompleteChoice[] {
  const normalizedFocused = focused.trim().toLowerCase();

  return entries
    .filter((entry) => {
      if (!normalizedFocused) {
        return true;
      }

      return entry.id.toLowerCase().includes(normalizedFocused) ||
        entry.content.toLowerCase().includes(normalizedFocused);
    })
    .slice(0, 25)
    .map((entry) => ({
      name: compactChoiceName(`${entry.id} - ${entry.content}`),
      value: entry.id,
    }));
}

export function buildMessageMemoryContent(input: {
  attachmentCount?: number;
  authorLabel?: string;
  content?: string | null;
}): string | undefined {
  const content = input.content?.trim().replace(/\s+/g, " ");
  const attachments = input.attachmentCount && input.attachmentCount > 0
    ? `${input.attachmentCount} attachment${
      input.attachmentCount === 1 ? "" : "s"
    }`
    : undefined;
  const pieces = [
    content,
    attachments ? `[${attachments}]` : undefined,
  ].filter((piece): piece is string => Boolean(piece));

  if (pieces.length === 0) {
    return undefined;
  }

  const authorPrefix = input.authorLabel?.trim()
    ? `Message from ${input.authorLabel.trim()}: `
    : "Message: ";
  const memory = `${authorPrefix}${pieces.join(" ")}`;

  return memory.length > MAX_CONTEXT_MENU_MEMORY_LENGTH
    ? `${memory.slice(0, MAX_CONTEXT_MENU_MEMORY_LENGTH - 3)}...`
    : memory;
}

export function buildUserMemoryContent(input: {
  displayName?: string | null;
  userId: string;
  username: string;
}): string {
  const identity = [`Discord user ID ${input.userId}`, input.username.trim()]
    .filter(Boolean)
    .join(" is ");

  if (
    !input.displayName?.trim() || input.displayName.trim() === input.username
  ) {
    return identity;
  }

  return `${identity} and is known here as ${input.displayName.trim()}`;
}

export const memoryTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: MEMORY_TOOL_NAMES.remember,
      description:
        "Save a durable memory for future Discord conversations. Use proactively when users share personal facts, preferences, interests, life details, or stable information. Also use when explicitly asked to remember something.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description:
              "Where to save the memory. user follows this Discord user everywhere; server applies to everyone in this server; user-server applies only to this user in this server and is cleared by /clear.",
            enum: ["user", "server", "user-server"],
          },
          content: {
            type: "string",
            description:
              "The concise memory to save. Store only user-provided preferences, stable facts, server conventions, or explicit instructions.",
          },
        },
        required: ["scope", "content"],
      },
    },
  },
];

function parseToolArguments(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

export function isMemoryTool(toolName: string): boolean {
  return toolName === MEMORY_TOOL_NAMES.remember;
}

export async function callMemoryTool(
  toolName: string,
  rawArguments: unknown,
  context: MemoryContext,
): Promise<string> {
  if (toolName !== MEMORY_TOOL_NAMES.remember) {
    throw new Error(`Unknown memory tool: ${toolName}`);
  }

  const args = parseToolArguments(rawArguments);
  const scope = typeof args.scope === "string"
    ? parseMemoryScope(args.scope)
    : undefined;
  const content = typeof args.content === "string" ? args.content : "";

  if (!scope) {
    throw new Error("Memory scope must be user, server, or user-server.");
  }

  const entry = await addMemory(scope, context, content);
  return `Saved ${scope} memory ${entry.id}.`;
}
