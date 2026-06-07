import { CommandInteraction, Message } from "discord.js";
import { PermissionActor } from "./permissions.ts";

type MemberWithRoles = {
  roles?: unknown;
};

type RoleCache = {
  keys?: () => Iterable<string>;
};

function roleIdsFromMember(member: unknown): string[] {
  const roles = (member as MemberWithRoles | undefined)?.roles;

  if (Array.isArray(roles)) {
    return roles.map(String);
  }

  const cache = (roles as { cache?: RoleCache } | undefined)?.cache;

  if (cache?.keys) {
    return [...cache.keys()].map(String);
  }

  return [];
}

export function actorFromMessage(message: Message): PermissionActor {
  return {
    roleIds: roleIdsFromMember(message.member),
    userId: message.author.id,
  };
}

export function actorFromInteraction(
  interaction: CommandInteraction,
): PermissionActor {
  return {
    roleIds: roleIdsFromMember(interaction.member),
    userId: interaction.user.id,
  };
}
