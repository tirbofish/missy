export declare const PROVIDERS_DIR = "src/providers";
export declare const PLUGINS_DIR = "src/plugins";
export declare const PLATFORMS_DIR = "src/platforms";
export declare const WEB_SEARCH_DIR = "src/web-search-providers";
export declare const CONFIG_FILE = "missy.config.json";
export declare const DEFAULT_PROVIDER = "mistral";
export declare const DEFAULT_PLATFORMS: string[];
export declare const DEFAULT_WEB_SEARCH: string[];
export declare const DEFAULT_REPLY_MODE = "message";
export interface ConfigField {
    key: string;
    label: string;
    description?: string;
    type: "string" | "number" | "boolean" | "select";
    required?: boolean;
    secret?: boolean;
    hidden?: boolean;
    default?: string | number | boolean;
    options?: string[];
    env?: string;
    flag?: string;
    aliases?: string[];
}
export interface ConfigSchema {
    module: string;
    label: string;
    fields: ConfigField[];
}
export interface PackageBootstrap {
    metadata?: {
        name: string;
        description: string;
        version: string;
    };
    kind?: string;
    modulePath?: string;
    configSchema?: ConfigSchema;
}
export declare function scanModules(dir: string): string[];
/**
 * Dynamically import a module and extract its configSchema (if any).
 */
export declare function loadModuleSchema(dir: string, name: string): Promise<ConfigSchema | null>;
export declare function loadPackageBootstrap(path: string): Promise<PackageBootstrap | null>;
/**
 * Load all config schemas from all modules in a directory (only the named ones).
 */
export declare function loadSchemas(dir: string, names: string[]): Promise<ConfigSchema[]>;
/**
 * Load existing config from file.
 */
export declare function loadExistingConfig(): Record<string, unknown>;
/**
 * Save config to file.
 */
export declare function saveConfig(config: Record<string, unknown>): void;
/**
 * Get a value from a nested config object by dot-path.
 */
export declare function getNestedValue(obj: Record<string, unknown>, path: string): unknown;
/**
 * Set a value in a nested config object by dot-path.
 */
export declare function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void;
//# sourceMappingURL=utils.d.ts.map