import type {
  AgentTool,
  ConversationMessage,
  InboundMessage,
  InboundMessageReference,
  MessageAttachment,
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
  platformContext?: string;
}): string {
  const platformSection = options.platformContext
    ? [
      "<platform_context>",
      options.platformContext,
      "</platform_context>",
    ].join("\n")
    : "";

  return [
    "<system>",
    "<role>You are an AI agent that can help the user and call registered tools.</role>",
    platformSection,
    "<personality>",
    options.personalityXml,
    "</personality>",
    "<memory_policy>",
    "Use provided user memory when it is relevant.",
    "When the user states stable personal facts or preferences, emit memory updates.",
    "Examples of useful memory: location, timezone, name, preferences, recurring constraints.",
    "Do not store sensitive secrets, credentials, payment details, or one-time facts.",
    "IMPORTANT: When you emit memory updates, acknowledge it conversationally. If your response includes a tool result, save the memory update and tell the user what you saved. Example: *I've saved your location as Sydney.* or *Noted — I'll remember that you prefer metric units.*",
    "</memory_policy>",
    "<output_contract>",
    "Always respond with valid XML using this shape:",
    '<agent><respond>true</respond><message>Text for the user.</message><memory_updates><memory key="location">Sydney</memory></memory_updates><tool_calls><tool_call name="tool.name"><input>{"json":"value"}</input></tool_call></tool_calls></agent>',
    "Set <respond>false</respond> only when the message clearly was not directed at you. If you were pinged, replied to, or prefix-commanded, always respond.",
    "If no tools are needed, return an empty <tool_calls></tool_calls> element.",
    "If no memory updates are needed, return an empty <memory_updates></memory_updates> element.",
    "Use JSON inside each <input> element.",
    "</output_contract>",
    "<tool_call_policy>",
    "IMPORTANT: If you need to call tools, split your response into separate <message> elements:",
    "  1. First message: A brief conversational heads-up that you're looking something up. Example: Let me check that for you... or One moment, I'll look that up.",
    "  2. Do NOT guess or pre-fill the answer — leave the actual result for the follow-up turn.",
    "  Example: <agent><respond>true</respond><message>Hmm, let me look into that...</message><message>One moment!</message><tool_calls><tool_call name=\"web.search\"><input>{\"query\":\"weather Sydney\"}</input></tool_call></tool_calls><memory_updates></memory_updates></agent>",
    "After you receive tool results, respond with the actual answer using multiple <message> elements for natural flow.",
    "</tool_call_policy>",
    "<multi_message>",
    "Break long responses into multiple <message> elements. Each becomes a separate chat bubble with a short delay. Use this liberally:",
    "  - Separate a tool-call heads-up from any other text.",
    "  - Separate a memory-save acknowledgment from the main answer.",
    "  - When listing items, give each its own bubble.",
    "  - When the topic shifts, start a new message.",
    "  - When a response would be more than a short paragraph, break it into digestible pieces.",
    "IMPORTANT — natural pauses and asides MUST each be their own <message>:",
    "  - An em dash interruption like \"wait actually—\" starts a NEW <message> for what follows.",
    "  - A mid-sentence correction or self-interruption means the text after it goes in its own <message>.",
    "  - Each independent thought / clause separated by em dashes should be its own bubble.",
    "  - Example: <message>I thought it was blue</message><message>wait actually—</message><message>it was green!</message>",
    "Example: <agent><respond>true</respond><message>Hey!</message><message>How's it going?</message><message>I was thinking about that thing you mentioned earlier...</message><memory_updates></memory_updates><tool_calls></tool_calls></agent>",
    "This makes your responses feel natural — like a real person typing messages, not a wall of text.",
    "</multi_message>",
    "<available_tools>",
    ...options.tools.map(formatToolXml),
    "</available_tools>",
    "<tool_usage_policy>",
    "When a question involves current events, live scores, recent news, prices, stats, weather, or any time-sensitive fact, ALWAYS call a web search tool before answering. Never guess or invent current data.",
    "When calling tools, use the tool_call_policy above — give a conversational heads-up first, then let the tool results speak for themselves.",
    "To react to a message, look at the reply_to block or conversation_context messages. Each message has an id attribute, a timestamp attribute, and an author id attribute. Use those values for the session.react tool. Your own Session ID is in <your_session_id> in the platform context — use it as messageAuthor when reacting to your own messages.",
    "</tool_usage_policy>",
    "</system>",
  ].filter(Boolean).join("\n");
}

export function buildConversationInput(
  message: InboundMessage,
  memory: MemoryUpdate[] = [],
): string {
  const msgTsAttr = message.timestamp ? ` timestamp="${message.timestamp}"` : "";
  return [
    "<incoming_message>",
    `<platform>${escapeXml(message.platform)}</platform>`,
    `<channel_id>${escapeXml(message.channelId)}</channel_id>`,
    message.channelType ? `<channel_type>${escapeXml(message.channelType)}</channel_type>` : "",
    message.guildId ? `<guild_id>${escapeXml(message.guildId)}</guild_id>` : "",
    `<author id="${escapeXml(message.authorId)}">${
      escapeXml(message.authorName ?? message.authorId)
    }</author>`,
    `<content${msgTsAttr}>${escapeXml(message.content)}</content>`,
    message.attachments?.length ? formatAttachmentsXml(message.attachments) : "",
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

  const message = matchAllTags(root, "message")
    .map((m) => decodeXml(m).trim())
    .filter((m) => m.length > 0)
    .join("|||") || "";
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

function formatReplyReferenceXml(replyTo: InboundMessageReference): string {
  // Use explicit timestamp field first, then try to extract from id
  const timestamp = replyTo.timestamp ?? extractTimestamp(replyTo.id);
  const tsAttr = timestamp ? ` timestamp="${timestamp}"` : "";

  const lines = [
    "<reply_to>",
    `<message_id${tsAttr}>${escapeXml(replyTo.id)}</message_id>`,
    `<author id="${escapeXml(replyTo.authorId)}">${
      escapeXml(replyTo.authorName ?? replyTo.authorId)
    }</author>`,
    `<content>${escapeXml(replyTo.content)}</content>`,
  ];

  // Recurse into the parent message's own reply chain
  if (replyTo.replyTo) {
    lines.push(formatReplyReferenceXml(replyTo.replyTo));
  }

  lines.push("</reply_to>");
  return lines.join("\n");
}

function formatConversationContextXml(context: ConversationMessage[]): string {
  return [
    "<conversation_context>",
    ...context.map((msg) => {
      const timestamp = msg.timestamp ?? extractTimestamp(msg.id);
      const tsAttr = timestamp ? ` timestamp="${timestamp}"` : "";
      const attrs = [
        msg.isBot ? 'role="assistant"' : "",
        `id="${escapeXml(msg.id)}"`,
        tsAttr,
      ].filter(Boolean).join(" ");
      const body = escapeXml(msg.content) +
        (msg.attachments?.length ? "\n" + formatAttachmentsXml(msg.attachments) : "");
      return `<message author="${escapeXml(msg.authorName ?? msg.authorId)}" ${attrs}>${body}</message>`;
    }),
    "</conversation_context>",
  ].join("\n");
}

/** Extract a numeric timestamp from a Session-style id like "05abc...:1734567890". */
function extractTimestamp(id: string): string | undefined {
  const parts = id.split(":");
  if (parts.length === 2) {
    const ts = Number(parts[1]);
    if (Number.isFinite(ts)) return String(ts);
  }
  return undefined;
}

function formatAttachmentsXml(attachments: MessageAttachment[]): string {
  return [
    "<attachments>",
    ...attachments.map((a) => {
      const attrs = [
        a.contentType ? `type="${escapeXml(a.contentType)}"` : "",
        a.name ? `name="${escapeXml(a.name)}"` : "",
        a.size != null ? `size="${a.size}"` : "",
        a.width != null ? `width="${a.width}"` : "",
        a.height != null ? `height="${a.height}"` : "",
        a.url ? `url="${escapeXml(a.url)}"` : "",
      ].filter(Boolean).join(" ");
      const caption = a.caption ? escapeXml(a.caption) : "";
      return `<attachment id="${escapeXml(a.id)}"${attrs ? " " + attrs : ""}>${caption}</attachment>`;
    }),
    "</attachments>",
  ].join("\n");
}

function matchTag(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`)
    .exec(xml);
  return match?.[1];
}

function matchAllTags(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "g");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
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
