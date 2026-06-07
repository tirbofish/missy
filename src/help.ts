export function isHelpCommand(content: string): boolean {
  const command = content.trim().toLowerCase();
  return command === "help" || command === "/help";
}

export function buildHelpMessage(isPrivate: boolean): string {
  const desktopHelp = isPrivate
    ? "\n- Ask about local files in DM only. Missy can stat, list, read, copy, create folders, and write text files.\n- Ask Missy to move, overwrite, or delete a local file/folder in DM. Missy will show an Approve/Deny prompt before changing existing filesystem content."
    : "\n- Desktop, local computer, and filesystem tools are disabled in servers. DM Missy for local filesystem access.";

  return [
    "Missy commands:",
    "",
    "- `/missy message:<text>`: chat with Missy.",
    "- `/clear`: clear this conversation context.",
    "- `/set-api-key api-key:<key>`: save your Mistral API key.",
    "- `/api-key-status`: check whether your key is saved.",
    "- `/remove-api-key`: remove your saved key.",
    "- `/analyze-history`: summarize recent channel messages.",
    "- `/mcp-add`: admin-only MCP server configuration.",
    "- In servers, mention Missy, reply to Missy, or use `!M!<message>`.",
    "- Missy can use Mistral web search for current information.",
    "- Missy may react to a message or intentionally send no text reply when that is the better response.",
    desktopHelp,
  ].join("\n");
}
