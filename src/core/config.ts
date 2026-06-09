export interface AppConfig {
  enabledPlatforms: string[];
  providerName: string;
  providerNames: string[];
  personalityPath: string;
  platformsDir: string;
  pluginsDir: string;
  providersDir: string;
  replyMode: "message" | "xml";
  memory: MemoryConfig;
  openai: OpenAIProviderConfig;
  mistral: MistralProviderConfig;
  discord: DiscordConfig;
  webSearch: WebSearchConfig;
}

export interface OpenAIProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  temperature: number;
  api: "responses" | "chat";
}

export interface MistralProviderConfig {
  apiKey?: string;
  model: string;
  temperature: number;
}

export interface MemoryConfig {
  path: string;
  enabled: boolean;
}

export interface DiscordConfig {
  token?: string;
  mentionOnly: boolean;
  commandPrefix: string;
  maxMessageLength: number;
  respondToAllMessages: boolean;
  includeReplyContext: boolean;
  includeChannelContext: boolean;
  channelContextCount: number;
  observeReactions: boolean;
  reactToAllMessages: boolean;
  reactToHandledMessages: boolean;
  handledReactionEmoji: string;
  multiMessageDelimiter: string;
  multiMessageDelayMs: number;
}

export interface WebSearchConfig {
  providersDir: string;
  providerNames: string[];
  maxResults: number;
  braveApiKey?: string;
}

export const CONFIG_FILE_PATH = "missy.config.json";

// deno-lint-ignore no-explicit-any
type ConfigData = Record<string, any>;

/**
 * Load saved config from missy.config.json (written by the interactive setup).
 * Returns an empty object if the file doesn't exist.
 */
function loadConfigFile(): ConfigData {
  try {
    const text = Deno.readTextFileSync(CONFIG_FILE_PATH);
    return JSON.parse(text) as ConfigData;
  } catch {
    return {};
  }
}

/** Read a dot-path from the config data (e.g. "openai.apiKey") */
function getConfigValue(data: ConfigData, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function loadConfig(env = Deno.env.toObject()): AppConfig {
  const file = loadConfigFile();

  // Helper: file value → env fallback → default
  const str = (filePath: string, envKey: string, fallback: string): string =>
    (getConfigValue(file, filePath) as string) ?? env[envKey] ?? fallback;
  const optStr = (filePath: string, envKey: string): string | undefined =>
    (getConfigValue(file, filePath) as string) ?? env[envKey];
  const num = (filePath: string, envKey: string, fallback: number): number => {
    const v = getConfigValue(file, filePath);
    if (typeof v === "number") return v;
    return numberFromEnv(env[envKey], fallback);
  };
  const bool = (filePath: string, envKey: string, fallback: boolean): boolean => {
    const v = getConfigValue(file, filePath);
    if (typeof v === "boolean") return v;
    return boolFromEnv(env[envKey], fallback);
  };
  const list = (filePath: string, envKey: string, fallback: string): string[] => {
    const v = getConfigValue(file, filePath);
    if (Array.isArray(v)) return v as string[];
    return listFromEnv(env[envKey] ?? fallback);
  };

  const defaultProviderName = str("provider", "AI_PROVIDER", "openai");

  return {
    enabledPlatforms: list("platforms", "PLATFORMS", "discord"),
    providerName: defaultProviderName,
    providerNames: list("providers", "AI_PROVIDERS", defaultProviderName),
    personalityPath: str("personalityPath", "PERSONALITY_PATH", "personality.xml"),
    platformsDir: str("platformsDir", "PLATFORMS_DIR", "src/platforms"),
    pluginsDir: str("pluginsDir", "PLUGINS_DIR", "src/plugins"),
    providersDir: str("providersDir", "PROVIDERS_DIR", "src/providers"),
    replyMode: parseReplyMode(str("replyMode", "AGENT_REPLY_MODE", "xml")),
    memory: {
      path: str("memory.path", "MEMORY_PATH", "data/memory.json"),
      enabled: bool("memory.enabled", "MEMORY_ENABLED", true),
    },
    openai: {
      apiKey: optStr("openai.apiKey", "OPENAI_API_KEY"),
      baseURL: optStr("openai.baseURL", "OPENAI_BASE_URL"),
      model: str("openai.model", "OPENAI_MODEL", "gpt-5.2"),
      temperature: num("openai.temperature", "OPENAI_TEMPERATURE", 0.2),
      api: parseOpenAIApi(str("openai.api", "OPENAI_API", "responses")),
    },
    mistral: {
      apiKey: optStr("mistral.apiKey", "MISTRAL_API_KEY"),
      model: str("mistral.model", "MISTRAL_MODEL", "mistral-small-latest"),
      temperature: num("mistral.temperature", "MISTRAL_TEMPERATURE", 0.2),
    },
    discord: {
      token: optStr("discord.token", "DISCORD_TOKEN"),
      mentionOnly: bool("discord.mentionOnly", "DISCORD_MENTION_ONLY", true),
      commandPrefix: str("discord.commandPrefix", "DISCORD_COMMAND_PREFIX", "!M!"),
      maxMessageLength: num("discord.maxMessageLength", "DISCORD_MAX_MESSAGE_LENGTH", 0),
      respondToAllMessages: bool("discord.respondToAllMessages", "DISCORD_RESPOND_TO_ALL_MESSAGES", false),
      includeReplyContext: bool("discord.includeReplyContext", "DISCORD_INCLUDE_REPLY_CONTEXT", true),
      includeChannelContext: bool("discord.includeChannelContext", "DISCORD_INCLUDE_CHANNEL_CONTEXT", true),
      channelContextCount: num("discord.channelContextCount", "DISCORD_CHANNEL_CONTEXT_COUNT", 10),
      observeReactions: bool("discord.observeReactions", "DISCORD_OBSERVE_REACTIONS", false),
      reactToAllMessages: bool("discord.reactToAllMessages", "DISCORD_REACT_TO_ALL_MESSAGES", false),
      reactToHandledMessages: bool("discord.reactToHandledMessages", "DISCORD_REACT_TO_HANDLED_MESSAGES", false),
      handledReactionEmoji: str("discord.handledReactionEmoji", "DISCORD_HANDLED_REACTION_EMOJI", "\u{1F440}"),
      multiMessageDelimiter: str("discord.multiMessageDelimiter", "DISCORD_MULTI_MESSAGE_DELIMITER", "|||"),
      multiMessageDelayMs: num("discord.multiMessageDelayMs", "DISCORD_MULTI_MESSAGE_DELAY_MS", 1500),
    },
    webSearch: {
      providersDir: str("webSearch.providersDir", "WEB_SEARCH_PROVIDERS_DIR", "src/web-search-providers"),
      providerNames: list("webSearch.providerNames", "WEB_SEARCH_PROVIDERS", "duckduckgo"),
      maxResults: num("webSearch.maxResults", "WEB_SEARCH_MAX_RESULTS", 5),
      braveApiKey: optStr("webSearch.braveApiKey", "BRAVE_SEARCH_API_KEY"),
    },
  };
}

function listFromEnv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseReplyMode(value: string | undefined): "message" | "xml" {
  if (value === "message") {
    return "message";
  }

  return "xml";
}

function parseOpenAIApi(value: string): "responses" | "chat" {
  if (value === "chat") {
    return "chat";
  }
  return "responses";
}
