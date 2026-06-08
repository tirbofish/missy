import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  ComponentType,
  Message,
} from "discord.js";
import path from "node:path";
import {
  FileOperationApprovalRequest,
  FILESYSTEM_TOOL_NAMES,
  resolveLocalPath,
} from "./filesystemTools.ts";
import { searchGiphyGif } from "./giphy.ts";
import { type MistralToolActivity, splitDiscordMessages } from "./mistral.ts";
import { actorFromInteraction, actorFromMessage } from "./discordActor.ts";
import { canAccessLocalComputer } from "./localAccess.ts";

type TypingChannel = {
  sendTyping: () => Promise<void>;
};

type DiscordOutboundMessage = string | {
  content?: string;
  files?: string[];
};

type SendableChannel = {
  send: (content: DiscordOutboundMessage) => Promise<unknown>;
};

export type ResponseControls = {
  content: string;
  contentWithMedia: string;
  gifSearchQueries: string[];
  localFilePaths: string[];
  mediaUrls: string[];
  noReply: boolean;
  reactions: string[];
};

export type AgentActivity = {
  finish: (finalReplySent?: boolean) => Promise<void>;
  requestFileOperationApproval: (
    request: FileOperationApprovalRequest,
  ) => Promise<boolean>;
  update: (content: string) => Promise<void>;
};

const FOLLOWUP_MESSAGE_DELAY_MS = 1_200;
const MAX_LOCAL_ATTACHMENTS = 4;
const MAX_LOCAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function extractResponseControls(content: string): ResponseControls {
  const mediaUrls: string[] = [];
  const gifSearchQueries: string[] = [];
  const localFilePaths: string[] = [];
  const reactions: string[] = [];
  const lines = content.split(/\r?\n/);
  const remainingLines = [];
  const remainingLinesWithMedia = [];
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

    const mediaMatch = trimmed.match(/^MISSY_(?:IMAGE|GIF|MEDIA):\s*(.+)$/i);
    if (mediaMatch?.[1]) {
      const mediaUrl = mediaMatch[1].trim();
      mediaUrls.push(mediaUrl);
      remainingLinesWithMedia.push(mediaUrl);
      continue;
    }

    const gifSearchMatch = trimmed.match(/^MISSY_GIF_SEARCH:\s*(.+)$/i);
    if (gifSearchMatch?.[1]) {
      const query = gifSearchMatch[1].trim();
      gifSearchQueries.push(query);
      remainingLinesWithMedia.push(`MISSY_GIF_SEARCH: ${query}`);
      continue;
    }

    const localAttachmentMatch = trimmed.match(
      /^MISSY_(?:ATTACH|FILE|UPLOAD)_LOCAL:\s*(.+)$/i,
    );
    if (localAttachmentMatch?.[1]) {
      localFilePaths.push(stripPathWrapper(localAttachmentMatch[1]));
      continue;
    }

    remainingLines.push(line);
    remainingLinesWithMedia.push(line);
  }

  return {
    content: remainingLines.join("\n").trim(),
    contentWithMedia: remainingLinesWithMedia.join("\n").trim(),
    gifSearchQueries,
    localFilePaths,
    mediaUrls,
    noReply,
    reactions,
  };
}

export function responseContentWithMedia(controls: ResponseControls): string {
  return controls.contentWithMedia.trim();
}

function stripPathWrapper(value: string): string {
  return value.trim().replace(/^["'`]+|["'`]+$/g, "");
}

function outboundMessage(
  content: string | undefined,
  files: string[] = [],
): DiscordOutboundMessage {
  const trimmedContent = content?.trim() ||
    (files.length > 0 ? localAttachmentUploadContent(files) : undefined);

  if (files.length > 0) {
    return trimmedContent ? { content: trimmedContent, files } : { files };
  }

  return trimmedContent ?? "";
}

export function localAttachmentUploadContent(files: readonly string[]): string {
  const [firstFile] = files;

  if (!firstFile) {
    return "uploading the attachment";
  }

  const filename = path.basename(firstFile);
  const extraCount = files.length - 1;

  return extraCount > 0
    ? `uploading \`${filename}\` and ${extraCount} more`
    : `uploading \`${filename}\``;
}

function parseToolArguments(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    try {
      const parsed = JSON.parse(rawArguments) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return rawArguments && typeof rawArguments === "object" &&
      !Array.isArray(rawArguments)
    ? rawArguments as Record<string, unknown>
    : {};
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}

function compactValue(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

export function agentToolActivityContent(
  activity: MistralToolActivity,
): string {
  const args = parseToolArguments(activity.arguments);
  const pathArg = compactValue(args.path);
  const sourcePath = compactValue(args.sourcePath);
  const destinationPath = compactValue(args.destinationPath);

  switch (activity.toolName) {
    case FILESYSTEM_TOOL_NAMES.denoRepl: {
      const code = compactValue(args.code, 180);
      return code
        ? `running a local Deno check: ${inlineCode(code)}`
        : "running a local Deno check.";
    }
    case FILESYSTEM_TOOL_NAMES.list:
      return pathArg
        ? `checking the folder ${inlineCode(pathArg)}`
        : "checking a local folder.";
    case FILESYSTEM_TOOL_NAMES.find:
      return pathArg
        ? `searching local files in ${inlineCode(pathArg)}`
        : "searching local files.";
    case FILESYSTEM_TOOL_NAMES.stat:
      return pathArg
        ? `inspecting ${inlineCode(pathArg)}`
        : "inspecting a local path.";
    case FILESYSTEM_TOOL_NAMES.read:
      return pathArg
        ? `reading ${inlineCode(pathArg)}`
        : "reading a local file.";
    case FILESYSTEM_TOOL_NAMES.copy:
      return sourcePath && destinationPath
        ? `copying ${inlineCode(sourcePath)} to ${inlineCode(destinationPath)}`
        : "copying a local path.";
    case FILESYSTEM_TOOL_NAMES.move:
      return sourcePath && destinationPath
        ? `moving ${inlineCode(sourcePath)} to ${inlineCode(destinationPath)}`
        : "moving a local path.";
    case FILESYSTEM_TOOL_NAMES.mkdir:
      return pathArg
        ? `creating ${inlineCode(pathArg)}`
        : "creating a local folder.";
    case FILESYSTEM_TOOL_NAMES.writeText:
      return pathArg
        ? `writing ${inlineCode(pathArg)}`
        : "writing a local file.";
    case FILESYSTEM_TOOL_NAMES.delete:
      return pathArg
        ? `deleting ${inlineCode(pathArg)}`
        : "deleting a local path.";
    default:
      return `using ${inlineCode(activity.toolName)}.`;
  }
}

async function safeLocalAttachmentPath(rawPath: string): Promise<
  string | undefined
> {
  const resolvedPath = resolveLocalPath(rawPath);

  try {
    const info = await Deno.stat(resolvedPath);

    if (!info.isFile || info.size > MAX_LOCAL_ATTACHMENT_BYTES) {
      return undefined;
    }

    return resolvedPath;
  } catch (error) {
    console.error(
      `Could not inspect local attachment path ${resolvedPath}`,
      error,
    );
    return undefined;
  }
}

async function approvedMessageLocalAttachments(
  message: Message,
  localFilePaths: readonly string[],
  requestApproval: (
    request: FileOperationApprovalRequest,
  ) => Promise<boolean> = (request) =>
    requestMessageFileOperationApproval(message, request),
): Promise<string[]> {
  if (!canAccessLocalComputer(actorFromMessage(message))) {
    return [];
  }

  const approvedPaths: string[] = [];

  for (const rawPath of localFilePaths.slice(0, MAX_LOCAL_ATTACHMENTS)) {
    const resolvedPath = await safeLocalAttachmentPath(rawPath);

    if (!resolvedPath) {
      continue;
    }

    const approved = await requestApproval({
      action: "read",
      subject: "file",
      targetPath: resolvedPath,
    });

    if (approved) {
      approvedPaths.push(resolvedPath);
    }
  }

  return approvedPaths;
}

async function approvedInteractionLocalAttachments(
  interaction: CommandInteraction,
  localFilePaths: readonly string[],
  requestApproval: (
    request: FileOperationApprovalRequest,
  ) => Promise<boolean> = (request) =>
    requestInteractionFileOperationApproval(interaction, request),
): Promise<string[]> {
  if (!canAccessLocalComputer(actorFromInteraction(interaction))) {
    return [];
  }

  const approvedPaths: string[] = [];

  for (const rawPath of localFilePaths.slice(0, MAX_LOCAL_ATTACHMENTS)) {
    const resolvedPath = await safeLocalAttachmentPath(rawPath);

    if (!resolvedPath) {
      continue;
    }

    const approved = await requestApproval({
      action: "read",
      subject: "file",
      targetPath: resolvedPath,
    });

    if (approved) {
      approvedPaths.push(resolvedPath);
    }
  }

  return approvedPaths;
}

export async function resolveResponseControls(
  controls: ResponseControls,
): Promise<ResponseControls> {
  if (controls.gifSearchQueries.length === 0) {
    return controls;
  }

  const mediaUrls = [...controls.mediaUrls];
  const resolvedLines = [];

  for (const line of controls.contentWithMedia.split(/\r?\n/)) {
    const gifSearchMatch = line.trim().match(/^MISSY_GIF_SEARCH:\s*(.+)$/i);

    if (!gifSearchMatch?.[1]) {
      resolvedLines.push(line);
      continue;
    }

    const gifUrl = await searchGiphyGif(gifSearchMatch[1]);
    if (gifUrl) {
      mediaUrls.push(gifUrl);
      resolvedLines.push(gifUrl);
    }
  }

  return {
    ...controls,
    contentWithMedia: resolvedLines.join("\n").trim(),
    mediaUrls,
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

function buildActivityDoneMessage(): string {
  return "tool stuff is done.";
}

export function localAttachmentFailureContent(
  localFilePaths: readonly string[],
): string {
  const [firstPath] = localFilePaths;

  if (!firstPath) {
    return "couldn't upload that file - nothing usable came back from the local file picker.";
  }

  return `couldn't upload ${
    inlineCode(path.basename(firstPath))
  } - it was missing, too big, or the read approval didn't go through.`;
}

function buildApprovedActivityMessage(
  request: FileOperationApprovalRequest,
): string {
  return `Approved filesystem ${request.action}. still working.`;
}

function buildDeniedActivityMessage(
  request: FileOperationApprovalRequest,
): string {
  return `Denied filesystem ${request.action}.`;
}

function buildTimedOutActivityMessage(
  request: FileOperationApprovalRequest,
): string {
  return `Filesystem ${request.action} approval timed out.`;
}

async function awaitFileApproval(
  approvalMessage: Message,
  request: FileOperationApprovalRequest,
  actor: {
    channelId?: string;
    guildId?: string | null;
    userId: string;
    username?: string;
  },
  approveId: string,
  denyId: string,
): Promise<boolean> {
  try {
    const interaction = await approvalMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (interaction) =>
        interaction.user.id === actor.userId &&
        (interaction.customId === approveId || interaction.customId === denyId),
      time: 60_000,
    });
    const approved = interaction.customId === approveId;
    logFilesystemAccess(approved ? "approved" : "denied", actor, request);

    await interaction.update({
      components: [],
      content: approved
        ? buildApprovedActivityMessage(request)
        : buildDeniedActivityMessage(request),
    });

    return approved;
  } catch {
    logFilesystemAccess("timed_out", actor, request);
    await approvalMessage.edit({
      components: [],
      content: buildTimedOutActivityMessage(request),
    });
    return false;
  }
}

class MessageAgentActivity implements AgentActivity {
  private activityMessage?: Message;

  constructor(private readonly sourceMessage: Message) {}

  async update(content: string): Promise<void> {
    await this.upsert({
      components: [],
      content,
    });
  }

  async finish(_finalReplySent = false): Promise<void> {
    if (!this.activityMessage) {
      return;
    }

    try {
      await this.activityMessage.delete();
    } catch {
      // Message may already be deleted
    }
  }

  async requestFileOperationApproval(
    request: FileOperationApprovalRequest,
  ): Promise<boolean> {
    const actor = {
      channelId: this.sourceMessage.channelId,
      guildId: this.sourceMessage.guildId,
      userId: this.sourceMessage.author.id,
      username: this.sourceMessage.author.tag,
    };
    const nonce = crypto.randomUUID();
    const approveId = `file-approve:${nonce}`;
    const denyId = `file-deny:${nonce}`;
    logFilesystemAccess("requested", actor, request);
    const approvalMessage = await this.upsert({
      components: buildApprovalComponents(approveId, denyId),
      content: buildOperationApprovalMessage(request),
    });

    return await awaitFileApproval(
      approvalMessage,
      request,
      actor,
      approveId,
      denyId,
    );
  }

  private async upsert(options: {
    components: ReturnType<typeof buildApprovalComponents> | [];
    content: string;
  }): Promise<Message> {
    if (!this.activityMessage) {
      this.activityMessage = await this.sourceMessage.reply(options);
      return this.activityMessage;
    }

    await this.activityMessage.edit(options);
    return this.activityMessage;
  }
}

class InteractionAgentActivity implements AgentActivity {
  private activityMessage?: Message;

  constructor(private readonly interaction: CommandInteraction) {}

  async update(content: string): Promise<void> {
    await this.upsert({
      components: [],
      content,
    });
  }

  async requestFileOperationApproval(
    request: FileOperationApprovalRequest,
  ): Promise<boolean> {
    const actor = {
      channelId: this.interaction.channelId,
      guildId: this.interaction.guildId,
      userId: this.interaction.user.id,
      username: this.interaction.user.tag,
    };
    const nonce = crypto.randomUUID();
    const approveId = `file-approve:${nonce}`;
    const denyId = `file-deny:${nonce}`;
    logFilesystemAccess("requested", actor, request);
    const approvalMessage = await this.upsert({
      components: buildApprovalComponents(approveId, denyId),
      content: buildOperationApprovalMessage(request),
    });

    return await awaitFileApproval(
      approvalMessage,
      request,
      actor,
      approveId,
      denyId,
    );
  }

  async finish(_finalReplySent = false): Promise<void> {
    if (!this.activityMessage) {
      return;
    }

    try {
      await this.activityMessage.delete();
    } catch {
      // Message may already be deleted
    }
  }

  private async upsert(options: {
    components: ReturnType<typeof buildApprovalComponents> | [];
    content: string;
  }): Promise<Message> {
    if (!this.activityMessage) {
      this.activityMessage = await this.interaction.followUp({
        ...options,
        ephemeral: true,
        fetchReply: true,
      }) as Message;
      return this.activityMessage;
    }

    await this.activityMessage.edit(options);
    return this.activityMessage;
  }
}

export function createMessageAgentActivity(message: Message): AgentActivity {
  return new MessageAgentActivity(message);
}

export function createInteractionAgentActivity(
  interaction: CommandInteraction,
): AgentActivity {
  return new InteractionAgentActivity(interaction);
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
  options: {
    requestFileOperationApproval?: (
      request: FileOperationApprovalRequest,
    ) => Promise<boolean>;
  } = {},
): Promise<boolean> {
  const controls = extractResponseControls(content);

  for (const reaction of controls.reactions) {
    try {
      await message.react(reaction);
    } catch (error) {
      console.error(`Could not react with ${reaction}`, error);
    }
  }

  if (controls.noReply) {
    return false;
  }

  const resolvedControls = await resolveResponseControls(controls);
  const localAttachments = await approvedMessageLocalAttachments(
    message,
    resolvedControls.localFilePaths,
    options.requestFileOperationApproval,
  );
  const [firstMessage, ...remainingMessages] = splitDiscordMessages(
    responseContentWithMedia(resolvedControls),
  );

  if (!firstMessage && localAttachments.length === 0) {
    if (resolvedControls.localFilePaths.length > 0) {
      await message.reply(
        localAttachmentFailureContent(resolvedControls.localFilePaths),
      );
      return true;
    }

    return false;
  }

  try {
    await message.reply(outboundMessage(firstMessage, localAttachments));
  } catch (error) {
    if (localAttachments.length === 0) {
      throw error;
    }

    console.error("Could not upload local attachment", error);
    await message.reply(localAttachmentFailureContent(localAttachments));
    return true;
  }

  const channel = message.channel as Partial<SendableChannel>;
  if (typeof channel.send !== "function") {
    return true;
  }

  for (const nextMessage of remainingMessages) {
    await sleep(FOLLOWUP_MESSAGE_DELAY_MS);
    await channel.send(nextMessage);
  }

  return true;
}

export async function editReplyWithDiscordMessages(
  interaction: CommandInteraction,
  content: string,
  options: {
    requestFileOperationApproval?: (
      request: FileOperationApprovalRequest,
    ) => Promise<boolean>;
  } = {},
): Promise<boolean> {
  const controls = await resolveResponseControls(
    extractResponseControls(content),
  );
  const localAttachments = await approvedInteractionLocalAttachments(
    interaction,
    controls.localFilePaths,
    options.requestFileOperationApproval,
  );
  const [firstMessage, ...remainingMessages] = splitDiscordMessages(
    responseContentWithMedia(controls),
  );

  if (controls.noReply || (!firstMessage && localAttachments.length === 0)) {
    await interaction.editReply(
      controls.localFilePaths.length > 0
        ? localAttachmentFailureContent(controls.localFilePaths)
        : "Done.",
    );
    return !controls.noReply;
  }

  try {
    await interaction.editReply(
      outboundMessage(firstMessage, localAttachments),
    );
  } catch (error) {
    if (localAttachments.length === 0) {
      throw error;
    }

    console.error("Could not upload local attachment", error);
    await interaction.editReply(
      localAttachmentFailureContent(localAttachments),
    );
    return true;
  }

  for (const nextMessage of remainingMessages) {
    await sleep(FOLLOWUP_MESSAGE_DELAY_MS);
    await interaction.followUp({
      content: nextMessage,
      ephemeral: true,
    });
  }

  return true;
}

export async function requestMessageFileOperationApproval(
  message: Message,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  return await createMessageAgentActivity(message)
    .requestFileOperationApproval(request);
}

export async function requestInteractionFileOperationApproval(
  interaction: CommandInteraction,
  request: FileOperationApprovalRequest,
): Promise<boolean> {
  return await createInteractionAgentActivity(interaction)
    .requestFileOperationApproval(request);
}
