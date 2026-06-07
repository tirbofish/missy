export function isHelpCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "help" ||
    command === "/help" ||
    /^(what|which)\s+(commands?|tools?)\s+(are\s+)?(available|supported|there)\??$/
      .test(command) ||
    /^what\s+can\s+(you|missy)\s+do\??$/.test(command) ||
    /^how\s+do\s+i\s+use\s+(you|missy)\??$/.test(command) ||
    /^show\s+(me\s+)?(the\s+)?(commands?|tools?)\.?$/.test(command) ||
    /^(list|show)\s+(all\s+)?(commands?|tools?)\.?$/.test(command);
}

export function isSystemPromptRequest(content: string): boolean {
  const command = content.trim().toLowerCase();
  return /\b(system|developer|hidden|internal)\s+prompts?\b/.test(command) ||
    /\b(instructions?|prompt)\s+(were\s+)?(you\s+)?given\b/.test(command) ||
    /\b(show|tell|print|reveal|repeat|dump)\b.*\b(prompts?|instructions?)\b/
      .test(command);
}

export const SYSTEM_PROMPT_DENIAL_MESSAGE =
  "I can't share system, developer, hidden, or internal prompts. Use `/help` or `!M! help` to see what commands and tools are available.";

export function buildHelpMessage(hasLocalAccess: boolean): string {
  const desktopHelp = hasLocalAccess
    ? "\n- You can ask about any local path, including `D:\\`, in DMs or servers. Missy can stat, list, recursively find, read, copy, create folders, write text files, move/rename, delete, and use a Deno REPL for compound file tasks.\n- The Deno REPL starts without local permissions and sends each requested read/write/run/net/env permission to chat for approval before rerunning with that scoped permission."
    : "\n- Desktop, local computer, and filesystem tools are disabled for your Discord user or roles.";

  return [
    "Missy commands:",
    "",
    "- `/missy message:<text>`: chat with Missy.",
    "- `/clear`: clear this conversation context and set a channel-history clear point.",
    "- `/set-api-key api-key:<key>`: save a server key in servers, or your personal key in DMs.",
    "- `/model`: view or change your Mistral model.",
    "- `/api-key-status`: check whether this server or DM has a saved key.",
    "- `/remove-api-key`: remove this server's key in servers, or your personal key in DMs.",
    "- `/analyze-history`: summarize recent channel messages.",
    "- `/mcp-add`: admin-only MCP server configuration.",
    "- `/shutdown`: stop Missy, restricted to configured shutdown users.",
    "- In servers, mention Missy, reply to Missy, or use `!M!<message>`.",
    "- Missy can use Mistral web search for current information.",
    "- Missy may react to a message or intentionally send no text reply when that is the better response.",
    desktopHelp,
  ].join("\n");
}
