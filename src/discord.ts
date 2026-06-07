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
        .setLabel("Approve")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(denyId)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildOperationApprovalMessage(
  request: FileOperationApprovalRequest,
): string {
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

  return [
    `Approve overwriting this ${request.subject}?`,
    "",
    `Path: \`${formatPath(request.targetPath ?? "")}\``,
  ].join("\n");
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
  const nonce = crypto.randomUUID();
  const approveId = `file-approve:${nonce}`;
  const denyId = `file-deny:${nonce}`;
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

    await interaction.update({
      components: [],
      content: approved
        ? `Approved filesystem ${request.action}.`
        : `Denied filesystem ${request.action}.`,
    });

    return approved;
  } catch {
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
  const nonce = crypto.randomUUID();
  const approveId = `file-approve:${nonce}`;
  const denyId = `file-deny:${nonce}`;
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

    await componentInteraction.update({
      components: [],
      content: approved
        ? `Approved filesystem ${request.action}.`
        : `Denied filesystem ${request.action}.`,
    });

    return approved;
  } catch {
    await approvalMessage.edit({
      components: [],
      content: `Filesystem ${request.action} approval timed out.`,
    });
    return false;
  }
}
