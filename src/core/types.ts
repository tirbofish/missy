import type { AppConfig } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { MemoryStore } from "./memory-store.ts";
import type { PlatformServiceRegistry } from "./platform-service-registry.ts";
import type { Personality } from "./personality.ts";
import type { ProviderRegistry } from "./provider-registry.ts";
import type { ToolRegistry } from "./tool-registry.ts";

export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<string>;
}

export interface AiGenerateRequest {
  instructions: string;
  input: string;
}

export interface AgentContext {
  ai: AiProvider;
  config: AppConfig;
  handleMessage(message: InboundMessage): Promise<void>;
  keystore: PluginKeystore;
  logger: Logger;
  memory: MemoryStore;
  personality: Personality;
  platformServices: PlatformServiceRegistry;
  plugins: ModuleMetadata[];
  providers: ProviderRegistry;
  tools: ToolRegistry;
}

/** A named service that a platform exposes to plugins via the registry. */
export interface PlatformService {
  readonly platformName: string;
}

export interface ModuleMetadata {
  name: string;
  description: string;
  version: string;
}

export interface PluginModule {
  metadata: ModuleMetadata;
  configSchema?: ConfigSchema;
  setup(context: AgentContext): Promise<void> | void;
}

export interface PluginBootstrapContext {
  globalKeystore: PluginKeystore;
  keystore: PluginKeystore;
  logger: Logger;
  pluginName: string;
}

export interface PluginBootstrapModule {
  bootstrap(
    context: PluginBootstrapContext,
  ): Promise<PluginModule> | PluginModule;
}

export type PackageKind =
  | "provider"
  | "platform"
  | "plugin"
  | "web-search-provider"
  | "package";

export interface PackageBootstrapModule {
  metadata: ModuleMetadata;
  kind: PackageKind;
  modulePath?: string;
  configSchema?: ConfigSchema;
  bootstrap?(
    context: PluginBootstrapContext,
  ): Promise<PluginModule> | PluginModule;
}

export interface PluginKeystore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  entries(): Record<string, unknown>;
  namespace(name: string): PluginKeystore;
}

export interface ProviderModule {
  metadata: ModuleMetadata;
  configSchema?: ConfigSchema;
  createProvider(config: AppConfig): AiProvider;
}

export interface WebSearchProviderModule {
  metadata: ModuleMetadata;
  configSchema?: ConfigSchema;
  createProvider(config: AppConfig): WebSearchProvider;
}

export interface WebSearchProvider {
  name: string;
  search(request: WebSearchRequest): Promise<WebSearchProviderResult>;
  llmContext?(request: LlmContextRequest): Promise<LlmContextResult>;
}

export interface LlmContextRequest {
  query: string;
  maxTokens?: number;
  freshness?: string;
}

export interface LlmContextResult {
  provider: string;
  context: string;
  sources: { url: string; title: string; age?: string }[];
}

export interface WebSearchRequest {
  query: string;
  maxResults: number;
}

export interface WebSearchProviderResult {
  provider: string;
  results: WebSearchResult[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface PlatformModule {
  metadata: ModuleMetadata;
  configSchema?: ConfigSchema;
  createPlatform(): AgentPlatform;
}

export interface AgentPlatform {
  name: string;
  start(context: AgentContext): Promise<void>;
  stop(): Promise<void>;
}

export interface InboundMessage {
  id: string;
  platform: string;
  channelId: string;
  channelType?: string;
  guildId?: string;
  authorId: string;
  authorName?: string;
  content: string;
  context?: ConversationMessage[];
  replyTo?: InboundMessageReference;
  reply(content: string): Promise<void>;
}

export interface ConversationMessage {
  id: string;
  authorId: string;
  authorName?: string;
  content: string;
  isBot?: boolean;
}

export interface InboundMessageReference {
  id: string;
  authorId: string;
  authorName?: string;
  content: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> | unknown;
}

export interface ToolExecutionContext {
  logger: Logger;
  message: InboundMessage;
}

export interface AgentOutput {
  message: string;
  memoryUpdates: MemoryUpdate[];
  respond: boolean;
  toolCalls: ToolCall[];
}

export interface MemoryUpdate {
  key: string;
  value: string;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface ToolResult {
  name: string;
  ok: boolean;
  output: unknown;
}

// ─── Config Schema (modules declare what config they need) ───────────────────

export interface ConfigField {
  /** Unique key used in the config file (e.g. "openai.apiKey") */
  key: string;
  /** Human-readable label shown during setup */
  label: string;
  /** Description/help text */
  description?: string;
  /** Field type */
  type: "string" | "number" | "boolean" | "select";
  /** Whether this field is required */
  required?: boolean;
  /** Whether this field is a secret (masked during input) */
  secret?: boolean;
  /** Whether this field is hidden from interactive setup (uses default silently) */
  hidden?: boolean;
  /** Default value */
  default?: string | number | boolean;
  /** Options for "select" type */
  options?: string[];
  /** Environment variable that maps to this field */
  env?: string;
  /** CLI flag name used by bootstrap.ts for this field */
  flag?: string;
  /** Additional CLI flag aliases used by bootstrap.ts for this field */
  aliases?: string[];
}

export interface ConfigSchema {
  /** The module that owns these fields */
  module: string;
  /** Human-readable section name */
  label: string;
  /** Fields this module needs */
  fields: ConfigField[];
}
