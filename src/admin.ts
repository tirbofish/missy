import { hasConfiguredPermission, PermissionActor } from "./permissions.ts";

const MCP_ADMIN_USER_IDS_ENV = "MCP_ADMIN_USER_IDS";
const MCP_ADMIN_ROLE_IDS_ENV = "MCP_ADMIN_ROLE_IDS";

export function canManageMcp(actor: PermissionActor): boolean {
  return hasConfiguredPermission(
    actor,
    MCP_ADMIN_USER_IDS_ENV,
    MCP_ADMIN_ROLE_IDS_ENV,
  );
}

export const MCP_ADMIN_REQUIRED_MESSAGE =
  `Only configured MCP admins can do that. Set ${MCP_ADMIN_USER_IDS_ENV} or ${MCP_ADMIN_ROLE_IDS_ENV} in .env.`;
