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
  `Local Desktop and filesystem tools are disabled for this Discord user. Add their user ID to ${LOCAL_ACCESS_ENV} or one of their role IDs to ${LOCAL_ACCESS_ROLES_ENV} in .env to allow access.`;
