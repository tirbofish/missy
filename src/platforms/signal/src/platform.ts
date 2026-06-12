/**
 * SignalPlatform — Signal platform adapter backed by signal-cli JSON-RPC daemon.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import type { AgentContext, AgentPlatform, ConversationMessage, InboundMessage } from "../../../core/types.ts";
import { delay, generateSessionId, normalizeSessionName, splitByDelimiter } from "../../../core/helpers.ts";
import type { SignalDataMessage, SignalPlatformConfig, SignalReceiveParams } from "./types.ts";
import { SignalJsonRpc } from "./jsonrpc.ts";
import { parseSignalConfig } from "./config.ts";
import { ensureJava, ensureSignalCli, SIGNAL_CLI_CONFIG_DIR, SIGNAL_CLI_DIR } from "./install.ts";

export class SignalPlatform implements AgentPlatform {
  readonly name = "signal";

  getSystemContext(): string {
    return [
      "<platform>",
      "  <name>Signal</name>",
      "  <description>You are communicating through Signal, a privacy-focused messenger with end-to-end encryption. Messages are sent via the signal-cli daemon.</description>",
      "  <capabilities>",
      "    <capability>Direct messages and groups</capability>",
      "    <capability>End-to-end encryption (Signal Protocol)</capability>",
      "    <capability>Message replies and reactions</capability>",
      "    <capability>File and image attachments</capability>",
      "    <capability>Typing indicators and read receipts</capability>",
      "    <capability>Mentions in groups</capability>",
      "  </capabilities>",
      "  <limits>",
      "    <limit name=\"message_length\">~4000 characters per message</limit>",
      "  </limits>",
      "  <routing>",
      "    <rule>In DMs, you see and respond to every message.</rule>",
      "    <rule>In groups, you only respond when mentioned by name or when a command prefix is used.</rule>",
      "  </routing>",
      "</platform>",
    ].join("\n");
  }

  #rpc: SignalJsonRpc | undefined;
  #context: AgentContext | undefined;
  #signalConfig: SignalPlatformConfig | undefined;
  #botAccount: string | undefined;
  #startedAt = 0;
  #daemonProcess: ChildProcess | undefined;
  #daemonAddress = "";
  #sessionIds = new Map<string, string>();
  #sessionStartedAt = new Map<string, number>();
  #conversationContext = new Map<string, ConversationMessage[]>();
  #seenTimestamps = new Set<string>();

  async start(context: AgentContext): Promise<void> {
    this.#context = context;
    this.#signalConfig = parseSignalConfig(context.config);

    await ensureJava(context.logger);
    const binPath = await ensureSignalCli(context.logger);

    const account = this.#signalConfig.account;
    if (!account) {
      throw new Error("SIGNAL_ACCOUNT is required to use the Signal platform. Set it in missy.config.json or the SIGNAL_ACCOUNT env var.");
    }

    this.#botAccount = account;
    const socketPath = this.#signalConfig.socketPath ?? resolveUnixSocketPath();
    this.#daemonAddress = socketPath;

    await this.#startDaemon(binPath, account);
    context.logger.info(`signal-cli daemon started`);

    this.#rpc = new SignalJsonRpc(context.logger);
    await this.#rpc.connect(socketPath);
    context.logger.info(`JSON-RPC connected to signal-cli`);

    await this.#verifyAccount(account);

    this.#startedAt = Date.now();
    this.#loadSessions();

    this.#rpc.on("receive", (params: Record<string, unknown>) => {
      this.#handleReceive(params as unknown as SignalReceiveParams).catch((error) =>
        context.logger.error("Failed to handle Signal message", error),
      );
    });

    context.logger.info(`Signal platform started for account ${account}`);
  }

  async stop(): Promise<void> {
    this.#rpc?.close();
    this.#rpc = undefined;
    if (this.#daemonProcess) {
      this.#daemonProcess.kill();
      this.#daemonProcess = undefined;
    }
    this.#sessionIds.clear();
    this.#sessionStartedAt.clear();
    this.#conversationContext.clear();
    this.#seenTimestamps.clear();
  }

  // ─── Daemon management ───────────────────────────────────────────────

  async #startDaemon(signalCliBin: string, account: string): Promise<void> {
    const address = this.#daemonAddress;
    // Clean stale socket
    if (address && !address.includes(":") && fs.existsSync(address)) {
      try { fs.unlinkSync(address); } catch { /* ignore */ }
    }
    const args = ["-a", account, "daemon", "--receive-mode", "manual", "--config", SIGNAL_CLI_CONFIG_DIR];
    if (address.includes(":")) {
      const [host, port] = address.split(":");
      args.push("--tcp", `${host}:${port}`);
    } else {
      args.push("--socket", address);
    }
    const daemon = spawn(signalCliBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SIGNAL_CLI_CONFIG_DIR },
    });
    this.#pipeDaemonStderr(daemon, this.#context!.logger);
    await this.#waitForDaemon(60_000);
    this.#daemonProcess = daemon;
  }

  #pipeDaemonStderr(p: ChildProcess, logger: AgentContext["logger"]): void {
    if (!p.stderr) return;
    (async () => {
      for await (const line of p.stderr!) {
        const text = typeof line === "string" ? line : new TextDecoder().decode(line);
        logger.debug(`signal-cli: ${text.trim()}`);
      }
    })().catch(() => {});
  }

  async #waitForDaemon(timeoutMs: number): Promise<void> {
    const address = this.#daemonAddress;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { createConnection } = await import("node:net");
      try {
        await new Promise<void>((resolve, reject) => {
          const sock = address.includes(":")
            ? createConnection({ host: address.split(":")[0], port: Number(address.split(":")[1]) })
            : createConnection({ path: address });
          sock.once("connect", () => { sock.destroy(); resolve(); });
          sock.once("error", reject);
          setTimeout(() => reject(new Error("timeout")), 2000);
        });
        return;
      } catch { await delay(500); }
    }
    throw new Error(`signal-cli daemon did not become ready within ${timeoutMs}ms`);
  }

  async #verifyAccount(account: string): Promise<void> {
    try {
      const accounts = await this.#rpc?.request("listAccounts", {});
      const found = Array.isArray(accounts)
        ? accounts.some((a: unknown) => isRecord(a) && a.account === account)
        : false;
      if (!found) {
        this.#context?.logger.warn(
          `Signal account ${account} not found in signal-cli. Run: signal-cli -a ${account} register`,
        );
      }
    } catch { /* listAccounts may not be supported */ }
  }

  // ─── Message handling ────────────────────────────────────────────────

  async #handleReceive(params: SignalReceiveParams): Promise<void> {
    if (!this.#context) return;

    const envelope = params.envelope;
    const dataMessage = envelope.dataMessage;
    if (!dataMessage || !dataMessage.message?.trim()) return;

    const dedupKey = `${envelope.sourceUuid}:${dataMessage.timestamp}`;
    if (this.#seenTimestamps.has(dedupKey)) return;
    this.#rememberSeenTimestamp(dedupKey);

    if (dataMessage.timestamp < this.#startedAt - 5000) return;

    const content = dataMessage.message.trim();
    const attachments = signalAttachments(dataMessage);
    if (!content && attachments.length === 0) return;

    const isGroup = Boolean(dataMessage.groupInfo);
    const channelId = isGroup && dataMessage.groupInfo
      ? dataMessage.groupInfo.groupId
      : envelope.sourceUuid;
    const channelType = isGroup ? "group" : "dm";

    const senderId = envelope.sourceUuid;
    const authorName = envelope.source ?? senderId.slice(0, 12);

    this.#rememberChannelContext(channelId, {
      id: `${senderId}:${dataMessage.timestamp}`,
      authorId: senderId,
      authorName,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      isBot: senderId === this.#botAccount || envelope.source === this.#botAccount,
      timestamp: dataMessage.timestamp,
    });

    if (senderId === this.#botAccount || envelope.source === this.#botAccount) return;

    const prefix = this.#signalConfig.commandPrefix;
    const mentioned = isGroup
      ? isMentioned(dataMessage, this.#signalConfig.displayName, this.#botAccount)
      : false;
    const isPrefixCommand = prefix ? content.startsWith(prefix) : false;

    if (isGroup && !mentioned && !isPrefixCommand) {
      if (this.#signalConfig.respondToAllMessages) {
        // respond anyway
      } else if (this.#signalConfig.mentionOnly) {
        return;
      }
    }

    let messageContent = content;
    if (isPrefixCommand) {
      messageContent = content.slice(prefix.length).trim();
    } else if (mentioned && isGroup) {
      messageContent = stripMention(content, this.#signalConfig.displayName, this.#botAccount);
    }

    if (await this.#handleLocalCommand(messageContent, channelId, senderId, dataMessage.timestamp, isGroup)) {
      return;
    }

    if (!messageContent && attachments.length === 0) {
      await this.#sendText(channelId, senderId, "What do you need?", isGroup, dataMessage.timestamp);
      return;
    }

    const effContent = messageContent || content;
    const inbound: InboundMessage = {
      id: `${senderId}:${dataMessage.timestamp}`,
      platform: this.name,
      channelId,
      channelType,
      guildId: isGroup && dataMessage.groupInfo ? dataMessage.groupInfo.groupId : undefined,
      authorId: senderId,
      authorName,
      content: effContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      context: this.#getChannelContext(channelId, `${senderId}:${dataMessage.timestamp}`),
      replyTo: await this.#buildReplyReference(dataMessage),
      reply: async (replyContent) => {
        await this.#sendMultiMessageReply(channelId, senderId, dataMessage.timestamp, replyContent, isGroup);
      },
      timestamp: dataMessage.timestamp,
    };

    try {
      await this.#context.handleMessage(inbound);
      await this.#rpc?.notify("sendReceipt", {
        account: this.#botAccount,
        sender: envelope.sourceUuid,
        timestamp: dataMessage.timestamp,
        type: "read",
      });
    } catch (error) {
      this.#context.logger.error("Signal message handling failed", error);
    }
  }

  // ─── Local commands ──────────────────────────────────────────────────

  async #handleLocalCommand(
    content: string, channelId: string, senderId: string,
    timestamp: number, isGroup: boolean,
  ): Promise<boolean> {
    const [command = "", ...args] = content.split(/\s+/);
    const normalized = command.toLowerCase();

    if (normalized === "help" || normalized === "commands") {
      await this.#sendText(channelId, senderId,
        ["Commands:", "DMs: help, status, tools, plugins, session, session new [name], memory, memory all, or any message.",
         "Groups: mention Missy with help, status, tools, plugins, session, memory, or a message."].join("\n"),
        isGroup, timestamp);
      return true;
    }
    if (normalized === "status") { await this.#sendText(channelId, senderId, this.#formatStatus(), isGroup, timestamp); return true; }
    if (normalized === "tools") { await this.#sendText(channelId, senderId, this.#formatTools(), isGroup, timestamp); return true; }
    if (normalized === "plugins") { await this.#sendText(channelId, senderId, this.#formatPlugins(), isGroup, timestamp); return true; }
    if (normalized === "session" || normalized === "sessions") {
      if (args[0]?.toLowerCase() === "new" || args[0]?.toLowerCase() === "start" || args[0]?.toLowerCase() === "clear") {
        const session = await this.#startSession(channelId, args.slice(1).join(" "));
        await this.#sendText(channelId, senderId, `Started session ${session.id}. Earlier context is now ignored.`, isGroup, timestamp);
        return true;
      }
      await this.#sendText(channelId, senderId, this.#formatSession(channelId), isGroup, timestamp);
      return true;
    }
    if (normalized === "memory" || normalized === "mem") {
      await this.#sendText(channelId, senderId, this.#formatMemory(senderId, args[0]?.toLowerCase() === "all"), isGroup, timestamp);
      return true;
    }
    return false;
  }

  // ─── Formatters ──────────────────────────────────────────────────────

  #formatTools(): string {
    if (!this.#context) return "Missy is not ready.";
    const tools = this.#context.tools.list();
    if (tools.length === 0) return "No tools are registered.";
    return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  }
  #formatPlugins(): string {
    if (!this.#context) return "Missy is not ready.";
    if (this.#context.plugins.length === 0) return "No plugins are loaded.";
    return this.#context.plugins.map((p) => `- ${p.name} v${p.version}: ${p.description}`).join("\n");
  }
  #formatMemory(userId: string, includeAll: boolean): string {
    if (!this.#context) return "Missy is not ready.";
    if (!this.#context.config.memory.enabled) return "Memory is disabled.";
    if (includeAll) {
      const all = this.#context.memory.getAllMemory();
      const lines = Object.entries(all).flatMap(([uid, r]) => r.map((rec) => `- ${uid}.${rec.key}: ${rec.value}`));
      return lines.length > 0 ? lines.join("\n") : "No memory stored.";
    }
    const records = this.#context.memory.getUserMemory(userId);
    return records.length > 0 ? records.map((r) => `- ${r.key}: ${r.value}`).join("\n") : "No memory stored for you yet.";
  }
  #formatStatus(): string {
    if (!this.#context) return "Missy is not ready.";
    return [
      "Missy is online.", `Platform: Signal`, `Account: ${this.#botAccount}`,
      `Tools: ${this.#context.tools.list().length}`,
      `Memory: ${this.#context.config.memory.enabled ? "enabled" : "disabled"}`,
      "DMs: enabled", "Group routing: direct mentions only",
      `Reply context: ${this.#signalConfig.includeReplyContext ? "enabled" : "disabled"}`,
      `Channel context: ${this.#signalConfig.includeChannelContext ? "enabled" : "disabled"}`,
      `Reply mode: ${this.#context.config.replyMode}`,
    ].join("\n");
  }
  #formatSession(channelId: string): string {
    const id = this.#sessionIds.get(channelId);
    const startedAt = this.#sessionStartedAt.get(channelId);
    if (!id || !startedAt) return "Current session: default\nContext includes the configured live conversation history.";
    return [`Current session: ${id}`, `Started: ${new Date(startedAt).toISOString()}`, "Context only includes messages after this session started."].join("\n");
  }

  // ─── Reply building ──────────────────────────────────────────────────

  async #buildReplyReference(dataMessage: SignalDataMessage): Promise<InboundMessage["replyTo"]> {
    if (!this.#signalConfig?.includeReplyContext) return undefined;
    const quote = dataMessage.quote;
    if (!quote) return undefined;
    return { id: String(quote.id), authorId: quote.author, content: quote.text ?? "", timestamp: undefined as unknown as number };
  }

  // ─── Sending ─────────────────────────────────────────────────────────

  async #sendMultiMessageReply(channelId: string, senderId: string, timestamp: number, content: string, isGroup: boolean): Promise<void> {
    const delimiter = this.#signalConfig.multiMessageDelimiter;
    const delayMs = this.#signalConfig.multiMessageDelayMs;
    const parts = splitByDelimiter(content, delimiter);
    if (parts.length <= 1) { await this.#sendReply(channelId, senderId, timestamp, content, isGroup); return; }
    await this.#sendReply(channelId, senderId, timestamp, parts[0], isGroup);
    for (const part of parts.slice(1)) { await delay(delayMs); await this.#sendText(channelId, senderId, part, isGroup, timestamp); }
  }

  async #sendReply(channelId: string, senderId: string, timestamp: number, content: string, isGroup: boolean): Promise<void> {
    const chunks = splitMessage(content, this.#signalConfig.maxMessageLength);
    const [first = ""] = chunks;
    await this.#rpc?.request("send", {
      account: this.#botAccount,
      recipient: isGroup ? undefined : senderId,
      groupId: isGroup ? channelId : undefined,
      message: first,
      quote: { id: timestamp, author: senderId },
    });
    for (const chunk of chunks.slice(1)) { await this.#sendText(channelId, senderId, chunk, isGroup, timestamp); }
  }

  async #sendText(channelId: string, senderId: string, content: string, isGroup: boolean, timestamp: number): Promise<void> {
    for (const chunk of splitMessage(content, this.#signalConfig.maxMessageLength)) {
      await this.#rpc?.request("send", {
        account: this.#botAccount,
        recipient: isGroup ? undefined : senderId,
        groupId: isGroup ? channelId : undefined,
        message: chunk,
      });
    }
  }

  // ─── Conversation context ────────────────────────────────────────────

  #rememberChannelContext(channelId: string, message: ConversationMessage): void {
    const limit = Math.max((this.#signalConfig?.channelContextCount ?? 10) * 2, 50);
    const buffer = this.#conversationContext.get(channelId) ?? [];
    buffer.push(message);
    if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
    this.#conversationContext.set(channelId, buffer);
  }
  #getChannelContext(channelId: string, currentMessageId: string): ConversationMessage[] | undefined {
    if (!this.#signalConfig?.includeChannelContext) return undefined;
    const limit = this.#signalConfig.channelContextCount;
    if (limit <= 0) return undefined;
    const buffer = this.#conversationContext.get(channelId) ?? [];
    return buffer.filter((m) => m.id !== currentMessageId && !m.id.startsWith("session-sep-")).slice(-limit);
  }
  #rememberSeenTimestamp(key: string): void {
    this.#seenTimestamps.add(key);
    if (this.#seenTimestamps.size > 5000) this.#seenTimestamps = new Set([...this.#seenTimestamps].slice(-2500));
  }

  // ─── Sessions ────────────────────────────────────────────────────────

  #loadSessions(): void {
    if (!this.#context) return;
    const stored = this.#context.keystore.namespace("signal").get("sessions");
    if (!isRecord(stored)) return;
    for (const [channelId, session] of Object.entries(stored)) {
      if (!isRecord(session)) continue;
      const id = typeof session.id === "string" ? session.id : undefined;
      const startedAt = typeof session.startedAt === "number" ? session.startedAt : undefined;
      if (!id || !startedAt) continue;
      this.#sessionIds.set(channelId, id);
      this.#sessionStartedAt.set(channelId, startedAt);
    }
  }
  async #startSession(channelId: string, requestedName?: string): Promise<{ id: string; startedAt: number }> {
    const startedAt = Date.now();
    const id = normalizeSessionName(requestedName) ?? generateSessionId();
    this.#sessionIds.set(channelId, id);
    this.#sessionStartedAt.set(channelId, startedAt);
    this.#conversationContext.set(channelId, [{ id: `session-sep-${id}`, authorId: "system", authorName: "session", content: "====================", isBot: true }]);
    await this.#saveSessions();
    return { id, startedAt };
  }
  async #saveSessions(): Promise<void> {
    if (!this.#context) return;
    const sessions: Record<string, { id: string; startedAt: number }> = {};
    for (const [channelId, id] of this.#sessionIds) {
      const startedAt = this.#sessionStartedAt.get(channelId);
      if (startedAt) sessions[channelId] = { id, startedAt };
    }
    await this.#context.keystore.namespace("signal").set("sessions", sessions);
  }
}

// ─── Module-level helpers ───────────────────────────────────────────

import { isRecord } from "../../../core/helpers.ts";
import type { MessageAttachment } from "../../../core/types.ts";
import type { SignalAttachment } from "./types.ts";

function resolveUnixSocketPath(): string {
  const xdg = process.env["XDG_RUNTIME_DIR"];
  if (xdg) return `${xdg}/signal-cli/socket`;
  return "/var/run/signal-cli/socket";
}

function isMentioned(dataMessage: SignalDataMessage, displayName: string, botAccount?: string): boolean {
  if (dataMessage.mentions) {
    const names = [displayName, botAccount].filter(Boolean) as string[];
    const mentioned = dataMessage.mentions.some((m) => names.some((n) => n && m.name?.includes(n)));
    if (mentioned) return true;
  }
  const text = dataMessage.message ?? "";
  const patterns = [displayName, botAccount].filter(Boolean) as string[];
  return patterns.some((p) => p && text.toLowerCase().includes(p.toLowerCase()));
}

function stripMention(content: string, displayName: string, botAccount?: string): string {
  let result = content;
  const patterns = [displayName, botAccount].filter(Boolean) as string[];
  for (const pattern of patterns) {
    if (!pattern) continue;
    const idx = result.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx !== -1) result = result.slice(0, idx) + result.slice(idx + pattern.length);
  }
  return result.trim().replace(/^[,:;.!?\s]+/, "").trim();
}

export function signalAttachments(dataMessage: SignalDataMessage): MessageAttachment[] {
  return (dataMessage.attachments ?? []).map((a) => ({
    id: a.id ?? "",
    contentType: a.contentType,
    name: a.filename,
    size: a.size,
    width: a.width,
    height: a.height,
    caption: a.caption,
  }));
}

export function signalAttachmentSummary(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const names = attachments.map((a) => a.name ?? "attachment").join(", ");
  return `[Attachment${attachments.length > 1 ? "s" : ""}: ${names}]`;
}

export function splitMessage(content: string, maxLength = 0): string[] {
  const effectiveMax = maxLength > 0 ? maxLength : 4000;
  const normalized = content.trim();
  if (normalized.length <= effectiveMax) return [normalized || " "];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > effectiveMax) {
    let splitAt = remaining.lastIndexOf("\n", effectiveMax);
    if (splitAt < Math.floor(effectiveMax * 0.5)) splitAt = remaining.lastIndexOf(" ", effectiveMax);
    if (splitAt < 1) splitAt = effectiveMax;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
