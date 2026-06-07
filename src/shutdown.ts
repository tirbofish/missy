import {
  configuredIds,
  hasConfiguredPermission,
  PermissionActor,
} from "./permissions.ts";

const SHUTDOWN_ENV = "MISSY_SHUTDOWN_USER_IDS";
const SHUTDOWN_ROLES_ENV = "MISSY_SHUTDOWN_ROLE_IDS";

export function configuredShutdownUserIds(): string[] {
  return configuredIds(SHUTDOWN_ENV);
}

export function configuredShutdownRoleIds(): string[] {
  return configuredIds(SHUTDOWN_ROLES_ENV);
}

export function canShutdownBot(actor: PermissionActor): boolean {
  return hasConfiguredPermission(actor, SHUTDOWN_ENV, SHUTDOWN_ROLES_ENV);
}

export const SHUTDOWN_REQUIRED_MESSAGE =
  `Only configured shutdown users can stop Missy. Set ${SHUTDOWN_ENV} or ${SHUTDOWN_ROLES_ENV} in .env.`;

export function shutdownBot(reason: string): void {
  console.warn(JSON.stringify({
    at: new Date().toISOString(),
    event: "shutdown_requested",
    reason,
  }));

  setTimeout(() => Deno.exit(0), 250);
}
