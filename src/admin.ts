export function canManageMcp(userId: string): boolean {
  const configuredIds = (Deno.env.get("MCP_ADMIN_USER_IDS") ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);

  return configuredIds.includes(userId);
}

export const MCP_ADMIN_REQUIRED_MESSAGE =
  "Only configured MCP admins can do that. Set MCP_ADMIN_USER_IDS in .env to a comma-separated list of Discord user IDs.";
