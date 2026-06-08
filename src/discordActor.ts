import { CommandInteraction, Message, User } from "discord.js";
import { PermissionActor } from "./permissions.ts";

type MemberWithRoles = {
  roles?: unknown;
};

type MemberWithDisplayName = {
  displayName?: string | null;
  nick?: string | null;
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

type ActorInteraction = {
  member?: unknown;
  user: User;
};

export function actorFromInteraction(
  interaction: ActorInteraction,
): PermissionActor {
  return {
    roleIds: roleIdsFromMember(interaction.member),
    userId: interaction.user.id,
  };
}

function cleanDisplayName(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function displayNameFromMessage(message: Message): string {
  return cleanDisplayName(message.member?.displayName) ??
    cleanDisplayName(message.author.globalName) ??
    message.author.username;
}

export function displayNameFromInteraction(
  interaction: CommandInteraction,
): string {
  const member = interaction.member as MemberWithDisplayName | null;

  return cleanDisplayName(member?.displayName) ??
    cleanDisplayName(member?.nick) ??
    cleanDisplayName(interaction.user.globalName) ??
    interaction.user.username;
}
