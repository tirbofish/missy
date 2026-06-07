import { ConversationMessage } from "./context.ts";
import {
  callFilesystemTool,
  FileOperationApprovalHandler,
  filesystemTools,
  FILESYSTEM_TOOL_NAMES,
} from "./filesystemTools.ts";
import {
  callMcpTool,
  filterMcpToolRegistry,
  loadMcpTools,
  McpToolRegistry,
  MistralToolDefinition,
} from "./mcp.ts";

const MISTRAL_CHAT_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_CONVERSATIONS_API_URL = "https://api.mistral.ai/v1/conversations";
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";
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
  requestFileOperationApproval?: FileOperationApprovalHandler;
};

function getMistralModel(): string {
  return Deno.env.get("MISTRAL_MODEL") ?? DEFAULT_MISTRAL_MODEL;
}

function hasOpenAiApiKey(): boolean {
  return Boolean(Deno.env.get("OPENAI_API_KEY")?.trim());
}

function isPrivateDiscordContext(payload: MistralMessagePayload): boolean {
  return !payload.discord.guildId;
}

function filterMcpToolsForPayload(
  registry: McpToolRegistry,
  payload: MistralMessagePayload,
): McpToolRegistry {
  const privateContext = isPrivateDiscordContext(payload);

  return filterMcpToolRegistry(registry, (functionName, entry) => {
    if (entry.toolName === "computer_task") {
      return privateContext && hasOpenAiApiKey();
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
      return privateContext;
    }

    return true;
  });
}

function getBuiltinToolsForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralToolDefinition[] {
  if (!isPrivateDiscordContext(payload)) {
    return [];
  }

  return filesystemTools;
}

function isFilesystemTool(toolName: string): boolean {
  return Object.values(FILESYSTEM_TOOL_NAMES).includes(
    toolName as typeof FILESYSTEM_TOOL_NAMES[keyof typeof FILESYSTEM_TOOL_NAMES],
  );
}

async function callAvailableTool(
  registry: McpToolRegistry,
  toolName: string,
  rawArguments: unknown,
  options: MistralSendOptions,
): Promise<string> {
  if (isFilesystemTool(toolName)) {
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

export function splitDiscordMessages(message: string): string[] {
  const requestedMessages = message
    .split(new RegExp(`^\\s*${DISCORD_MESSAGE_BREAK}\\s*$`, "gim"))
    .map((part) => part.trim())
    .filter(Boolean);
  const messages = requestedMessages.length > 0 ? requestedMessages : [message];

  return messages.flatMap(splitLongDiscordMessage);
}

async function completeChat(
  apiKey: string,
  messages: MistralChatMessage[],
  tools?: unknown[],
): Promise<MistralChatResponse> {
  const body: Record<string, unknown> = {
    model: getMistralModel(),
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

function buildMessages(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralChatMessage[] {
  const localAccessInstruction = isPrivateDiscordContext(payload)
    ? "In DMs, you may use available filesystem tools to stat, list, read, copy, create folders, write text files, move, rename, overwrite, or delete local paths. Move, overwrite, and delete tools ask the user for explicit approval before changing existing filesystem content."
    : "In guild/server contexts, never access local Desktop or computer files and never modify local filesystem paths. Tell the user to DM Missy for local filesystem access.";
  const messages: MistralChatMessage[] = [
    {
      role: "system",
      content:
        `You are Missy, a helpful Discord bot powered by Mistral. Reply naturally and keep answers concise unless the user asks for detail. Use provided Discord history only as context for the current request. If the response is clearer as multiple Discord messages, put a line containing only ${DISCORD_MESSAGE_BREAK} between messages. To react to the triggering Discord message, include a line like MISSY_REACT: 👍. To intentionally send no text reply, include a line containing only MISSY_NO_REPLY. ${localAccessInstruction}`,
    },
  ];

  if (options.discordHistory) {
    messages.push({
      role: "system",
      content: options.discordHistory,
    });
  }

  for (const message of options.context ?? []) {
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
  const localAccessInstruction = isPrivateDiscordContext(payload)
    ? "In DMs, you may use filesystem tools to stat, list, read, copy, create folders, write text files, move, rename, overwrite, or delete local paths. Deletion is only available through the permission prompt; move and overwrite also require approval."
    : "In guild/server contexts, never access local Desktop or computer files and never modify local filesystem paths. Tell the user to DM Missy for local filesystem access.";
  const instructions = [
    `You are Missy, a helpful Discord bot powered by Mistral. Reply naturally and keep answers concise unless the user asks for detail. If the response is clearer as multiple Discord messages, put a line containing only ${DISCORD_MESSAGE_BREAK} between messages.`,
    "To react to the triggering Discord message, include a line like MISSY_REACT: 👍. To intentionally send no text reply, include a line containing only MISSY_NO_REPLY.",
    "You have access to web_search for up-to-date information. Use it when the user asks about current events, recent facts, live information, or a specific webpage.",
    isPrivateDiscordContext(payload)
      ? "If the user asks about local files, use filesystem tools when helpful. Deletion is only available through the permission prompt, and move/overwrite also require approval."
      : "Do not move, rename, delete, read, write, copy, create, or list local filesystem paths in guild/server contexts.",
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
    ...(options.context ?? []).map((message) => ({
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

function extractConversationOutputText(output: MistralConversationOutput): string {
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

function extractConversationText(response: MistralConversationResponse): string {
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
    model: getMistralModel(),
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

  let parsed = await completeChat(apiKey, messages, tools);

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

    parsed = await completeChat(apiKey, messages, tools);
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
  const registry = options.enableMcp === false
    ? { tools: [], entries: new Map() }
    : filterMcpToolsForPayload(await loadMcpTools(), payload);

  if (websearchEnabled()) {
    return await sendMistralConversationMessage(
      apiKey,
      payload,
      registry,
      options,
    );
  }

  return await sendMistralChatMessage(apiKey, payload, registry, options);
}
