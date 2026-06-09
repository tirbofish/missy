import type {
  AgentTool,
  ConversationMessage,
  InboundMessage,
  MemoryUpdate,
  ToolResult,
} from "./types.ts";
import type { AgentOutput } from "./types.ts";

export interface AgentOutputParseResult {
  ok: boolean;
  output?: AgentOutput;
  error?: string;
}

export function buildSystemInstructions(options: {
  personalityXml: string;
  tools: AgentTool[];
}): string {
  return [
    "<system>",
    "<role>You are an AI agent that can help the user and call registered tools.</role>",
    "<personality>",
    options.personalityXml,
    "</personality>",
    "<memory_policy>",
    "Use provided user memory when it is relevant.",
    "When the user states stable personal facts or preferences, emit memory updates.",
    "Examples of useful memory: location, timezone, name, preferences, recurring constraints.",
    "Do not store sensitive secrets, credentials, payment details, or one-time facts.",
    "</memory_policy>",
    "<output_contract>",
    "Always respond with valid XML using this shape:",
    '<agent><respond>true</respond><message>Text for the user.</message><memory_updates><memory key="location">Sydney</memory></memory_updates><tool_calls><tool_call name="tool.name"><input>{"json":"value"}</input></tool_call></tool_calls></agent>',
    "Set <respond>false</respond> only when the message clearly was not directed at you. If you were pinged, replied to, or prefix-commanded, always respond.",
    "If no tools are needed, return an empty <tool_calls></tool_calls> element.",
    "If no memory updates are needed, return an empty <memory_updates></memory_updates> element.",
    "Use JSON inside each <input> element.",
    "IMPORTANT: If you are calling tools, leave <message> EMPTY. Do not guess or pre-fill an answer. You will see the tool results and respond in a follow-up turn.",
    "</output_contract>",
    "<available_tools>",
    ...options.tools.map(formatToolXml),
    "</available_tools>",
    "<tool_usage_policy>",
    "When a question involves current events, live scores, recent news, prices, stats, weather, or any time-sensitive fact, ALWAYS call web.context (or web.search if web.context is unavailable) before answering. Never guess or invent current data.",
    "</tool_usage_policy>",
    "</system>",
  ].join("\n");
}

export function buildConversationInput(
  message: InboundMessage,
  memory: MemoryUpdate[] = [],
): string {
  return [
    "<incoming_message>",
    `<platform>${escapeXml(message.platform)}</platform>`,
    `<channel_id>${escapeXml(message.channelId)}</channel_id>`,
    message.guildId ? `<guild_id>${escapeXml(message.guildId)}</guild_id>` : "",
    `<author id="${escapeXml(message.authorId)}">${
      escapeXml(message.authorName ?? message.authorId)
    }</author>`,
    `<content>${escapeXml(message.content)}</content>`,
    message.replyTo ? formatReplyReferenceXml(message.replyTo) : "",
    message.context?.length ? formatConversationContextXml(message.context) : "",
    formatMemoryXml(memory),
    "</incoming_message>",
  ].join("\n");
}

export function buildFinalInput(options: {
  message: InboundMessage;
  memory: MemoryUpdate[];
  previousAssistantXml: string;
  toolResultsXml: string;
}): string {
  return [
    "<tool_result_turn>",
    buildConversationInput(options.message, options.memory),
    "<previous_assistant_output>",
    options.previousAssistantXml,
    "</previous_assistant_output>",
    options.toolResultsXml,
    "<instruction>Answer the user based ONLY on the tool results below. Ignore any message in your previous output — it was a placeholder before results arrived. Do not repeat a previous guess. Derive your answer from the actual tool data.</instruction>",
    "</tool_result_turn>",
  ].join("\n");
}

export function parseAgentOutputXml(xml: string): AgentOutput {
  const root = extractAgentRoot(xml);
  if (!root) {
    throw new Error("AI XML output must contain an <agent> root element.");
  }

  const message = decodeXml(matchTag(root, "message") ?? "").trim();
  const memoryUpdates = parseMemoryUpdates(root);
  const respond = parseRespond(root);
  const toolCalls = [
    ...root.matchAll(/<tool_call\s+([^>]*)>([\s\S]*?)<\/tool_call>/g),
  ]
    .map((match) => {
      const attributes = match[1];
      const body = match[2];
      const name = matchAttribute(attributes, "name")?.trim();
      if (!name) {
        throw new Error("Every <tool_call> must include a name attribute.");
      }

      const inputText = decodeXml(matchTag(body, "input") ?? "{}").trim();
      return {
        name,
        input: parseJsonInput(inputText),
      };
    });

  return { message, memoryUpdates, respond, toolCalls };
}

export function tryParseAgentOutputXml(xml: string): AgentOutputParseResult {
  try {
    return { ok: true, output: parseAgentOutputXml(xml) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function fallbackAgentOutput(raw: string): AgentOutput {
  return {
    message: stripCodeFence(raw).trim() ||
      "i got tangled in my own output format",
    memoryUpdates: [],
    respond: true,
    toolCalls: [],
  };
}

export function formatAgentOutputXml(output: AgentOutput): string {
  return [
    "<agent>",
    `<respond>${output.respond}</respond>`,
    `<message>${escapeXml(output.message)}</message>`,
    "<memory_updates>",
    ...output.memoryUpdates.map((update) =>
      `<memory key="${escapeXml(update.key)}">${
        escapeXml(update.value)
      }</memory>`
    ),
    "</memory_updates>",
    "<tool_calls>",
    ...output.toolCalls.map((call) =>
      `<tool_call name="${escapeXml(call.name)}"><input>${
        escapeXml(JSON.stringify(call.input ?? {}))
      }</input></tool_call>`
    ),
    "</tool_calls>",
    "</agent>",
  ].join("");
}

export function formatToolResultsXml(results: ToolResult[]): string {
  return [
    "<tool_results>",
    ...results.map((result) =>
      [
        `<tool_result name="${escapeXml(result.name)}" ok="${result.ok}">`,
        `<output>${escapeXml(JSON.stringify(result.output))}</output>`,
        "</tool_result>",
      ].join("")
    ),
    "</tool_results>",
  ].join("\n");
}

function formatToolXml(tool: AgentTool): string {
  return [
    `<tool name="${escapeXml(tool.name)}">`,
    `<description>${escapeXml(tool.description)}</description>`,
    `<input_schema>${
      escapeXml(JSON.stringify(tool.inputSchema ?? {}))
    }</input_schema>`,
    "</tool>",
  ].join("");
}

function parseJsonInput(inputText: string): unknown {
  if (inputText === "") {
    return {};
  }

  try {
    return JSON.parse(inputText);
  } catch {
    return { text: inputText };
  }
}

function parseMemoryUpdates(root: string): MemoryUpdate[] {
  const memoryUpdatesRoot = matchTag(root, "memory_updates") ?? "";
  return [
    ...memoryUpdatesRoot.matchAll(/<memory\s+([^>]*)>([\s\S]*?)<\/memory>/g),
  ].map((match) => {
    const key = matchAttribute(match[1], "key")?.trim() ?? "";
    const value = decodeXml(match[2]).trim();
    return { key, value };
  }).filter((update) => update.key !== "" && update.value !== "");
}

function extractAgentRoot(xml: string): string | undefined {
  return matchTag(stripCodeFence(xml), "agent");
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:xml)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function parseRespond(root: string): boolean {
  const value = decodeXml(matchTag(root, "respond") ?? "true").trim()
    .toLowerCase();
  return !["false", "0", "no"].includes(value);
}

function formatMemoryXml(memory: MemoryUpdate[]): string {
  return [
    "<user_memory>",
    ...memory.map((record) =>
      `<memory key="${escapeXml(record.key)}">${
        escapeXml(record.value)
      }</memory>`
    ),
    "</user_memory>",
  ].join("\n");
}

function formatReplyReferenceXml(replyTo: {
  id: string;
  authorId: string;
  authorName?: string;
  content: string;
}): string {
  return [
    "<reply_to>",
    `<message_id>${escapeXml(replyTo.id)}</message_id>`,
    `<author id="${escapeXml(replyTo.authorId)}">${
      escapeXml(replyTo.authorName ?? replyTo.authorId)
    }</author>`,
    `<content>${escapeXml(replyTo.content)}</content>`,
    "</reply_to>",
  ].join("\n");
}

function formatConversationContextXml(context: ConversationMessage[]): string {
  return [
    "<conversation_context>",
    ...context.map((msg) =>
      `<message author="${escapeXml(msg.authorName ?? msg.authorId)}"${msg.isBot ? ' role="assistant"' : ""}>${escapeXml(msg.content)}</message>`
    ),
    "</conversation_context>",
  ].join("\n");
}

function matchTag(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`)
    .exec(xml);
  return match?.[1];
}

function matchAttribute(
  attributes: string,
  attributeName: string,
): string | undefined {
  const doubleQuoted = new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`).exec(
    attributes,
  );
  if (doubleQuoted) {
    return decodeXml(doubleQuoted[1]);
  }

  const singleQuoted = new RegExp(`${attributeName}\\s*=\\s*'([^']*)'`).exec(
    attributes,
  );
  return singleQuoted ? decodeXml(singleQuoted[1]) : undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}
