import { ConversationMessage } from "../context.ts";
import {
  apiTools,
  callApiTool,
  isApiTool,
  shouldUseApiFetch,
} from "../apiTools.ts";
import {
  callFilesystemTool,
  FileOperationApprovalHandler,
  FILESYSTEM_TOOL_NAMES,
  filesystemTools,
} from "../filesystemTools.ts";
import {
  callDiscordServerTool,
  DiscordServerToolContext,
  discordServerTools,
  isDiscordServerTool,
  shouldUseDiscordServerTools,
} from "../discordServerTools.ts";
import {
  callMcpTool,
  filterMcpToolRegistry,
  loadMcpTools,
  McpToolRegistry,
  MistralToolDefinition,
} from "../mcp.ts";
import { callMemoryTool, isMemoryTool, memoryTools } from "../memories.ts";
import {
  buildSelfSkillContext,
  callSelfSkillTool,
  isSelfSkillTool,
  selfSkillTools,
} from "../selfSkills.ts";
import {
  callScheduledTaskTool,
  hasSchedulingIntent,
  isScheduledTaskTool,
  scheduledTaskTools,
} from "../scheduledTasks.ts";
import {
  canAccessLocalComputer,
  LOCAL_ACCESS_REQUIRED_MESSAGE,
} from "../localAccess.ts";
import { isCurrentLookupRequest } from "../currentLookup.ts";
import { defaultMistralModel, isRouterModel } from "../models.ts";
import { activeSearchProvider } from "../searchProviders.ts";

const MISTRAL_CHAT_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_CONVERSATIONS_API_URL = "https://api.mistral.ai/v1/conversations";
const DISCORD_MESSAGE_LIMIT = 2_000;
const DISCORD_MESSAGE_BREAK = "MISSY_MESSAGE_BREAK";
const MAX_TOOL_CALL_ROUNDS = 4;
const MAX_CONVERSATION_TOOL_ROUNDS = 4;
const DEFAULT_ROUTER_FAST_MODEL = "mistral-small-latest";
const DEFAULT_ROUTER_REASONING_MODEL = "mistral-large-latest";
const instructionDir = new URL("./instructions/", import.meta.url);
const instructionCache = new Map<string, string>();

type RouterModelRoute = "fast" | "general" | "reasoning" | "tool" | "vision";

function instructionMarkdown(name: string, fallback: string): string {
  const cached = instructionCache.get(name);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const content = Deno.readTextFileSync(new URL(name, instructionDir)).trim();
    instructionCache.set(name, content);
    return content;
  } catch (error) {
    console.error(`Could not read Mistral instruction ${name}`, error);
    instructionCache.set(name, fallback);
    return fallback;
  }
}

function renderInstruction(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{([A-Z0-9_]+)\}\}/g,
    (match, key) => values[key] ?? match,
  );
}

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
  imageUrls?: readonly string[];
  message: string;
  source: "discord-dm" | "discord-server" | "discord-slash";
  discord: {
    userId: string;
    username: string;
    displayName?: string;
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
  content?: string | MistralChatContentBlock[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: MistralToolCall[];
};

type MistralChatContentBlock =
  | {
    type: "text";
    text: string;
  }
  | {
    type: "image_url";
    image_url: string;
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
  chatCompletionsUrl?: string;
  conversationsApiUrl?: string;
  context?: ConversationMessage[];
  discordHistory?: string;
  enableMcp?: boolean;
  forceChatCompletions?: boolean;
  memoryContext?: string;
  model?: string;
  onToolActivity?: (activity: MistralToolActivity) => Promise<void>;
  personalityInstruction?: string;
  discordServerToolContext?: DiscordServerToolContext;
  requestFileOperationApproval?: FileOperationApprovalHandler;
  selfSkillContext?: string;
};

export type MistralToolActivity = {
  arguments: unknown;
  toolName: string;
};

function getMistralModel(options: MistralSendOptions): string {
  return options.model ?? defaultMistralModel();
}

function routerModelFromEnv(
  route: RouterModelRoute,
  fallback: string,
): string {
  const envName = `MISTRAL_ROUTER_${route.toUpperCase()}_MODEL`;
  return Deno.env.get(envName)?.trim() || fallback;
}

function routerTargetModel(route: RouterModelRoute): string {
  const fast = routerModelFromEnv("fast", DEFAULT_ROUTER_FAST_MODEL);
  const general = routerModelFromEnv("general", fast);
  const tool = routerModelFromEnv("tool", general);
  const vision = routerModelFromEnv("vision", general);
  const reasoning = routerModelFromEnv(
    "reasoning",
    DEFAULT_ROUTER_REASONING_MODEL,
  );

  switch (route) {
    case "fast":
      return fast;
    case "general":
      return general;
    case "reasoning":
      return reasoning;
    case "tool":
      return tool;
    case "vision":
      return vision;
  }
}

function totalContextLength(options: MistralSendOptions): number {
  const contextLength = (options.context ?? []).reduce(
    (total, message) => total + message.content.length,
    0,
  );
  return contextLength + (options.discordHistory?.length ?? 0) +
    (options.memoryContext?.length ?? 0);
}

function isShortCasualRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return normalized.length <= 140 &&
    /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|k|lol|lmao|haha|nah|yes|no|yep|nope|gm|gn|good morning|good night)\b/
      .test(normalized);
}

function isReasoningHeavyRequest(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): boolean {
  const normalized = payload.message.trim().toLowerCase();

  if (payload.message.length > 900 || totalContextLength(options) > 6_000) {
    return true;
  }

  return /\b(debug|fix|implement|refactor|architect|design|write code|code review|review this code|stack trace|typescript|javascript|python|sql|regex|algorithm|prove|proof|derive|calculate|math|step by step|deep dive|analy[sz]e|compare|tradeoffs?|plan|strategy|why does|root cause)\b/
    .test(normalized);
}

function routerRouteForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): RouterModelRoute {
  if (hasVisionImages(payload)) {
    return "vision";
  }

  if (
    hasCurrentLocalFilesystemIntent(payload) ||
    shouldUseWebSearch(payload.message) ||
    shouldUseApiFetch(payload.message) ||
    hasSchedulingIntent(payload.message) ||
    shouldUseDiscordServerTools(payload.message)
  ) {
    return "tool";
  }

  if (isReasoningHeavyRequest(payload, options)) {
    return "reasoning";
  }

  if (isShortCasualRequest(payload.message)) {
    return "fast";
  }

  return "general";
}

export function resolveMistralModelForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions = {},
): string {
  const requestedModel = options.model ?? defaultMistralModel();

  if (!isRouterModel(requestedModel)) {
    return requestedModel;
  }

  return routerTargetModel(routerRouteForPayload(payload, options));
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

function currentTimeContext(): string {
  const now = new Date();
  const format = (tz: string, label: string) => {
    const time = now.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${label}: ${time}`;
  };

  return [
    "Current times:",
    format("UTC", "UTC"),
    format("America/New_York", "New York (ET)"),
    format("America/Los_Angeles", "Los Angeles (PT)"),
    format("Europe/London", "London (UK)"),
    format("Australia/Sydney", "Sydney (AEST)"),
    format("Asia/Tokyo", "Tokyo (JST)"),
  ].join("\n");
}

function timeZoneConversionInstruction(): string {
  return instructionMarkdown(
    "timezone-conversion.md",
    "For scheduled events, games, releases, broadcasts, or appointments, preserve the source timezone from search results or source text. If the user wants their local time or has a timezone in memory, convert from the source timezone to that timezone and include the converted date when it changes. Never relabel a source time as another timezone. For example, 8:30 PM ET is not 8:30 PM Sydney time; convert it to the correct Sydney date and time.",
  );
}

function userIdentityInstruction(payload: MistralMessagePayload): string {
  const identity = [
    `Discord user ID: ${payload.discord.userId}`,
    `Discord username/tag: ${payload.discord.username}`,
  ];

  if (payload.discord.displayName) {
    identity.push(
      `Discord display name/nickname: ${payload.discord.displayName}`,
    );
  }

  return [
    `Current Discord user context: ${identity.join("; ")}.`,
    "If you directly address this person, prefer their display name/nickname when available, and keep it natural. Do not force their name into every reply.",
  ].join(" ");
}

export function shouldShowSourcesForRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return /\b(where did you|where'd you|where)\s+(find|get|see|read|hear)\b/
    .test(normalized) ||
    /\b(link it|link me|send (me )?(a |the )?link|drop (a |the )?link|got (a )?link)\b/
      .test(normalized) ||
    /\b(send|show|give|drop|provide)\b.{0,24}\b(source|sources|citation|citations|reference|references|proof)\b/
      .test(normalized) ||
    /^(source|sources|citations|references|proof)\s*(pls|please|\?)?$/.test(
      normalized,
    );
}

export function hasCurrentLocalFilesystemIntent(
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
    /\b(desktop|downloads?|documents?|pictures?|photos?|images?|screenshots?|camera roll|gallery|filesystem|file system|local|drives?|directories|directory|folders?|files?|paths?|repo|repository)\b/
      .test(message);
  const localAction =
    /\b(access|attach|browse|cat|check|choose|copy|create|delete|embed|find|get|inspect|list|locate|mkdir|move|open|pick|post|random|read|remove|rename|select|send|show|stat|tree|upload|write|overwrite)\b/
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
  return filterMcpToolRegistry(registry, () => true);
}

function getBuiltinToolsForPayload(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralToolDefinition[] {
  const tools: MistralToolDefinition[] = [];

  const searchProvider = activeSearchProvider();

  if (
    searchProvider?.enabled() && searchProvider.available() &&
    shouldUseWebSearch(payload.message)
  ) {
    tools.push(...searchProvider.tools);
  }

  if (hasLocalAccess(payload) && hasCurrentLocalFilesystemIntent(payload)) {
    tools.push(...filesystemTools);
  }

  if (shouldUseApiFetch(payload.message)) {
    tools.push(...apiTools);
  }

  if (
    hasSchedulingIntent(payload.message) &&
    !payload.message.startsWith("A scheduled Missy task is due now.")
  ) {
    tools.push(...scheduledTaskTools);
  }

  if (
    options.discordServerToolContext &&
    payload.discord.guildId &&
    shouldUseDiscordServerTools(payload.message)
  ) {
    tools.push(...discordServerTools);
  }

  tools.push(...memoryTools);
  tools.push(...selfSkillTools);

  return tools;
}

function isFilesystemTool(toolName: string): boolean {
  return Object.values(FILESYSTEM_TOOL_NAMES).includes(
    toolName as typeof FILESYSTEM_TOOL_NAMES[
      keyof typeof FILESYSTEM_TOOL_NAMES
    ],
  );
}

function hasLocalAttachmentIntent(message: string): boolean {
  return /\b(attach|embed|send|post|upload)\b/i.test(message) &&
    /\b(discord|chat|file|files|image|images|picture|pictures|photo|photos|screenshot|screenshots)\b/i
      .test(message);
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractStringValues);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      if (
        /(?:^|_)(?:path|file|stdout|output|targetPath|sourcePath|destinationPath)$/i
          .test(key)
      ) {
        return extractStringValues(nestedValue);
      }

      return Array.isArray(nestedValue) ? extractStringValues(nestedValue) : [];
    });
  }

  return [];
}

function localPathCandidatesFromToolResult(result: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = result;
  }

  return extractStringValues(parsed)
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim().replace(/^["'`]+|["'`.,;:]+$/g, ""))
    .filter((value) =>
      /^(?:[A-Za-z]:\\|~[\\/]|\/).+\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/i
        .test(value)
    );
}

export function buildLocalAttachmentFallback(
  payload: MistralMessagePayload,
  filesystemToolResults: readonly string[],
): string | undefined {
  if (!hasLocalAttachmentIntent(payload.message)) {
    return undefined;
  }

  for (const result of filesystemToolResults.toReversed()) {
    const candidate = localPathCandidatesFromToolResult(result).at(-1);

    if (candidate) {
      return `MISSY_ATTACH_LOCAL: ${candidate}`;
    }
  }

  return undefined;
}

async function callAvailableTool(
  registry: McpToolRegistry,
  toolName: string,
  rawArguments: unknown,
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): Promise<string> {
  const searchProvider = activeSearchProvider();

  if (searchProvider?.isTool(toolName)) {
    return await searchProvider.callTool(toolName, rawArguments);
  }

  if (isFilesystemTool(toolName)) {
    if (!hasLocalAccess(payload)) {
      throw new Error(LOCAL_ACCESS_REQUIRED_MESSAGE);
    }

    if (!hasCurrentLocalFilesystemIntent(payload)) {
      throw new Error(
        "The local Deno REPL is available only when the current Discord message explicitly asks to inspect or modify local files.",
      );
    }

    return await callFilesystemTool(
      toolName,
      rawArguments,
      options.requestFileOperationApproval,
    );
  }

  if (isMemoryTool(toolName)) {
    return await callMemoryTool(toolName, rawArguments, {
      guildId: payload.discord.guildId,
      userId: payload.discord.userId,
    });
  }

  if (isSelfSkillTool(toolName)) {
    return await callSelfSkillTool(toolName, rawArguments, {
      guildId: payload.discord.guildId,
      userId: payload.discord.userId,
    });
  }

  if (isApiTool(toolName)) {
    return await callApiTool(toolName, rawArguments);
  }

  if (isScheduledTaskTool(toolName)) {
    return await callScheduledTaskTool(toolName, rawArguments, payload);
  }

  if (isDiscordServerTool(toolName)) {
    if (!options.discordServerToolContext) {
      throw new Error(
        "Discord server tools are available only in a Discord server context.",
      );
    }

    return await callDiscordServerTool(
      toolName,
      rawArguments,
      options.discordServerToolContext,
    );
  }

  return await callMcpTool(registry, toolName, rawArguments);
}

function conversationApiEnabled(options: MistralSendOptions): boolean {
  if (options.forceChatCompletions) {
    return false;
  }

  return Deno.env.get("MISTRAL_USE_CONVERSATIONS") === "1";
}

function conversationStoreEnabled(): boolean {
  return Deno.env.get("MISTRAL_KEEP_CONVERSATIONS") === "1";
}

function hasVisionImages(payload: MistralMessagePayload): boolean {
  return (payload.imageUrls?.length ?? 0) > 0;
}

export function shouldUseWebSearch(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    /^MISSY_GIF_SEARCH:/i.test(message.trim()) ||
    /\b(send|reply|respond|use|find|get|pick)\b.{0,40}\bgifs?\b/i.test(message)
  ) {
    return false;
  }

  if (isCurrentLookupRequest(message)) {
    return true;
  }

  if (/https?:\/\/\S+/i.test(message)) {
    return true;
  }

  if (
    /\b(search|look up|find|show|get|send|give|drop)\b.{0,40}\b(images?|pictures?|photos?|visual references?|videos?|clips?|trailers?|tutorials?)\b/
      .test(normalized) ||
    /\b(images?|pictures?|photos?|visual references?|videos?|clips?|trailers?|tutorials?)\b.{0,40}\b(search|lookup|look up|find)\b/
      .test(normalized)
  ) {
    return true;
  }

  if (
    /\b(search|look up|google|check|find)\b.{0,40}\b(web|online|internet|site|page|url|link)\b/
      .test(normalized) ||
    /\b(web|online|internet)\b.{0,40}\b(search|lookup|look up|find|check)\b/
      .test(normalized)
  ) {
    return true;
  }

  // Time-sensitive topics: sports, markets, predictions, recent events
  const timeSensitiveTopic =
    /\b(nba|nfl|nhl|mlb|wnba|epl|premier league|la liga|serie a|bundesliga|champions league|mls|ufc|f1|formula 1|fifa|world cup|olympics|march madness|draft|free agency|trade deadline|all[- ]?star|super bowl|stanley cup|world series|playoffs?|finals?|championship|roster|traded?|signing|injury|injured|standings|record|seed|seeding|bracket|matchup|game [0-9]|series)\b/
      .test(normalized) ||
    /\b(stock|stocks|market|markets|crypto|bitcoin|btc|eth|ethereum|s&p|nasdaq|dow|sp500|shares?|ticker|price of|trading at|ipo|earnings)\b/
      .test(normalized) ||
    /\b(election|poll|polls|approval rating|legislation|bill passed|indicted|arrested|appointed|resigned|fired|scandal|controversy)\b/
      .test(normalized) ||
    /\b(released?|dropped|announced|launched|update|patch|version [0-9]|coming out|came out|just (dropped|released|announced|happened))\b/
      .test(normalized) ||
    /\b(yesterday|last night|earlier today|this morning|this afternoon|this evening|this weekend|last week|over the weekend|just now)\b/
      .test(normalized) ||
    /\b(predict|prediction|predictions|who wins|who won|who lost|who'?s winning|who'?s gonna win|who do you got|who you got|who do you think|who you think|will win|gonna win|going to win|gonna lose|going to lose|what happened|what's happening|any news)\b/
      .test(normalized) ||
    /\b(weather|forecast|temperature|rain|snow|storm|hurricane|tornado|earthquake|wildfire)\b/
      .test(normalized) ||
    /\b(bus|train|tram|ferry|metro|route|transit|transport|timetable|departure|arrival|arrive|commute|trip planner)\b/
      .test(normalized) ||
    /\b\w+\s+vs\.?\s+\w+\b/.test(normalized);

  return timeSensitiveTopic;
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

  const response = await fetch(
    options.chatCompletionsUrl ?? MISTRAL_CHAT_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

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
  options: MistralSendOptions,
): Promise<MistralConversationResponse> {
  const response = await fetch(
    `${options.conversationsApiUrl ?? MISTRAL_CONVERSATIONS_API_URL}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
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
  options: MistralSendOptions,
): Promise<void> {
  try {
    await fetch(
      `${options.conversationsApiUrl ?? MISTRAL_CONVERSATIONS_API_URL}/${
        encodeURIComponent(conversationId)
      }`,
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
      new URL("../../PERSONALITY.md", import.meta.url),
    );
    return [
      content.trim(),
      renderInstruction(
        instructionMarkdown(
          "personality-append.md",
          "You are not Poke and should not claim to be developed by Interaction.\n\nWhen splitting messages, use the exact separator {{DISCORD_MESSAGE_BREAK}} on its own line.",
        ),
        { DISCORD_MESSAGE_BREAK },
      ),
    ].join("\n\n");
  } catch (error) {
    console.error("Could not read PERSONALITY.md", error);
    return renderInstruction(
      instructionMarkdown(
        "personality-fallback.md",
        "You are Missy.\n\nSound like a warm, concise friend in a group chat rather than a traditional chatbot.\n\nWhen asked which option is better, pick a side after briefly weighing the tradeoffs. If the prompt is potentially unsafe, do not choose between harmful options; redirect toward a safer next step.\n\nUse {{DISCORD_MESSAGE_BREAK}} on its own line to split natural multi-message replies.",
      ),
      { DISCORD_MESSAGE_BREAK },
    );
  }
}

function searchInstructionForPayload(payload: MistralMessagePayload): string {
  const searchRequested = shouldUseWebSearch(payload.message);
  const searchProvider = activeSearchProvider();

  if (!searchProvider?.enabled()) {
    return "Web search tools are disabled. Do not claim you searched the web. For fresh GIF replies, use MISSY_GIF_SEARCH so the app can resolve it through the GIPHY API.";
  }

  if (!searchRequested) {
    return "Web search tools are not available for this request because the user did not ask for current, live, recent, specific web/page, image search, or video search information. Do not claim you searched the web. For fresh GIF replies, use MISSY_GIF_SEARCH so the app can resolve it through the GIPHY API.";
  }

  if (!searchProvider.available()) {
    return searchProvider.unavailableInstruction;
  }

  return searchProvider.toolInstruction;
}

function memoryInstruction(): string {
  return instructionMarkdown(
    "memory.md",
    "Use persistent memories only when relevant. Proactively save memories when users share personal facts, preferences, opinions, interests, life details, or anything that would help you be a better friend in future conversations. You do not need to be asked to remember; if someone mentions their job, hobbies, favorite things, relationships, timezone, or any stable fact about themselves, save it. Avoid saving trivial/ephemeral info like what they ate for one meal or momentary moods. Do not announce that you saved a memory unless asked.",
  );
}

function selfSkillInstruction(context?: string): string {
  const base =
    "You can create and use self-authored Missy skills. A skill is a reusable procedure for a workflow, API pattern, or automation. If the user asks you to learn, remember how to do a repeatable task, create an automation pattern, or you discover a durable API workflow, use missy_save_skill. If a known skill appears relevant, read it with missy_read_skill before relying on it. Do not save secrets in skills.";

  return context ? `${base}\n\n${context}` : base;
}

function automationToolInstruction(payload: MistralMessagePayload): string {
  const parts = [
    "When the user asks for a future or recurring reminder, notification, scheduled lookup, or scheduled automation, use missy_schedule_task instead of only describing what to do.",
    "For scheduled tasks that need current data later, store the full lookup goal in the scheduled task prompt; the task runner will call Missy again at the scheduled time with current web/API tools available.",
  ];

  if (shouldUseApiFetch(payload.message)) {
    parts.push(
      "For public API or documentation lookups, use missy_http_get on specific public URLs when search snippets are not enough. This tool cannot send credentials; if an API needs a key or OAuth, ask the user to configure an MCP server or HTTP JSON search provider.",
    );
  }

  return parts.join(" ");
}

function discordServerToolInstruction(
  options: MistralSendOptions,
): string {
  if (!options.discordServerToolContext) {
    return "";
  }

  return "When the user asks about people, users, members, roles, channels, or this Discord server, use the Discord server tools instead of guessing. For questions like 'who is aric?', search members by the requested name and answer from display names, usernames, nicknames, roles, and mentions. Do not claim certainty if the member data is ambiguous or limited. Only send a message to a channel when the user explicitly asks or confirms the exact target/channel and content.";
}

function sourcesInstruction(): string {
  return instructionMarkdown(
    "sources.md",
    "Do not include sources or links unless the user explicitly asked for sources, citations, proof, a URL, a link, or where you found it.",
  );
}

function localDenoInstruction(
  payload: MistralMessagePayload,
  denoTaskGuidance: string,
): string {
  return renderInstruction(
    instructionMarkdown(
      "local-deno-enabled.md",
      "Discord user {{USER_ID}} is listed in MISSY_LOCAL_ACCESS_USER_IDS and is allowed to use the embedded local Deno REPL from {{CONTEXT_LABEL}}, either directly by user ID or through a role in MISSY_LOCAL_ACCESS_ROLE_IDS. Local access is not limited to the Desktop; use absolute Windows paths such as D:\\ when the user asks for them. Do not tell this user to DM for local access; server access is allowed for this actor. Use ~/Pictures for the user's Pictures folder unless they provide a different path. {{DENO_TASK_GUIDANCE}} To upload/embed a selected local file into Discord, include a line exactly like MISSY_ATTACH_LOCAL: <absolute local file path> in the final reply. The app will request read approval before uploading it. The Deno REPL starts without local permissions; when it requests read/write/run/net/env/etc. access, that exact permission is sent to the user for check/cross approval before the code is rerun with the approved scoped permission.",
    ),
    {
      CONTEXT_LABEL: localAccessContextLabel(payload),
      DENO_TASK_GUIDANCE: denoTaskGuidance,
      USER_ID: payload.discord.userId,
    },
  );
}

function localAccessInstructionForPayload(
  payload: MistralMessagePayload,
  localFilesystemIntent: boolean,
  mode: "chat" | "conversation",
): string {
  if (hasLocalAccess(payload) && localFilesystemIntent) {
    const denoTaskGuidance = mode === "chat"
      ? "For compound local tasks such as locating files and moving them to a folder, picking a random screenshot, or selecting a local image to upload, run the Deno REPL instead of merely describing commands."
      : "If the user asks about local files, use the Deno REPL when helpful. For compound local tasks such as locating files and moving them to a folder, picking a random screenshot, or selecting a local image to upload, run the Deno REPL instead of merely describing commands.";

    return localDenoInstruction(payload, denoTaskGuidance);
  }

  if (hasLocalAccess(payload)) {
    return instructionMarkdown(
      "local-deno-disabled.md",
      "The local Deno REPL is disabled for this request because the current Discord message does not explicitly ask to inspect or modify local files. Do not infer a local file request from older conversation context.",
    );
  }

  return renderInstruction(
    instructionMarkdown(
      mode === "chat"
        ? "local-access-denied-chat.md"
        : "local-access-denied-conversation.md",
      mode === "chat"
        ? "{{LOCAL_ACCESS_REQUIRED_MESSAGE}} Never access local Desktop or computer files and never modify local filesystem paths for this user."
        : "{{LOCAL_ACCESS_REQUIRED_MESSAGE}} Never move, rename, delete, read, write, copy, create, or list local filesystem paths for this user.",
    ),
    { LOCAL_ACCESS_REQUIRED_MESSAGE },
  );
}

function buildMessages(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): MistralChatMessage[] {
  const localFilesystemIntent = hasCurrentLocalFilesystemIntent(payload);
  const localAccessInstruction = localAccessInstructionForPayload(
    payload,
    localFilesystemIntent,
    "chat",
  );
  const messages: MistralChatMessage[] = [
    {
      role: "system",
      content: `${options.personalityInstruction} ${
        userIdentityInstruction(payload)
      } ${currentTimeContext()} Use the user's timezone from memories if known; for other cities, use the pre-computed times above as reference. ${timeZoneConversionInstruction()} Use provided Discord history and memories only as context for the current request. ${memoryInstruction()} ${
        selfSkillInstruction(options.selfSkillContext)
      } ${automationToolInstruction(payload)} ${
        discordServerToolInstruction(options)
      } ${searchInstructionForPayload(payload)} ${localAccessInstruction}`,
    },
  ];

  if (options.memoryContext) {
    messages.push({
      role: "system",
      content: options.memoryContext,
    });
  }

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
    content: buildUserChatContent(payload),
  });

  return messages;
}

export function buildUserChatContent(
  payload: Pick<MistralMessagePayload, "imageUrls" | "message">,
): string | MistralChatContentBlock[] {
  const imageUrls = payload.imageUrls ?? [];

  if (imageUrls.length === 0) {
    return payload.message;
  }

  return [
    {
      type: "text",
      text: payload.message,
    },
    ...imageUrls.map((imageUrl) => ({
      type: "image_url" as const,
      image_url: imageUrl,
    })),
  ];
}

function buildInstructions(
  payload: MistralMessagePayload,
  options: MistralSendOptions,
): string {
  const localFilesystemIntent = hasCurrentLocalFilesystemIntent(payload);
  const localAccessInstruction = localAccessInstructionForPayload(
    payload,
    localFilesystemIntent,
    "conversation",
  );
  const instructions = [
    options.personalityInstruction ??
      "You are Missy.",
    userIdentityInstruction(payload),
    `${currentTimeContext()} Use the user's timezone from memories if known; for other cities, use the pre-computed times above as reference.`,
    timeZoneConversionInstruction(),
    memoryInstruction(),
    selfSkillInstruction(options.selfSkillContext),
    automationToolInstruction(payload),
    discordServerToolInstruction(options),
    searchInstructionForPayload(payload),
    sourcesInstruction(),
    localAccessInstruction,
  ];

  if (options.memoryContext) {
    instructions.push(options.memoryContext);
  }

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
  includeReferences: boolean,
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
  const uniqueReferences = includeReferences
    ? [
      ...new Set(
        content
          .filter((block) => block.type === "tool_reference")
          .map(referenceLabel)
          .filter((value): value is string => Boolean(value)),
      ),
    ]
    : [];

  if (uniqueReferences.length === 0) {
    return text;
  }

  return `${text}\n\nSources:\n${uniqueReferences.join("\n")}`.trim();
}

function extractConversationText(
  response: MistralConversationResponse,
  includeReferences: boolean,
): string {
  const messages = (response.outputs ?? [])
    .filter((output) => output.type === "message.output")
    .map((output) => extractConversationOutputText(output, includeReferences))
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
    ...builtinTools,
    ...registry.tools,
  ];
  let parsed = await postMistralConversation(
    apiKey,
    "",
    {
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
    },
    options,
  );
  let conversationId = getConversationId(parsed);
  const conversationIds = new Set([conversationId]);
  const filesystemToolResults: string[] = [];

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
          await options.onToolActivity?.({
            arguments: functionCall.arguments,
            toolName,
          });
          result = await callAvailableTool(
            registry,
            toolName,
            functionCall.arguments,
            payload,
            options,
          );
          console.log(`[tool] ${toolName}`, {
            args: functionCall.arguments,
            result,
          });
        } catch (error) {
          result = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
          console.error(`[tool] ${toolName} ERROR`, {
            args: functionCall.arguments,
            error,
          });
        }

        if (isFilesystemTool(toolName)) {
          filesystemToolResults.push(result);
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
        options,
      );
      conversationId = getConversationId(parsed);
      conversationIds.add(conversationId);
    }

    const reply = extractConversationText(
      parsed,
      shouldShowSourcesForRequest(payload.message),
    );

    if (!reply) {
      const fallbackReply = buildLocalAttachmentFallback(
        payload,
        filesystemToolResults,
      );

      if (fallbackReply) {
        return fallbackReply;
      }

      throw new MistralApiError(
        "Mistral Conversations API returned an empty response",
      );
    }

    return reply;
  } finally {
    if (!conversationStoreEnabled()) {
      for (const storedConversationId of conversationIds) {
        await deleteMistralConversation(apiKey, storedConversationId, options);
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
  const filesystemToolResults: string[] = [];

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
        await options.onToolActivity?.({
          arguments: toolCall.function?.arguments,
          toolName,
        });
        toolResult = await callAvailableTool(
          registry,
          toolName,
          toolCall.function?.arguments,
          payload,
          options,
        );
        console.log(`[tool] ${toolName}`, {
          args: toolCall.function?.arguments,
          result: toolResult,
        });
      } catch (error) {
        toolResult = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`[tool] ${toolName} ERROR`, {
          args: toolCall.function?.arguments,
          error,
        });
      }

      if (isFilesystemTool(toolName)) {
        filesystemToolResults.push(toolResult);
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
    const fallbackReply = buildLocalAttachmentFallback(
      payload,
      filesystemToolResults,
    );

    if (fallbackReply) {
      return fallbackReply;
    }

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
    model: resolveMistralModelForPayload(payload, options),
    personalityInstruction: options.personalityInstruction ??
      await loadPersonalityInstruction(),
    selfSkillContext: options.selfSkillContext ??
      await buildSelfSkillContext({
        guildId: payload.discord.guildId,
        userId: payload.discord.userId,
      }),
  };
  const registry = options.enableMcp === false
    ? { tools: [], entries: new Map() }
    : filterMcpToolsForPayload(await loadMcpTools(), payload);

  if (conversationApiEnabled(sendOptions) && !hasVisionImages(payload)) {
    return await sendMistralConversationMessage(
      apiKey,
      payload,
      registry,
      sendOptions,
    );
  }

  return await sendMistralChatMessage(apiKey, payload, registry, sendOptions);
}
