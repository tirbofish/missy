import {
  configuredIds,
  hasConfiguredPermission,
  PermissionActor,
} from "./permissions.ts";

const LOCAL_ACCESS_ENV = "MISSY_LOCAL_ACCESS_USER_IDS";
const LOCAL_ACCESS_ROLES_ENV = "MISSY_LOCAL_ACCESS_ROLE_IDS";

export function configuredLocalAccessUserIds(): string[] {
  return configuredIds(LOCAL_ACCESS_ENV);
}

export function configuredLocalAccessRoleIds(): string[] {
  return configuredIds(LOCAL_ACCESS_ROLES_ENV);
}

export function canAccessLocalComputer(actor: PermissionActor): boolean {
  return hasConfiguredPermission(
    actor,
    LOCAL_ACCESS_ENV,
    LOCAL_ACCESS_ROLES_ENV,
  );
}

export const LOCAL_ACCESS_REQUIRED_MESSAGE =
  "yeah no, you don't have permission to touch the local filesystem. someone with access to the bot's config would need to add you";
