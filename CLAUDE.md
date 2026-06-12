# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime & Commands

This is a **Bun** runtime project with a Deno-compatible `deno.json` for dependency management. The primary entry points use Bun:

```bash
bun run dev          # Watch mode: bootstrap.ts start
bun run start        # Launch: bootstrap.ts start
bun run status       # Check readiness: bun bootstrap.ts status
bun run test         # Run all Bun tests
bun run check        # TypeScript type-check only (no emit)
bun run setup        # Interactive CLI setup: bun bin/dev.js interactive
```

Run a single test file:

```bash
bun test src/core/memory_test.ts
```

The interactive setup wizard writes `missy.config.json` and is also available via the oclif CLI:

```bash
bun bin/dev.js interactive
bun bin/dev.js start --provider=mistral
bun bin/dev.js status
```

## Architecture

Missy is a **dynamically-loaded modular AI agent**. The core runtime (`src/core/app.ts`) is small, with all provider, platform, and plugin functionality loaded at startup from directories on disk.

### Startup Flow

1. `bootstrap.ts` discovers all `bootstrap.ts` files across `src/` subdirectories to gather config schemas, CLI flags, and env var mappings.
2. `bootstrap.ts` calls `AgentApp.start(): Promise<void>`, which in order:
   - Loads personality XML
   - Loads memory store and keystore from disk
   - Discovers and registers AI providers
   - Builds the `AgentContext` (shared context object passed to everything)
   - Starts platforms (Discord/Matrix) so their services are available to plugins
   - Loads and sets up plugins (tools, memory, web search, etc.)
3. Platforms listen for messages and call `AgentApp.handleMessage(message: InboundMessage): Promise<void>`.

### Message Handling Pipeline

```
InboundMessage
  → inferMemoryUpdates(content: string): MemoryUpdate[]   (regex location patterns)
  → AiProvider.generate(request: AiGenerateRequest): Promise<string>
  → tryParseAgentOutputXml(xml: string): AgentOutputParseResult
  → ToolRegistry.execute(name: string, input: unknown, context: ToolExecutionContext): Promise<unknown>
  → AiProvider.generate(...)   (finalize with tool results)
  → message.reply(content: string): Promise<void>
```

- The model is instructed to return `<agent>` XML with `<message>`, `<memory_updates>`, and `<tool_calls>`.
- If XML parsing fails, the app asks the AI to repair its output once. If that also fails, it falls back to treating the raw text as the reply.
- Multiple `<message>` elements are joined with `|||` for multi-bubble replies.
- Memory updates from both regex inference and model output are persisted after the turn.

### Package System

Every module outside `src/core` is a **package** with this structure:

```
src/{category}/{name}/bootstrap.ts   # PackageBootstrapModule export (metadata, kind, configSchema, bootstrap fn)
src/{category}/{name}/package.json
src/{category}/{name}/src/mod.ts     # The actual module implementation
src/{category}/{name}/mod.ts         # Re-export shim
```

**Package kinds:** `provider`, `platform`, `plugin`, `web-search-provider`.

The `bootstrap.ts` declares the package's `kind: PackageKind`, `metadata: ModuleMetadata` (name/description/version), `configSchema?: ConfigSchema` (fields with env var and CLI flag mappings), and an optional `bootstrap(context: PluginBootstrapContext): Promise<PluginModule> | PluginModule` function that receives a per-package scoped keystore.

**Critical naming rule:** The folder name, `bootstrap.metadata.name`, and the exported module's `metadata.name` must all match exactly. The module loader enforces this at startup.

### Key Types (`src/core/types.ts`)

| Type | Shape |
|------|-------|
| `AgentContext` | `{ ai: AiProvider; config: AppConfig; handleMessage(m: InboundMessage): Promise<void>; keystore: PluginKeystore; logger: Logger; memory: MemoryStore; personality: Personality; platformServices: PlatformServiceRegistry; plugins: ModuleMetadata[]; providers: ProviderRegistry; tools: ToolRegistry }` |
| `AiProvider` | `{ generate(request: AiGenerateRequest): Promise<string> }` |
| `AiGenerateRequest` | `{ instructions: string; input: string; images?: AiImage[] }` |
| `InboundMessage` | `{ id: string; platform: string; channelId: string; authorId: string; content: string; attachments?: MessageAttachment[]; context?: ConversationMessage[]; replyTo?: InboundMessageReference; reply(content: string): Promise<void>; timestamp?: number; ... }` |
| `PluginModule` | `{ metadata: ModuleMetadata; configSchema?: ConfigSchema; setup(context: AgentContext): Promise<void> \| void }` |
| `PluginBootstrapContext` | `{ globalKeystore: PluginKeystore; keystore: PluginKeystore; logger: Logger; pluginName: string }` |
| `ProviderModule` | `{ metadata: ModuleMetadata; configSchema?: ConfigSchema; createProvider(config: Record<string, unknown>): AiProvider }` |
| `PlatformModule` | `{ metadata: ModuleMetadata; configSchema?: ConfigSchema; createPlatform(): AgentPlatform }` |
| `AgentPlatform` | `{ name: string; start(context: AgentContext): Promise<void>; stop(): Promise<void>; getSystemContext?(): string }` |
| `WebSearchProviderModule` | `{ metadata: ModuleMetadata; configSchema?: ConfigSchema; createProvider(config: Record<string, unknown>): WebSearchProvider }` |
| `WebSearchProvider` | `{ name: string; search(request: WebSearchRequest): Promise<WebSearchProviderResult> }` |
| `AgentTool` | `{ name: string; description: string; inputSchema?: Record<string, unknown>; execute(input: unknown, context: ToolExecutionContext): Promise<unknown> \| unknown }` |
| `AgentOutput` | `{ message: string; memoryUpdates: MemoryUpdate[]; respond: boolean; toolCalls: ToolCall[] }` |
| `PluginKeystore` | `{ get<T>(key: string): T \| undefined; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<boolean>; entries(): Record<string, unknown>; namespace(name: string): PluginKeystore }` |
| `ConfigSchema` | `{ module: string; label: string; fields: ConfigField[] }` |
| `ConfigField` | `{ key: string; label: string; type: "string" \| "number" \| "boolean" \| "select"; required?: boolean; secret?: boolean; hidden?: boolean; default?: string \| number \| boolean; options?: string[]; env?: string; flag?: string; aliases?: string[]; ... }` |
| `PackageBootstrapModule` | `{ metadata: ModuleMetadata; kind: PackageKind; modulePath?: string; configSchema?: ConfigSchema; bootstrap?(context: PluginBootstrapContext): Promise<PluginModule> \| PluginModule }` |

### Config System

Configuration comes from three sources merged at startup: `missy.config.json` → environment variables → CLI flags. The `ConfigSchema` from each package declares which env var and CLI flag map to each config key. The interactive CLI wizard (`cli/commands/interactive.ts`) uses these schemas to prompt the user for all required fields.

### Key Files

| File | Purpose |
|------|---------|
| `bootstrap.ts` | Main entry point — discovers packages, builds config, starts `AgentApp` |
| `src/core/app.ts` | `AgentApp` class — `start(): Promise<void>`, `stop(): Promise<void>`, `handleMessage(message: InboundMessage): Promise<void>`. Also exports `inferMemoryUpdates(content: string): MemoryUpdate[]` |
| `src/core/config.ts` | `loadConfig(env?: Record<string, string>): AppConfig`, `getConfigValue(data: ConfigData, path: string): unknown` |
| `src/core/xml.ts` | `buildSystemInstructions(opts): string`, `buildConversationInput(m: InboundMessage, memory?: MemoryUpdate[]): string`, `buildFinalInput(opts): string`, `parseAgentOutputXml(xml: string): AgentOutput`, `tryParseAgentOutputXml(xml: string): AgentOutputParseResult`, `formatAgentOutputXml(o: AgentOutput): string` |
| `src/core/module-loader.ts` | `discoverPlugins(dir, logger, keystore?, names?): Promise<PluginModule[]>`, `discoverPlatforms(dir, names, logger): Promise<AgentPlatform[]>`, `discoverProviders(dir, names, logger): Promise<ProviderModule[]>`, `discoverWebSearchProviders(dir, names, logger): Promise<WebSearchProviderModule[]>` |
| `src/core/types.ts` | All shared TypeScript interfaces — no runtime code |
| `src/core/tool-registry.ts` | `ToolRegistry` class — `register(tool: AgentTool): void`, `list(): AgentTool[]`, `execute(name: string, input: unknown, context: ToolExecutionContext): Promise<unknown>` |
| `src/core/keystore.ts` | `FileKeystore` class — implements `PluginKeystore`. `load(): Promise<void>`, `get<T>(key: string): T \| undefined`, `set(key: string, value: unknown): Promise<void>`, `delete(key: string): Promise<boolean>`, `namespace(name: string): PluginKeystore` |
| `src/core/personality.ts` | `loadPersonality(path: string): Promise<Personality>` — reads `personality.xml` |
| `cli/commands/interactive.ts` | The interactive setup wizard (oclif command) |
| `cli/utils.ts` | `loadExistingConfig(): Record<string, unknown>`, `saveConfig(config): void`, `scanModules(dir: string): string[]`, `loadSchemas(dir, names): Promise<ConfigSchema[]>` |

### XML Output Contract

The model must always return valid `<agent>` XML. The XML parse is regex-based (not a proper XML parser) — changes to the contract format need corresponding updates to the regex patterns in `xml.ts`.

### Testing

Tests use **Bun's built-in test runner** (`bun:test`). Test files sit alongside their source files with a `_test.ts` suffix. Tests are integration-style — for example, `module-loader_test.ts` actually imports real plugin folders and verifies tool registration.
