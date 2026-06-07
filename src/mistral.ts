import { ConversationMessage } from "./context.ts";
import {
  callFilesystemTool,
  FileOperationApprovalHandler,
  FILESYSTEM_TOOL_NAMES,
  filesystemTools,
} from "./filesystemTools.ts";
import {
  callMcpTool,
  filterMcpToolRegistry,
  loadMcpTools,
  McpToolRegistry,
  MistralToolDefinition,
} from "./mcp.ts";
import {
  canAccessLocalComputer,
  LOCAL_ACCESS_REQUIRED_MESSAGE,
} from "./localAccess.ts";
import { defaultMistralModel } from "./models.ts";

const MISTRAL_CHAT_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_CONVERSATIONS_API_URL = "https://api.mistral.ai/v1/conversations";
const DISCORD_MESSAGE_LIMIT = 2_000;
const DISCORD_MESSAGE_BREAK = "MISSY_MESSAGE_BREAK";
const MAX_TOOL_CALL_ROUNDS = 4;
const MAX_CONVERSATION_TOOL_ROUNDS = 4;

export class MistralApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "MistralApiError";
  }
}

export type MistralMessagePayload = {
  message: string;
  source: "discord-dm" | "discord-server" | "discord-slash";
  discord: {
    userId: string;
    username: string;
    channelId?: string;
    guildId?: string;
    roleIds?: readonly string[];
  };
};

type MistralContentBlock = {
  type?: string;
  text?: string;
};

type MistralChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | MistralContentBlock[] | null;
      tool_calls?: MistralToolCall[];
    };
  }>;
  error?: {
    message?: string;
  };
};

type MistralToolCall = {
  id: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

type MistralChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: MistralToolCall[];
};

type MistralConversationInput = {
  role: "user" | "assistant";
  content: string;
};

type MistralReferenceBlock = {
  type?: string;
  text?: string;
  title?: string;
  url?: string;
  source?: string;
  tool?: string;
};

type MistralConversationOutput = {
  type?: string;
  content?: string | MistralReferenceBlock[] | null;
  name?: string;
  arguments?: string | Record<string, unknown>;
  tool_call_id?: string;
  toolCallId?: string;
};

type MistralConversationResponse = {
  conversation_id?: string;
  conversationId?: string;
  outputs?: MistralConversationOutput[];
  error?: {
    message?: string;
  };
};

export type MistralSendOptions = {
  context?: ConversationMessage[];
  discordHistory?: string;
  enableMcp?: boolean;
  model?: string;
  personalityInstruction?: string;
  requestFileOperationApproval?: FileOperationApprovalHandler;
};

function getMistralModel(options: MistralSendOptions): string {
  return options.model ?? defaultMistralModel();
}

function hasOpenAiApiKey(): boolean {
  return Boolean(Deno.env.get("OPENAI_API_KEY")?.trim());
}

function hasLocalAccess(payload: MistralMessagePayload): boolean {
  return canAccessLocalComputer({
    roleIds: payload.discord.roleIds,
    userId: payload.discord.userId,
  });
}

function localAccessContextLabel(payload: MistralMessagePayload): string {
  return payload.discord.guildId
    ? "a Discord server/guild channel"
    : "a Discord DM";
}

function hasCurrentLocalFilesystemIntent(
  payload: MistralMessagePayload,
): boolean {
  const message = payload.message.trim().toLowerCase();

  if (!message) {
    return false;
  }

  if (/[a-z]:[\\/]|\\\\[a-z0-9._$-]+[\\/]/i.test(payload.message)) {
    return true;
  }

  if (/\b(cd|dir|ls|pwd)\b/.test(message)) {
    return true;
  }

  const localSubject =
    /\b(desktop|downloads?|documents?|filesystem|file system|local|drives?|directories|directory|folders?|files?|paths?|repo|repository)\b/
      .test(message);
  const localAction =
    /\b(access|browse|cat|check|copy|create|delete|find|inspect|list|locate|mkdir|move|open|read|remove|rename|show|stat|tree|write|overwrite)\b/
      .test(message);

  return localSubject && localAction;
}

function isStaleLocalAccessDenial(message: ConversationMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  return /dm\s+(me|missy)|dm\s+directly|only\s+access.+dm|message\s+me\s+in\s+a\s+dm|only\s+access.+desktop|desktop.+not\s+the\s+d:|only\s+access\s+your\s+desktop/i
    .test(message.content);
}

function isLocalFilesystemContext(message: ConversationMessage): boolean {
  return /[a-z]:[\\/]|desktop files?|filesystem|local (computer|files?|folders?|paths?)|d:\/|d:\\|d drive|directory|folders? in|files? in/i
    .test(message.content);
}

function contextForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): ConversationMessage[] {
  const context = options.context ?? [];

  if (!hasLocalAccess(payload)) {
    return context;
  }

  if (!hasCurrentLocalFilesystemIntent(payload)) {
    return context.filter((message) => !isLocalFilesystemContext(message));
  }

  return context.filter((message) => !isStaleLocalAccessDenial(message));
}

function filterMcpToolsForPayload(
  registry: McpToolRegistry,
  payload: MistralMessagePayload,
): McpToolRegistry {
  const localAccess = hasLocalAccess(payload);
  const localFilesystemIntent = hasCurrentLocalFilesystemIntent(payload);

  return filterMcpToolRegistry(registry, (functionName, entry) => {
    if (entry.toolName === "computer_task") {
      return localAccess && localFilesystemIntent && hasOpenAiApiKey();
    }

    if (
      entry.toolName === "google_query"
    ) {
      return hasOpenAiApiKey();
    }

    if (
      entry.toolName === "desktop_list" ||
      entry.toolName === "desktop_read"
    ) {
      return false;
    }

    return true;
  });
}

function getBuiltinToolsForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralToolDefinition[] {
  if (!hasLocalAccess(payload) || !hasCurrentLocalFilesystemIntent(payload)) {
    return [];
  }

  return filesystemTools;
}

function isFilesystemTool(toolName: string): boolean {
  return Object.values(FILESYSTEM_TOOL_NAMES).includes(
    toolName as typeof FILESYSTEM_TOOL_NAMES[
      keyof typeof FILESYSTEM_TOOL_NAMES
    ],
  );
}

async function callAvailableTool(
  registry: McpToolRegistry,
  toolName: string,
  rawArguments: unknown,
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): Promise<string> {
  if (isFilesystemTool(toolName)) {
    if (!hasLocalAccess(payload)) {
      throw new Error(LOCAL_ACCESS_REQUIRED_MESSAGE);
    }

    if (!hasCurrentLocalFilesystemIntent(payload)) {
      throw new Error(
        "Filesystem tools are available only when the current Discord message explicitly asks to inspect or modify local files.",
      );
    }

    return await callFilesystemTool(
      toolName,
      rawArguments,
      options.requestFileOperationApproval,
    );
  }

  return await callMcpTool(registry, toolName, rawArguments);
}

function websearchEnabled(): boolean {
  return (Deno.env.get("MISTRAL_ENABLE_WEBSEARCH") ?? "1") !== "0";
}

function conversationStoreEnabled(): boolean {
  return Deno.env.get("MISTRAL_KEEP_CONVERSATIONS") === "1";
}

function websearchToolType(): "web_search" | "web_search_premium" {
  return Deno.env.get("MISTRAL_WEBSEARCH_TOOL") === "web_search_premium"
    ? "web_search_premium"
    : "web_search";
}

function extractResponseText(response: MistralChatResponse): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => block.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim();
  }

  return "";
}

function splitLongDiscordMessage(message: string): string[] {
  const chunks: string[] = [];
  let remaining = message.trim();

  while (remaining.length > DISCORD_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, DISCORD_MESSAGE_LIMIT);
    const newlineBreak = slice.lastIndexOf("\n");
    const spaceBreak = slice.lastIndexOf(" ");
    const breakIndex = Math.max(newlineBreak, spaceBreak);
    const endIndex = breakIndex > DISCORD_MESSAGE_LIMIT / 4
      ? breakIndex
      : DISCORD_MESSAGE_LIMIT;

    chunks.push(remaining.slice(0, endIndex).trimEnd());
    remaining = remaining.slice(endIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function shouldAutoSplitShortLines(message: string): boolean {
  if (
    message.includes("```") ||
    /https?:\/\//i.test(message) ||
    /^\s*(sources?:|[-*]\s|\d+\.\s|>|#{1,6}\s|\|)/im.test(message)
  ) {
    return false;
  }

  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2 || lines.length > 5) {
    return false;
  }

  return lines.every((line) => line.length <= 120);
}

function splitRequestedDiscordMessages(message: string): string[] {
  const explicitMessages = message
    .split(
      new RegExp(`\\s*(?:${DISCORD_MESSAGE_BREAK}|^\\s*---\\s*$)\\s*`, "gim"),
    )
    .map((part) => part.trim())
    .filter(Boolean);

  if (explicitMessages.length > 1) {
    return explicitMessages;
  }

  if (shouldAutoSplitShortLines(message)) {
    return message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [message.trim()].filter(Boolean);
}

export function splitDiscordMessages(message: string): string[] {
  return splitRequestedDiscordMessages(message).flatMap(
    splitLongDiscordMessage,
  );
}

async function completeChat(
  apiKey: string,
  messages: MistralChatMessage[],
  options: MistralSendOptions,
  tools?: unknown[],
): Promise<MistralChatResponse> {
  const body: Record<string, unknown> = {
    model: getMistralModel(options),
    messages,
  };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(MISTRAL_CHAT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new MistralApiError(
      `Mistral API returned HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }

  return JSON.parse(responseBody) as MistralChatResponse;
}

async function postMistralConversation(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<MistralConversationResponse> {
  const response = await fetch(`${MISTRAL_CONVERSATIONS_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new MistralApiError(
      `Mistral Conversations API returned HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }

  return JSON.parse(responseBody) as MistralConversationResponse;
}

async function deleteMistralConversation(
  apiKey: string,
  conversationId: string,
): Promise<void> {
  try {
    await fetch(
      `${MISTRAL_CONVERSATIONS_API_URL}/${encodeURIComponent(conversationId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
  } catch (error) {
    console.error("Could not delete Mistral conversation", error);
  }
}

async function loadPersonalityInstruction(): Promise<string> {
  try {
    const content = await Deno.readTextFile(
      new URL("../PERSONALITY.md", import.meta.url),
    );
    return [
      content.trim(),
      "You are not Poke and should not claim to be developed by Interaction.",
      `When splitting messages, use the exact separator ${DISCORD_MESSAGE_BREAK} on its own line.`,
    ].join("\n\n");
  } catch (error) {
    console.error("Could not read PERSONALITY.md", error);
    return [
      "You are Missy, a helpful Discord bot powered by Mistral.",
      "Sound like a warm, concise friend in a group chat rather than a traditional chatbot.",
      "When asked which option is better, pick a side after briefly weighing the tradeoffs. If the prompt is potentially unsafe, do not choose between harmful options; redirect toward a safer next step.",
      `Use ${DISCORD_MESSAGE_BREAK} on its own line to split natural multi-message replies.`,
    ].join("\n");
  }
}

function buildMessages(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralChatMessage[] {
  const localFilesystemIntent = hasCurrentLocalFilesystemIntent(payload);
  const localAccessInstruction =
    hasLocalAccess(payload) && localFilesystemIntent
      ? `Discord user ${payload.discord.userId} is listed in MISSY_LOCAL_ACCESS_USER_IDS and is allowed to access local Desktop, computer, and filesystem tools from ${
        localAccessContextLabel(payload)
      }, either directly by user ID or through a role in MISSY_LOCAL_ACCESS_ROLE_IDS. Local filesystem access is not limited to the Desktop; use absolute Windows paths such as D:\\ when the user asks for them. Do not tell this user to DM for local access; server access is allowed for this actor. Use available filesystem tools when helpful. For compound local tasks such as locating files and moving them to a folder, run the relevant filesystem tool or Deno REPL tool instead of merely describing commands. The Deno REPL starts without local permissions; when it requests read/write/run/net/env/etc. access, that exact permission is sent to the user for check/cross approval before the code is rerun with the approved scoped permission.`
      : hasLocalAccess(payload)
      ? "Local filesystem tools are disabled for this request because the current Discord message does not explicitly ask to inspect or modify local files. Do not infer a local file request from older conversation context."
      : `${LOCAL_ACCESS_REQUIRED_MESSAGE} Never access local Desktop or computer files and never modify local filesystem paths for this user.`;
  const messages: MistralChatMessage[] = [
    {
      role: "system",
      content:
        `${options.personalityInstruction} Use provided Discord history only as context for the current request. ${localAccessInstruction}`,
    },
  ];

  if (options.discordHistory) {
    messages.push({
      role: "system",
      content: options.discordHistory,
    });
  }

  for (const message of contextForPayload(payload, options)) {
    messages.push(message);
  }

  messages.push({
    role: "user",
    content: payload.message,
  });

  return messages;
}

function buildInstructions(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): string {
  const localFilesystemIntent = hasCurrentLocalFilesystemIntent(payload);
  const localAccessInstruction =
    hasLocalAccess(payload) && localFilesystemIntent
      ? `Discord user ${payload.discord.userId} is listed in MISSY_LOCAL_ACCESS_USER_IDS and is allowed to access local Desktop, computer, and filesystem tools from ${
        localAccessContextLabel(payload)
      }, either directly by user ID or through a role in MISSY_LOCAL_ACCESS_ROLE_IDS. Local filesystem access is not limited to the Desktop; use absolute Windows paths such as D:\\ when the user asks for them. Do not tell this user to DM for local access; server access is allowed for this actor. If the user asks about local files, use filesystem tools when helpful. For compound local tasks such as locating files and moving them to a folder, run the relevant filesystem tool or Deno REPL tool instead of merely describing commands. The Deno REPL starts without local permissions; when it requests read/write/run/net/env/etc. access, that exact permission is sent to the user for check/cross approval before the code is rerun with the approved scoped permission.`
      : hasLocalAccess(payload)
      ? "Local filesystem tools are disabled for this request because the current Discord message does not explicitly ask to inspect or modify local files. Do not infer a local file request from older conversation context."
      : `${LOCAL_ACCESS_REQUIRED_MESSAGE} Never move, rename, delete, read, write, copy, create, or list local filesystem paths for this user.`;
  const instructions = [
    options.personalityInstruction ??
      "You are Missy, a helpful Discord bot powered by Mistral.",
    "You have access to web_search for up-to-date information. Use it when the user asks about current events, recent facts, live information, or a specific webpage.",
    localAccessInstruction,
  ];

  if (options.discordHistory) {
    instructions.push(
      `Use this Discord history only as context for the current request:\n${options.discordHistory}`,
    );
  }

  return instructions.join("\n\n");
}

function buildConversationInputs(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralConversationInput[] {
  return [
    ...contextForPayload(payload, options).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user" as const,
      content: payload.message,
    },
  ];
}

function referenceLabel(reference: MistralReferenceBlock): string | undefined {
  if (reference.title && reference.url) {
    return `- [${reference.title}](${reference.url})`;
  }

  if (reference.url) {
    return `- ${reference.url}`;
  }

  if (reference.title) {
    return `- ${reference.title}`;
  }

  return undefined;
}

function extractConversationOutputText(
  output: MistralConversationOutput,
): string {
  const content = output.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const text = content
    .filter((block) => block.type !== "tool_reference")
    .map((block) => block.text)
    .filter((value): value is string => Boolean(value))
    .join("")
    .trim();
  const references = content
    .filter((block) => block.type === "tool_reference")
    .map(referenceLabel)
    .filter((value): value is string => Boolean(value));
  const uniqueReferences = [...new Set(references)];

  if (uniqueReferences.length === 0) {
    return text;
  }

  return `${text}\n\nSources:\n${uniqueReferences.join("\n")}`.trim();
}

function extractConversationText(
  response: MistralConversationResponse,
): string {
  const messages = (response.outputs ?? [])
    .filter((output) => output.type === "message.output")
    .map(extractConversationOutputText)
    .filter(Boolean);

  return messages.at(-1)?.trim() ?? "";
}

function getConversationId(response: MistralConversationResponse): string {
  const conversationId = response.conversation_id ?? response.conversationId;

  if (!conversationId) {
    throw new MistralApiError(
      "Mistral Conversations API did not return a conversation ID",
    );
  }

  return conversationId;
}

function getConversationFunctionCalls(
  response: MistralConversationResponse,
): MistralConversationOutput[] {
  return (response.outputs ?? []).filter((output) =>
    output.type === "function.call"
  );
}

async function sendMistralConversationMessage(
  apiKey: string,
  payload: MistralMessagePayload,
  registry: Awaited<ReturnType<typeof loadMcpTools>>,
  options: MistralSendOptions,
): Promise<string> {
  const builtinTools = getBuiltinToolsForPayload(payload, options);
  const tools = [
    { type: websearchToolType() },
    ...builtinTools,
    ...registry.tools,
  ];
  let parsed = await postMistralConversation(apiKey, "", {
    completion_args: {
      temperature: 0.3,
      top_p: 0.95,
    },
    inputs: buildConversationInputs(payload, options),
    instructions: buildInstructions(payload, options),
    model: getMistralModel(options),
    store: true,
    stream: false,
    tools,
  });
  let conversationId = getConversationId(parsed);
  const conversationIds = new Set([conversationId]);

  try {
    for (let round = 0; round < MAX_CONVERSATION_TOOL_ROUNDS; round++) {
      const functionCalls = getConversationFunctionCalls(parsed);

      if (functionCalls.length === 0) {
        break;
      }

      const functionResults = [];

      for (const functionCall of functionCalls) {
        const toolName = functionCall.name;
        const toolCallId = functionCall.tool_call_id ??
          functionCall.toolCallId;

        if (!toolName || !toolCallId) {
          continue;
        }

        let result: string;

        try {
          result = await callAvailableTool(
            registry,
            toolName,
            functionCall.arguments,
            payload,
            options,
          );
        } catch (error) {
          result = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }

        functionResults.push({
          object: "entry",
          result,
          tool_call_id: toolCallId,
          type: "function.result",
        });
      }

      if (functionResults.length === 0) {
        break;
      }

      parsed = await postMistralConversation(
        apiKey,
        `/${encodeURIComponent(conversationId)}`,
        {
          inputs: functionResults,
          store: true,
          stream: false,
        },
      );
      conversationId = getConversationId(parsed);
      conversationIds.add(conversationId);
    }

    const reply = extractConversationText(parsed);

    if (!reply) {
      throw new MistralApiError(
        "Mistral Conversations API returned an empty response",
      );
    }

    return reply;
  } finally {
    if (!conversationStoreEnabled()) {
      for (const storedConversationId of conversationIds) {
        await deleteMistralConversation(apiKey, storedConversationId);
      }
    }
  }
}

async function sendMistralChatMessage(
  apiKey: string,
  payload: MistralMessagePayload,
  registry: Awaited<ReturnType<typeof loadMcpTools>>,
  options: MistralSendOptions,
): Promise<string> {
  const messages = buildMessages(payload, options);
  const builtinTools = getBuiltinToolsForPayload(payload, options);
  const tools = [
    ...builtinTools,
    ...registry.tools,
  ];

  let parsed = await completeChat(apiKey, messages, options, tools);

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const assistantMessage = parsed.choices?.[0]?.message;
    const toolCalls = assistantMessage?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: typeof assistantMessage?.content === "string"
        ? assistantMessage.content
        : "",
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;

      if (!toolName) {
        continue;
      }

      let toolResult: string;

      try {
        toolResult = await callAvailableTool(
          registry,
          toolName,
          toolCall.function?.arguments,
          payload,
          options,
        );
      } catch (error) {
        toolResult = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }

      messages.push({
        role: "tool",
        name: toolName,
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    parsed = await completeChat(apiKey, messages, options, tools);
  }

  const reply = extractResponseText(parsed);

  if (!reply) {
    throw new MistralApiError("Mistral API returned an empty response");
  }

  return reply;
}

export async function sendMistralMessage(
  apiKey: string,
  payload: MistralMessagePayload,
  options: MistralSendOptions = {},
): Promise<string> {
  const sendOptions: MistralSendOptions = {
    ...options,
    personalityInstruction: options.personalityInstruction ??
      await loadPersonalityInstruction(),
  };
  const registry = options.enableMcp === false
    ? { tools: [], entries: new Map() }
    : filterMcpToolsForPayload(await loadMcpTools(), payload);

  if (websearchEnabled()) {
    return await sendMistralConversationMessage(
      apiKey,
      payload,
      registry,
      sendOptions,
    );
  }

  return await sendMistralChatMessage(apiKey, payload, registry, sendOptions);
}
