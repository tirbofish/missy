export type PermissionActor = {
  roleIds?: readonly string[];
  userId: string;
};

export function configuredIds(envName: string): string[] {
  return (Deno.env.get(envName) ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function hasConfiguredPermission(
  actor: PermissionActor,
  userIdsEnv: string,
  roleIdsEnv: string,
): boolean {
  const userIds = configuredIds(userIdsEnv);

  if (userIds.includes(actor.userId)) {
    return true;
  }

  const roleIds = configuredIds(roleIdsEnv);
  return Boolean(actor.roleIds?.some((roleId) => roleIds.includes(roleId)));
}
