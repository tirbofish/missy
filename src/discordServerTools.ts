import {
  ChannelType,
  CommandInteraction,
  Guild,
  GuildBasedChannel,
  GuildMember,
  Message,
  PermissionFlagsBits,
} from "discord.js";
import { MistralToolDefinition } from "./mcp.ts";

export type DiscordServerToolContext = {
  currentChannelId?: string;
  guild: Guild;
  requesterId: string;
};

export const DISCORD_SERVER_TOOL_NAMES = {
  listChannels: "missy_discord_list_channels",
  listRoles: "missy_discord_list_roles",
  searchMembers: "missy_discord_search_members",
  sendChannelMessage: "missy_discord_send_channel_message",
  serverInfo: "missy_discord_server_info",
} as const;

const MAX_MEMBER_RESULTS = 25;
const MAX_CHANNEL_RESULTS = 50;
const MAX_ROLE_RESULTS = 50;
const MAX_SEND_CONTENT_LENGTH = 1_800;

export const discordServerTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: DISCORD_SERVER_TOOL_NAMES.serverInfo,
      description:
        "Get basic information about the current Discord server/guild.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: DISCORD_SERVER_TOOL_NAMES.searchMembers,
      description:
        "Search members in the current Discord server by display name, nickname, username, or user id. Use this for questions like 'who is aric?' instead of guessing from chat context.",
      parameters: {
        type: "object",
        properties: {
          includeBots: {
            type: "boolean",
            description:
              "Whether bot users should be included. Defaults false.",
          },
          limit: {
            type: "integer",
            description: "Maximum results to return, up to 25.",
          },
          query: {
            type: "string",
            description:
              "Name, nickname, username, mention, or user id to search for. Leave empty only to inspect currently cached members.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: DISCORD_SERVER_TOOL_NAMES.listChannels,
      description:
        "List channels in the current Discord server. Use this to understand available channels before mentioning or posting to them.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum channels to return, up to 50.",
          },
          query: {
            type: "string",
            description: "Optional channel name/id filter.",
          },
          type: {
            type: "string",
            enum: ["text", "voice", "category", "thread", "stage", "forum"],
            description: "Optional channel type filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: DISCORD_SERVER_TOOL_NAMES.listRoles,
      description: "List roles in the current Discord server.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum roles to return, up to 50.",
          },
          query: {
            type: "string",
            description: "Optional role name/id filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: DISCORD_SERVER_TOOL_NAMES.sendChannelMessage,
      description:
        "Send a plain text message to a channel in the current Discord server. Only use after the user explicitly asks or confirms the exact message/channel. The requesting user and bot must both have permission to view and send in that channel.",
      parameters: {
        type: "object",
        properties: {
          channelId: {
            type: "string",
            description:
              "Target channel id. Defaults to the current channel if omitted.",
          },
          content: {
            type: "string",
            description: "Plain text message to send, up to 1800 characters.",
          },
        },
        required: ["content"],
      },
    },
  },
];

export function discordServerToolContextFromMessage(
  message: Message,
): DiscordServerToolContext | undefined {
  if (!message.guild) {
    return undefined;
  }

  return {
    currentChannelId: message.channelId,
    guild: message.guild,
    requesterId: message.author.id,
  };
}

export function discordServerToolContextFromInteraction(
  interaction: CommandInteraction,
): DiscordServerToolContext | undefined {
  if (!interaction.guild) {
    return undefined;
  }

  return {
    currentChannelId: interaction.channelId,
    guild: interaction.guild,
    requesterId: interaction.user.id,
  };
}

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function clampLimit(value: unknown, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(Math.trunc(parsed), max))
    : fallback;
}

function normalizeQuery(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^<@!?|>$/g, "")
    .toLowerCase();
}

function channelTypeName(channel: GuildBasedChannel): string {
  switch (channel.type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildStageVoice:
      return "stage";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return "thread";
    default:
      return String(channel.type);
  }
}

function channelPosition(channel: GuildBasedChannel): number {
  return "rawPosition" in channel
    ? channel.rawPosition
    : Number.MAX_SAFE_INTEGER;
}

function memberMatches(member: GuildMember, query: string): boolean {
  if (!query) {
    return true;
  }

  return member.id === query ||
    member.displayName.toLowerCase().includes(query) ||
    (member.nickname?.toLowerCase().includes(query) ?? false) ||
    member.user.username.toLowerCase().includes(query) ||
    member.user.tag.toLowerCase().includes(query) ||
    (member.user.globalName?.toLowerCase().includes(query) ?? false);
}

function memberSummary(member: GuildMember): Record<string, unknown> {
  return {
    bot: member.user.bot,
    displayName: member.displayName,
    id: member.id,
    joinedAt: member.joinedAt?.toISOString(),
    mention: `<@${member.id}>`,
    nickname: member.nickname,
    roles: member.roles.cache
      .filter((role) => role.id !== member.guild.id)
      .map((role) => ({ id: role.id, name: role.name })),
    tag: member.user.tag,
    username: member.user.username,
  };
}

async function searchMembers(
  context: DiscordServerToolContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = normalizeQuery(args.query);
  const limit = clampLimit(args.limit, MAX_MEMBER_RESULTS, 10);
  const includeBots = args.includeBots === true;
  let members: GuildMember[] = [];
  let fetched = false;
  let fetchError: string | undefined;

  if (/^\d{15,25}$/.test(query)) {
    try {
      members = [await context.guild.members.fetch(query)];
      fetched = true;
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }
  } else if (query) {
    try {
      const found = await context.guild.members.fetch({ limit, query });
      members = [...found.values()];
      fetched = true;
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }
  }

  if (members.length === 0) {
    members = [...context.guild.members.cache.values()]
      .filter((member) => memberMatches(member, query))
      .slice(0, limit);
  }

  members = members
    .filter((member) => includeBots || !member.user.bot)
    .slice(0, limit);

  return {
    fetchError,
    fetched,
    members: members.map(memberSummary),
    note: fetched
      ? undefined
      : "Results may be limited to cached members. Enable the Discord Server Members intent for fuller member search.",
  };
}

function listChannels(
  context: DiscordServerToolContext,
  args: Record<string, unknown>,
): unknown {
  const query = normalizeQuery(args.query);
  const limit = clampLimit(args.limit, MAX_CHANNEL_RESULTS, 25);
  const requestedType = String(args.type ?? "").trim().toLowerCase();
  const channels = [...context.guild.channels.cache.values()]
    .filter((channel) => {
      const type = channelTypeName(channel);
      const name = "name" in channel ? channel.name.toLowerCase() : "";
      return (!query || channel.id === query || name.includes(query)) &&
        (!requestedType || type === requestedType);
    })
    .sort((a, b) => channelPosition(a) - channelPosition(b))
    .slice(0, limit)
    .map((channel) => ({
      id: channel.id,
      mention: channel.isTextBased() ? `<#${channel.id}>` : undefined,
      name: "name" in channel ? channel.name : undefined,
      parentId: "parentId" in channel ? channel.parentId : undefined,
      type: channelTypeName(channel),
    }));

  return { channels };
}

function listRoles(
  context: DiscordServerToolContext,
  args: Record<string, unknown>,
): unknown {
  const query = normalizeQuery(args.query);
  const limit = clampLimit(args.limit, MAX_ROLE_RESULTS, 25);
  const roles = [...context.guild.roles.cache.values()]
    .filter((role) =>
      role.id !== context.guild.id &&
      (!query || role.id === query || role.name.toLowerCase().includes(query))
    )
    .sort((a, b) => b.position - a.position)
    .slice(0, limit)
    .map((role) => ({
      color: role.hexColor,
      hoist: role.hoist,
      id: role.id,
      mention: `<@&${role.id}>`,
      name: role.name,
      position: role.position,
    }));

  return { roles };
}

async function requesterMember(
  context: DiscordServerToolContext,
): Promise<GuildMember> {
  return await context.guild.members.fetch(context.requesterId);
}

function channelPermissionTarget(channel: GuildBasedChannel): {
  permissionsFor?: (
    member: GuildMember,
  ) => { has: (permission: bigint) => boolean } | null;
} {
  return channel as unknown as {
    permissionsFor?: (
      member: GuildMember,
    ) => { has: (permission: bigint) => boolean } | null;
  };
}

async function sendChannelMessage(
  context: DiscordServerToolContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const channelId = String(args.channelId ?? context.currentChannelId ?? "")
    .trim()
    .replace(/^<#|>$/g, "");
  const content = String(args.content ?? "").trim().slice(
    0,
    MAX_SEND_CONTENT_LENGTH,
  );

  if (!channelId) {
    throw new Error("channelId is required when there is no current channel.");
  }

  if (!content) {
    throw new Error("content is required.");
  }

  const channel = await context.guild.channels.fetch(channelId);

  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error(`Channel ${channelId} is not a sendable text channel.`);
  }

  const requester = await requesterMember(context);
  const botMember = await context.guild.members.fetchMe();
  const permissionTarget = channelPermissionTarget(channel);
  const requesterPermissions = permissionTarget.permissionsFor?.(requester);
  const botPermissions = permissionTarget.permissionsFor?.(botMember);

  if (
    !requesterPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !requesterPermissions.has(PermissionFlagsBits.SendMessages)
  ) {
    throw new Error(
      "The requesting user cannot send messages in that channel.",
    );
  }

  if (
    !botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !botPermissions.has(PermissionFlagsBits.SendMessages)
  ) {
    throw new Error("Missy cannot send messages in that channel.");
  }

  const sent = await channel.send(content);

  return {
    channelId,
    messageId: sent.id,
    sent: true,
  };
}

export function isDiscordServerTool(toolName: string): boolean {
  return Object.values(DISCORD_SERVER_TOOL_NAMES).includes(
    toolName as typeof DISCORD_SERVER_TOOL_NAMES[
      keyof typeof DISCORD_SERVER_TOOL_NAMES
    ],
  );
}

export function shouldUseDiscordServerTools(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return /\b(server|guild|member|members|user|users|nickname|display name|username|role|roles|channel|channels|who is|who's|which person|everyone in the server|post in|send in|say in)\b/
    .test(normalized) ||
    /\bwho\b.{0,50}\bis\b/.test(normalized) ||
    /<@!?\d{15,25}>|<#\d{15,25}>|<@&\d{15,25}>/.test(message);
}

export async function callDiscordServerTool(
  toolName: string,
  rawArguments: unknown,
  context: DiscordServerToolContext,
): Promise<string> {
  const args = parseArgs(rawArguments);

  if (toolName === DISCORD_SERVER_TOOL_NAMES.serverInfo) {
    return JSON.stringify({
      id: context.guild.id,
      memberCount: context.guild.memberCount,
      name: context.guild.name,
      ownerId: context.guild.ownerId,
      preferredLocale: context.guild.preferredLocale,
    });
  }

  if (toolName === DISCORD_SERVER_TOOL_NAMES.searchMembers) {
    return JSON.stringify(await searchMembers(context, args));
  }

  if (toolName === DISCORD_SERVER_TOOL_NAMES.listChannels) {
    return JSON.stringify(listChannels(context, args));
  }

  if (toolName === DISCORD_SERVER_TOOL_NAMES.listRoles) {
    return JSON.stringify(listRoles(context, args));
  }

  if (toolName === DISCORD_SERVER_TOOL_NAMES.sendChannelMessage) {
    return JSON.stringify(await sendChannelMessage(context, args));
  }

  throw new Error(`Unknown Discord server tool: ${toolName}`);
}
