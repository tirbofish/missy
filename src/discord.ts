import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  ComponentType,
  Message,
} from "discord.js";
import { FileOperationApprovalRequest } from "./filesystemTools.ts";
import { splitDiscordMessages } from "./mistral.ts";

type TypingChannel = {
  sendTyping: () => Promise<void>;
};

type SendableChannel = {
  send: (content: string) => Promise<unknown>;
};

type ResponseControls = {
  content: string;
  noReply: boolean;
  reactions: string[];
};

function extractResponseControls(content: string): ResponseControls {
  const reactions: string[] = [];
  const lines = content.split(/\r?\n/);
  const remainingLines = [];
  let noReply = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "MISSY_NO_REPLY") {
      noReply = true;
      continue;
    }

    const reactionMatch = trimmed.match(/^MISSY_REACT:\s*(.+)$/);
    if (reactionMatch?.[1]) {
      reactions.push(reactionMatch[1].trim());
      continue;
    }

    remainingLines.push(line);
  }

  return {
    content: remainingLines.join("\n").trim(),
    noReply,
    reactions,
  };
}

function formatPath(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function buildApprovalComponents(approveId: string, denyId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(approveId)
        .setEmoji("✅")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(denyId)
        .setEmoji("❌")
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildOperationApprovalMessage(
  request: FileOperationApprovalRequest,
): string {
  if (request.action === "deno_permission") {
    return [
      `Approve Deno REPL ${request.permission?.name ?? "local"} permission?`,
      "",
      `Working directory: \`${
        formatPath(request.workingDirectory ?? request.targetPath ?? "")
      }\``,
      `Permission target: \`${
        formatPath(request.permission?.target ?? "all")
      }\``,
      "",
      "```ts",
      request.code ?? "",
      "```",
    ].join("\n");
  }

  if (request.action === "copy") {
    return [
      "Approve copying this local path?",
      "",
      `From: \`${formatPath(request.sourcePath ?? "")}\``,
      `To: \`${formatPath(request.destinationPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "move") {
    return [
      `Approve moving this ${request.subject}?`,
      "",
      `From: \`${formatPath(request.sourcePath ?? "")}\``,
      `To: \`${formatPath(request.destinationPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "delete") {
    return [
      `Approve deleting this ${request.subject}?`,
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
      "",
      "This cannot be undone by Missy.",
    ].join("\n");
  }

  if (request.action === "find") {
    return [
      "Approve recursively searching this local folder?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "list") {
    return [
      "Approve listing this local folder?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "read") {
    return [
      "Approve reading this local file?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "stat") {
    return [
      "Approve inspecting this local path?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "mkdir") {
    return [
      "Approve creating this local folder?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  if (request.action === "write") {
    return [
      "Approve writing this local file?",
      "",
      `Path: \`${formatPath(request.targetPath ?? "")}\``,
    ].join("\n");
  }

  return [
    `Approve overwriting this ${request.subject}?`,
    "",
    `Path: \`${formatPath(request.targetPath ?? "")}\``,
  ].join("\n");
}

function logFilesystemAccess(
  event: "requested" | "approved" | "denied" | "timed_out",
  actor: {
    channelId?: string;
    guildId?: string | null;
    userId: string;
    username?: string;
  },
  request: FileOperationApprovalRequest,
): void {
  console.info(JSON.stringify({
    action: request.action,
    at: new Date().toISOString(),
    channelId: actor.channelId,
    code: request.code,
    destinationPath: request.destinationPath,
    event: `filesystem_${event}`,
    guildId: actor.guildId,
    permission: request.permission,
    sourcePath: request.sourcePath,
    subject: request.subject,
    targetPath: request.targetPath,
    userId: actor.userId,
    username: actor.username,
    workingDirectory: request.workingDirectory,
  }));
}

export async function sendTyping(message: Message): Promise<void> {
  const channel = message.channel as Partial<TypingChannel>;

  if (typeof channel.sendTyping === "function") {
    await channel.sendTyping();
  }
}

export async function replyWithDiscordMessages(
  message: Message,
  content: string,
): Promise<void> {
  const controls = extractResponseControls(content);

  for (const reaction of controls.reactions) {
    try {
      await message.react(reaction);
    } catch (error) {
      console.error(`Could not react with ${reaction}`, error);
    }
  }

  if (controls.noReply) {
    return;
  }

  const [firstMessage, ...remainingMessages] = splitDiscordMessages(
    controls.content,
  );

  if (!firstMessage) {
    return;
  }

  await message.reply(firstMessage);

  const channel = message.channel as Partial<SendableChannel>;
  if (typeof channel.send !== "function") {
    return;
  }

  for (const nextMessage of remainingMessages) {
    await channel.send(nextMessage);
  }
}

export async function editReplyWithDiscordMessages(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  const controls = extractResponseControls(content);
  const [firstMessage, ...remainingMessages] = splitDiscordMessages(
    controls.content,
  );

  if (!firstMessage || controls.noReply) {
    await interaction.editReply("Done.");
    return;
  }

  await interaction.editReply(firstMessage);

  for (const nextMessage of remainingMessages) {
    await interaction.followUp({
      content: nextMessage,
      ephemeral: true,
    });
  }
}

export async function requestMessageFileOperationApproval(
  message: Message,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  const actor = {
    channelId: message.channelId,
    guildId: message.guildId,
    userId: message.author.id,
    username: message.author.tag,
  };
  const nonce = crypto.randomUUID();
  const approveId = `file-approve:${nonce}`;
  const denyId = `file-deny:${nonce}`;
  logFilesystemAccess("requested", actor, request);
  const approvalMessage = await message.reply({
    components: buildApprovalComponents(approveId, denyId),
    content: buildOperationApprovalMessage(request),
  });

  try {
    const interaction = await approvalMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (interaction) =>
        interaction.user.id === message.author.id &&
        (interaction.customId === approveId || interaction.customId === denyId),
      time: 60_000,
    });
    const approved = interaction.customId === approveId;
    logFilesystemAccess(approved ? "approved" : "denied", actor, request);

    await interaction.update({
      components: [],
      content: approved
        ? `Approved filesystem ${request.action}.`
        : `Denied filesystem ${request.action}.`,
    });

    return approved;
  } catch {
    logFilesystemAccess("timed_out", actor, request);
    await approvalMessage.edit({
      components: [],
      content: `Filesystem ${request.action} approval timed out.`,
    });
    return false;
  }
}

export async function requestInteractionFileOperationApproval(
  interaction: CommandInteraction,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  const actor = {
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: interaction.user.tag,
  };
  const nonce = crypto.randomUUID();
  const approveId = `file-approve:${nonce}`;
  const denyId = `file-deny:${nonce}`;
  logFilesystemAccess("requested", actor, request);
  const approvalMessage = await interaction.followUp({
    components: buildApprovalComponents(approveId, denyId),
    content: buildOperationApprovalMessage(request),
    ephemeral: true,
    fetchReply: true,
  }) as Message;

  try {
    const componentInteraction = await approvalMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (componentInteraction) =>
        componentInteraction.user.id === interaction.user.id &&
        (componentInteraction.customId === approveId ||
          componentInteraction.customId === denyId),
      time: 60_000,
    });
    const approved = componentInteraction.customId === approveId;
    logFilesystemAccess(approved ? "approved" : "denied", actor, request);

    await componentInteraction.update({
      components: [],
      content: approved
        ? `Approved filesystem ${request.action}.`
        : `Denied filesystem ${request.action}.`,
    });

    return approved;
  } catch {
    logFilesystemAccess("timed_out", actor, request);
    await approvalMessage.edit({
      components: [],
      content: `Filesystem ${request.action} approval timed out.`,
    });
    return false;
  }
}
