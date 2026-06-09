import { readDataTextFile, writeDataTextFile } from "./dataDir.ts";
import { MistralToolDefinition } from "./mcp.ts";

export type SelfSkillScope = "server" | "user";

export type SelfSkill = {
  id: string;
  scope: SelfSkillScope;
  guildId?: string;
  userId: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type SelfSkillStore = {
  skills: SelfSkill[];
};

export type SelfSkillContext = {
  guildId?: string;
  userId: string;
};

const storeFile = "self-skills.json";
const MAX_SKILLS_PER_CONTEXT = 50;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_CONTENT_LENGTH = 4_000;

export const SELF_SKILL_TOOL_NAMES = {
  delete: "missy_delete_skill",
  list: "missy_list_skills",
  read: "missy_read_skill",
  save: "missy_save_skill",
} as const;

let cachedStore: SelfSkillStore | undefined;

async function loadStore(): Promise<SelfSkillStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await readDataTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<SelfSkillStore>;
    cachedStore = { skills: parsed.skills ?? [] };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { skills: [] };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: SelfSkillStore): Promise<void> {
  await writeDataTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

function compact(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeSkillName(value: string): string {
  return compact(value, MAX_NAME_LENGTH);
}

function normalizeDescription(value: string): string {
  return compact(value, MAX_DESCRIPTION_LENGTH);
}

function normalizeContent(value: string): string {
  return value.trim().slice(0, MAX_CONTENT_LENGTH);
}

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function requestedScope(
  value: unknown,
  context: SelfSkillContext,
): SelfSkillScope {
  const scope = String(value ?? "").trim().toLowerCase();

  if (scope === "server") {
    if (!context.guildId) {
      throw new Error("Server-scoped skills can only be saved in a server.");
    }

    return "server";
  }

  return "user";
}

function skillBelongsToContext(
  skill: SelfSkill,
  context: SelfSkillContext,
): boolean {
  if (skill.scope === "user") {
    return skill.userId === context.userId;
  }

  return Boolean(context.guildId) && skill.guildId === context.guildId;
}

function sameSkillSlot(
  skill: SelfSkill,
  scope: SelfSkillScope,
  context: SelfSkillContext,
  name: string,
): boolean {
  if (skill.scope !== scope) {
    return false;
  }

  if (scope === "user" && skill.userId !== context.userId) {
    return false;
  }

  if (scope === "server" && skill.guildId !== context.guildId) {
    return false;
  }

  return skill.name.toLowerCase() === name.toLowerCase();
}

function visibleSkills(
  store: SelfSkillStore,
  context: SelfSkillContext,
): SelfSkill[] {
  return store.skills.filter((skill) => skillBelongsToContext(skill, context));
}

export async function listSelfSkills(
  context: SelfSkillContext,
  query = "",
): Promise<SelfSkill[]> {
  const store = await loadStore();
  const normalizedQuery = query.trim().toLowerCase();

  return visibleSkills(store, context).filter((skill) => {
    if (!normalizedQuery) {
      return true;
    }

    return skill.id.toLowerCase().includes(normalizedQuery) ||
      skill.name.toLowerCase().includes(normalizedQuery) ||
      skill.description.toLowerCase().includes(normalizedQuery) ||
      skill.content.toLowerCase().includes(normalizedQuery);
  });
}

export async function readSelfSkill(
  context: SelfSkillContext,
  id: string,
): Promise<SelfSkill | undefined> {
  const store = await loadStore();
  return visibleSkills(store, context).find((skill) => skill.id === id.trim());
}

export async function saveSelfSkill(
  context: SelfSkillContext,
  input: {
    content: string;
    description?: string;
    name: string;
    scope?: SelfSkillScope;
  },
): Promise<SelfSkill> {
  const name = normalizeSkillName(input.name);
  const content = normalizeContent(input.content);
  const description = normalizeDescription(input.description ?? "");
  const scope = input.scope ?? "user";

  if (!name) {
    throw new Error("Skill name cannot be empty.");
  }

  if (!content) {
    throw new Error("Skill content cannot be empty.");
  }

  const store = await loadStore();
  const now = new Date().toISOString();
  const existingIndex = store.skills.findIndex((skill) =>
    sameSkillSlot(skill, scope, context, name)
  );

  if (existingIndex >= 0) {
    const existing = store.skills[existingIndex];
    const updated: SelfSkill = {
      ...existing,
      content,
      description,
      updatedAt: now,
    };
    store.skills[existingIndex] = updated;
    await saveStore(store);
    return updated;
  }

  const scopedSkills = store.skills.filter((skill) =>
    sameScopeContext(skill, scope, context)
  );
  const skill: SelfSkill = {
    content,
    createdAt: now,
    description,
    ...(scope === "server" ? { guildId: context.guildId } : {}),
    id: crypto.randomUUID().slice(0, 8),
    name,
    scope,
    updatedAt: now,
    userId: context.userId,
  };

  const remainingScopedSkills = scopedSkills.length >= MAX_SKILLS_PER_CONTEXT
    ? scopedSkills.slice(1)
    : scopedSkills;
  store.skills = [
    ...store.skills.filter((stored) =>
      !sameScopeContext(stored, scope, context)
    ),
    ...remainingScopedSkills,
    skill,
  ];
  await saveStore(store);
  return skill;
}

function sameScopeContext(
  skill: SelfSkill,
  scope: SelfSkillScope,
  context: SelfSkillContext,
): boolean {
  if (skill.scope !== scope) {
    return false;
  }

  return scope === "server"
    ? skill.guildId === context.guildId
    : skill.userId === context.userId;
}

export async function deleteSelfSkill(
  context: SelfSkillContext,
  id: string,
): Promise<boolean> {
  const store = await loadStore();
  const skill = await readSelfSkill(context, id);

  if (!skill) {
    return false;
  }

  store.skills = store.skills.filter((stored) => stored.id !== skill.id);
  await saveStore(store);
  return true;
}

export async function buildSelfSkillContext(
  context: SelfSkillContext,
): Promise<string | undefined> {
  const skills = await listSelfSkills(context);

  if (skills.length === 0) {
    return undefined;
  }

  return [
    "Known self-authored Missy skills for this context:",
    ...skills.slice(0, 20).map((skill) =>
      `- ${skill.id} (${skill.scope}) ${skill.name}: ${
        skill.description || "No description"
      }`
    ),
    "When a skill looks relevant, call missy_read_skill before following it.",
  ].join("\n");
}

export const selfSkillTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: SELF_SKILL_TOOL_NAMES.list,
      description:
        "List self-authored Missy skills saved for this user or server.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional search text for skill names or content.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: SELF_SKILL_TOOL_NAMES.read,
      description:
        "Read a self-authored Missy skill before using its procedure.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Skill id to read." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SELF_SKILL_TOOL_NAMES.save,
      description:
        "Save or update a reusable Missy skill after learning a repeatable workflow, API pattern, or automation procedure.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "Markdown procedure with concrete steps, APIs/endpoints found, assumptions, and what to verify next time.",
          },
          description: {
            type: "string",
            description: "Short summary of when to use the skill.",
          },
          name: { type: "string", description: "Skill name." },
          scope: {
            type: "string",
            enum: ["user", "server"],
            description:
              "Use user unless the skill should be shared with this Discord server.",
          },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SELF_SKILL_TOOL_NAMES.delete,
      description: "Delete a self-authored Missy skill by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Skill id to delete." },
        },
        required: ["id"],
      },
    },
  },
];

export function isSelfSkillTool(toolName: string): boolean {
  return Object.values(SELF_SKILL_TOOL_NAMES).includes(
    toolName as typeof SELF_SKILL_TOOL_NAMES[
      keyof typeof SELF_SKILL_TOOL_NAMES
    ],
  );
}

export async function callSelfSkillTool(
  toolName: string,
  rawArguments: unknown,
  context: SelfSkillContext,
): Promise<string> {
  const args = parseArgs(rawArguments);

  if (toolName === SELF_SKILL_TOOL_NAMES.list) {
    return JSON.stringify(
      await listSelfSkills(context, String(args.query ?? "")),
    );
  }

  if (toolName === SELF_SKILL_TOOL_NAMES.read) {
    const skill = await readSelfSkill(context, String(args.id ?? ""));
    return JSON.stringify(skill ?? { error: "Skill not found." });
  }

  if (toolName === SELF_SKILL_TOOL_NAMES.save) {
    const scope = requestedScope(args.scope, context);
    const skill = await saveSelfSkill(context, {
      content: String(args.content ?? ""),
      description: typeof args.description === "string"
        ? args.description
        : undefined,
      name: String(args.name ?? ""),
      scope,
    });
    return JSON.stringify(skill);
  }

  if (toolName === SELF_SKILL_TOOL_NAMES.delete) {
    return JSON.stringify({
      deleted: await deleteSelfSkill(context, String(args.id ?? "")),
    });
  }

  throw new Error(`Unknown self-skill tool: ${toolName}`);
}
