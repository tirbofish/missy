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
    ? "\n- You can use the embedded Deno REPL for local tasks from DMs or servers. It starts without local permissions and sends each requested read/write/run/net/env permission to chat for approval before rerunning with that scoped permission. Local file uploads also ask for read approval first."
    : "\n- The embedded Deno REPL and local file uploads are disabled for your Discord user or roles.";

  return [
    "Missy commands:",
    "",
    "- `/missy message:<text>`: chat with Missy.",
    "- `/clear`: clear this conversation context, set a channel-history clear point, and clear user+server memories in servers.",
    "- `/skills`: browse Missy's available skills with a select menu.",
    "- `/memory`: list or manage persistent user, server, and user+server memories with buttons, modals, delete menus, and id autocomplete.",
    "- Context menu `Missy: remember message` or `Missy: remember user`: save memories from Discord right-click menus.",
    "- `/automation`: list or manage server-wide or channel-scoped automations with buttons, edit modals, id autocomplete, and an add modal; editing requires Manage Server permission.",
    "- In normal chat, Missy can create daily scheduled tasks when you ask her to message, DM, notify, or run a lookup at a time.",
    "- `/set-api-key api-key:<key>`: save a server key in servers, or your personal key in DMs.",
    "- `/model`: view or change your model, including `router` mode.",
    "- `/status`: check Mistral models available to the saved API key.",
    "- `/api-key-status`: check whether this server or DM has a saved key.",
    "- `/remove-api-key`: remove this server's key in servers, or your personal key in DMs.",
    "- `/analyze-history`: summarize recent channel messages.",
    "- `/mcp-add`: admin-only MCP server configuration.",
    "- `/shutdown`: stop Missy, restricted to configured shutdown users.",
    "- In servers, mention Missy, reply to Missy, or use `!M!<message>`.",
    "- In servers, Missy can inspect members, roles, channels, and server info when a request needs server context.",
    "- Missy can use the configured search provider for current web, image, video, and news lookups.",
    "- Missy can save reusable self-authored skills for repeatable workflows and public API patterns.",
    "- Missy may react to a message or intentionally send no text reply when that is the better response.",
    desktopHelp,
  ].join("\n");
}
