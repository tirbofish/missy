export type MissySkillId =
  | "automations"
  | "chat"
  | "history"
  | "local-computer"
  | "mcp"
  | "media"
  | "memories"
  | "models"
  | "search";

export type MissySkill = {
  commands: string[];
  name: string;
  id: MissySkillId;
  description: string;
  details: string;
  requiresLocalAccess?: boolean;
};

const BASE_SKILLS: readonly MissySkill[] = [
  {
    commands: ["/missy", "mentions", "replies", "!M!"],
    details:
      "Missy can answer in DMs, server mentions, replies to her messages, prefixed server messages, and ephemeral slash replies.",
    id: "chat",
    name: "chat",
    description:
      "Conversational replies in DMs, mentions, replies, prefixed messages, and `/missy`.",
  },
  {
    commands: [
      "/memory",
      "/clear",
      "Missy: remember message",
      "Missy: remember user",
    ],
    details:
      "Memories are scoped as user, server, or user+server. User+server memories are cleared by `/clear` in servers. Memory panels support buttons, modals, delete menus, and id autocomplete.",
    id: "memories",
    name: "memories",
    description:
      "Persistent user, server, and user+server memories for more personal context.",
  },
  {
    commands: ["/automation"],
    details:
      "Server automations match trigger text in non-command messages and send Missy a configured instruction. Rules can be server-wide or limited to a channel. The automation panel supports add/edit modals, refresh, enable/disable, delete, and id autocomplete.",
    id: "automations",
    name: "automations",
    description:
      "Server triggers that can make Missy respond when matching messages appear.",
  },
  {
    commands: ["/analyze-history"],
    details:
      "Missy can inspect recent channel messages, respecting clear points unless the request asks to look past them.",
    id: "history",
    name: "history",
    description: "Recent Discord channel analysis with `/analyze-history`.",
  },
  {
    commands: ["Brave Search tools"],
    details:
      "When Brave Search is configured, current web, image, video, and news searches are exposed only for requests that need live or recent information.",
    id: "search",
    name: "search",
    description:
      "Current web, image, video, and news lookup when Brave Search is configured.",
  },
  {
    commands: ["attachments", "MISSY_GIF_SEARCH", "MISSY_REACT"],
    details:
      "Missy can understand image attachments, resolve fresh GIF searches through GIPHY, react to messages, split long replies, and upload approved local files.",
    id: "media",
    name: "media",
    description:
      "Image-aware Mistral requests, GIF search responses, reactions, and local file uploads.",
  },
  {
    commands: ["/model", "/status"],
    details:
      "Users can pick a personal Mistral model or router mode. `/status` checks model availability for the saved API key.",
    id: "models",
    name: "models",
    description:
      "Per-user model selection with `/model`, including router mode.",
  },
  {
    commands: ["/mcp-add"],
    details:
      "Configured admins can add local stdio MCP servers. Their tools become available to Missy on later requests.",
    id: "mcp",
    name: "mcp",
    description: "Admin-configured MCP tools through `/mcp-add`.",
  },
];

const LOCAL_SKILL: MissySkill = {
  commands: ["local filesystem tools", "Deno REPL", "MISSY_ATTACH_LOCAL"],
  details:
    "Configured users or roles can approve local file inspection, file edits, Deno REPL tasks, and Discord uploads of selected local files.",
  id: "local-computer",
  name: "local-computer",
  description:
    "Approved local filesystem and Deno REPL tasks for configured users or roles.",
  requiresLocalAccess: true,
};

export const SKILLS_SELECT_ID = "missy-skills-select";

export function listSkills(hasLocalAccess: boolean): MissySkill[] {
  return hasLocalAccess ? [...BASE_SKILLS, LOCAL_SKILL] : [...BASE_SKILLS];
}

export function findSkill(
  skillId: string,
  hasLocalAccess: boolean,
): MissySkill | undefined {
  return listSkills(hasLocalAccess).find((skill) => skill.id === skillId);
}

export function buildSkillsMessage(hasLocalAccess: boolean): string {
  return [
    "Missy skills:",
    "",
    ...listSkills(hasLocalAccess).map((skill) =>
      `- \`${skill.name}\`: ${skill.description}`
    ),
  ].join("\n");
}

export function buildSkillsOverviewMessage(hasLocalAccess: boolean): string {
  const skills = listSkills(hasLocalAccess);
  const localNote = hasLocalAccess
    ? "Local computer tools are enabled for you."
    : "Local computer tools are disabled for your Discord user or roles.";

  return [
    "Missy skills",
    "",
    ...skills.map((skill) => `- \`${skill.name}\`: ${skill.description}`),
    "",
    localNote,
  ].join("\n");
}

export function buildSkillDetailMessage(
  skillId: string,
  hasLocalAccess: boolean,
): string {
  const skill = findSkill(skillId, hasLocalAccess);

  if (!skill) {
    return buildSkillsOverviewMessage(hasLocalAccess);
  }

  return [
    `Skill: \`${skill.name}\``,
    "",
    skill.description,
    "",
    skill.details,
    "",
    `Commands: ${skill.commands.map((command) => `\`${command}\``).join(", ")}`,
  ].join("\n");
}

export function skillSelectOptions(hasLocalAccess: boolean): Array<{
  description: string;
  label: string;
  value: string;
}> {
  return listSkills(hasLocalAccess).map((skill) => ({
    description: skill.description.length > 100
      ? `${skill.description.slice(0, 97)}...`
      : skill.description,
    label: skill.name,
    value: skill.id,
  }));
}
