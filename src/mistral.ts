import { ConversationMessage } from "./context.ts";
import { callMcpTool, loadMcpTools } from "./mcp.ts";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";
const DISCORD_MESSAGE_LIMIT = 2_000;
const MAX_TOOL_CALL_ROUNDS = 4;

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

export type MistralSendOptions = {
  context?: ConversationMessage[];
  discordHistory?: string;
  enableMcp?: boolean;
};

function getMistralModel(): string {
  return Deno.env.get("MISTRAL_MODEL") ?? DEFAULT_MISTRAL_MODEL;
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

export function fitDiscordMessage(message: string): string {
  if (message.length <= DISCORD_MESSAGE_LIMIT) {
    return message;
  }

  return `${message.slice(0, DISCORD_MESSAGE_LIMIT - 3)}...`;
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

  const response = await fetch(MISTRAL_API_URL, {
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

function buildMessages(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralChatMessage[] {
  const messages: MistralChatMessage[] = [
    {
      role: "system",
      content:
        "You are Missy, a helpful Discord bot powered by Mistral. Reply naturally and keep answers concise unless the user asks for detail. Use provided Discord history only as context for the current request.",
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

export async function sendMistralMessage(
  apiKey: string,
  payload: MistralMessagePayload,
  options: MistralSendOptions = {},
): Promise<string> {
  const messages = buildMessages(payload, options);
  const registry = options.enableMcp === false
    ? { tools: [], entries: new Map() }
    : await loadMcpTools();

  let parsed = await completeChat(apiKey, messages, registry.tools);

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
        toolResult = await callMcpTool(
          registry,
          toolName,
          toolCall.function?.arguments,
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

    parsed = await completeChat(apiKey, messages, registry.tools);
  }

  const reply = extractResponseText(parsed);

  if (!reply) {
    throw new MistralApiError("Mistral API returned an empty response");
  }

  return reply;
}
