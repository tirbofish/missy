export interface AppConfig {
  enabledPlatforms: string[];
  providerName: string;
  providerNames: string[];
  personalityPath: string;
  platformsDir: string;
  pluginNames: string[];
  pluginsDir: string;
  providersDir: string;
  replyMode: "message" | "xml";
  keystore: KeystoreConfig;
  memory: MemoryConfig;
  webSearchProvidersDir: string;
  webSearchProviderNames: string[];
  /** Raw config data from file + env for module-specific access. */
  data: Record<string, unknown>;
}

export interface KeystoreConfig {
  path: string;
  enabled: boolean;
}

export interface MemoryConfig {
  path: string;
  enabled: boolean;
}

export const CONFIG_FILE_PATH = "missy.config.json";

import { readFileSync } from "node:fs";

type ConfigData = Record<string, unknown>;

/**
 * Load saved config from missy.config.json (written by the interactive setup).
 * Returns an empty object if the file doesn't exist.
 */
function loadConfigFile(): ConfigData {
  try {
    const text = readFileSync(CONFIG_FILE_PATH, "utf-8");
    return JSON.parse(text) as ConfigData;
  } catch {
    return {};
  }
}

/** Read a dot-path from the config data (e.g. "openai.apiKey") */
export function getConfigValue(data: ConfigData, path: string): unknown {
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

export function loadConfig(env: Record<string, string> = process.env as Record<string, string>): AppConfig {
  const file = loadConfigFile();

  // Helper: file value → env fallback → default
  const str = (filePath: string, envKey: string, fallback: string): string =>
    (getConfigValue(file, filePath) as string) ?? env[envKey] ?? fallback;
  const bool = (filePath: string, envKey: string, fallback: boolean): boolean => {
    const v = getConfigValue(file, filePath);
    if (typeof v === "boolean") return v;
    return boolFromEnv(env[envKey], fallback);
  };
  const list = (filePath: string, envKey: string, fallback: string): string[] => {
    const v = getConfigValue(file, filePath);
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string") return listFromEnv(v);
    return listFromEnv(env[envKey] ?? fallback);
  };

  const defaultProviderName = str("provider", "AI_PROVIDER", "openai");

  return {
    enabledPlatforms: list("platforms", "PLATFORMS", "discord"),
    providerName: defaultProviderName,
    providerNames: list("providers", "AI_PROVIDERS", defaultProviderName),
    personalityPath: str("personalityPath", "PERSONALITY_PATH", "personality.xml"),
    platformsDir: str("platformsDir", "PLATFORMS_DIR", "src/platforms"),
    pluginNames: list("plugins", "PLUGINS", ""),
    pluginsDir: str("pluginsDir", "PLUGINS_DIR", "src/plugins"),
    providersDir: str("providersDir", "PROVIDERS_DIR", "src/providers"),
    replyMode: parseReplyMode(str("replyMode", "AGENT_REPLY_MODE", "xml")),
    keystore: {
      path: str("keystore.path", "KEYSTORE_PATH", "data/keystore.json"),
      enabled: bool("keystore.enabled", "KEYSTORE_ENABLED", true),
    },
    memory: {
      path: str("memory.path", "MEMORY_PATH", "data/memory.json"),
      enabled: bool("memory.enabled", "MEMORY_ENABLED", true),
    },
    webSearchProvidersDir: str("webSearch.providersDir", "WEB_SEARCH_PROVIDERS_DIR", "src/web-search-providers"),
    webSearchProviderNames: list("webSearch.providerNames", "WEB_SEARCH_PROVIDERS", "duckduckgo"),
    data: file,
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

function parseReplyMode(value: string | undefined): "message" | "xml" {
  if (value === "message") {
    return "message";
  }

  return "xml";
}
