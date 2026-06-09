import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROVIDERS_DIR = "src/providers";
export const PLUGINS_DIR = "src/plugins";
export const PLATFORMS_DIR = "src/platforms";
export const WEB_SEARCH_DIR = "src/web-search-providers";
export const CONFIG_FILE = "missy.config.json";

export const DEFAULT_PROVIDER = "mistral";
export const DEFAULT_PLATFORMS = ["discord"];
export const DEFAULT_WEB_SEARCH = ["brave"];
export const DEFAULT_REPLY_MODE = "message";

export interface ConfigField {
  key: string;
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "select";
  required?: boolean;
  secret?: boolean;
  default?: string | number | boolean;
  options?: string[];
}

export interface ConfigSchema {
  module: string;
  label: string;
  fields: ConfigField[];
}

export function scanModules(dir: string): string[] {
  const modules: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          statSync(join(dir, entry.name, "mod.ts"));
          modules.push(entry.name);
        } catch {
          // no mod.ts, skip
        }
      }
    }
  } catch {
    // dir missing
  }
  return modules.sort();
}

/**
 * Dynamically import a module and extract its configSchema (if any).
 */
export async function loadModuleSchema(dir: string, name: string): Promise<ConfigSchema | null> {
  const modPath = resolve(dir, name, "mod.ts");
  try {
    const moduleUrl = pathToFileURL(modPath).href;
    const mod = await import(moduleUrl);
    const exported = mod.default ?? mod;
    return exported.configSchema ?? null;
  } catch {
    return null;
  }
}

/**
 * Load all config schemas from all modules in a directory (only the named ones).
 */
export async function loadSchemas(dir: string, names: string[]): Promise<ConfigSchema[]> {
  const schemas: ConfigSchema[] = [];
  for (const name of names) {
    const schema = await loadModuleSchema(dir, name);
    if (schema) {
      schemas.push(schema);
    }
  }
  return schemas;
}

/**
 * Load existing config from file.
 */
export function loadExistingConfig(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const text = readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(text);
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

/**
 * Save config to file.
 */
export function saveConfig(config: Record<string, unknown>): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Get a value from a nested config object by dot-path.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value in a nested config object by dot-path.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
