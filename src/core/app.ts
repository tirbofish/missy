import { type AppConfig, loadConfig } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { loadPersonality } from "./personality.ts";
import {
  discoverPlatforms,
  discoverPlugins,
  discoverProviders,
} from "./module-loader.ts";
import { FileKeystore } from "./keystore.ts";
import { MemoryStore } from "./memory-store.ts";
import { PlatformServiceRegistry } from "./platform-service-registry.ts";
import { ProviderRegistry } from "./provider-registry.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type {
  AgentContext,
  AgentOutput,
  AgentPlatform,
  AiImage,
  InboundMessage,
  MemoryUpdate,
  ToolCall,
  ToolResult,
} from "./types.ts";
import {
  buildConversationInput,
  buildFinalInput,
  buildSystemInstructions,
  fallbackAgentOutput,
  formatAgentOutputXml,
  formatToolResultsXml,
  tryParseAgentOutputXml,
} from "./xml.ts";

export class AgentApp {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly tools = new ToolRegistry();

  #platforms: AgentPlatform[] = [];
  #platformContexts = new Map<string, string>();
  #memory?: MemoryStore;
  #keystore?: FileKeystore;
  #plugins: AgentContext["plugins"] = [];
  #providers?: ProviderRegistry;
  #context?: AgentContext;
  #started = false;

  constructor(config = loadConfig(), logger = createLogger("agent")) {
    this.config = config;
    this.logger = logger;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    const personality = await loadPersonality(this.config.personalityPath);
    this.#memory = new MemoryStore(
      this.config.memory.path,
      this.config.memory.enabled,
    );
    await this.#memory.load();

    this.#keystore = new FileKeystore(
      this.config.keystore.path,
      this.config.keystore.enabled,
    );
    await this.#keystore.load();

    this.#providers = new ProviderRegistry(this.config.providerName);
    const providerModules = await discoverProviders(
      this.config.providersDir,
      this.config.providerNames,
      this.logger,
    );

    for (const providerModule of providerModules) {
      this.#providers.register(
        providerModule.metadata.name,
        providerModule.createProvider(this.config.data),
      );
      this.logger.info(`Loaded AI provider ${providerModule.metadata.name}`);
    }

    const ai = this.#providers.default();

    this.#context = {
      ai,
      config: this.config,
      logger: this.logger,
      memory: this.#memory,
      personality,
      platformServices: new PlatformServiceRegistry(),
      plugins: this.#plugins,
      providers: this.#providers,
      tools: this.tools,
      handleMessage: (message) => this.handleMessage(message),
      keystore: this.#keystore,
    };

    // Platforms start first so their services are available to plugins
    this.#platforms = await discoverPlatforms(
      this.config.platformsDir,
      this.config.enabledPlatforms,
      this.logger,
    );

    for (const platform of this.#platforms) {
      await platform.start(this.#context);
      if (platform.getSystemContext) {
        this.#platformContexts.set(
          platform.name,
          platform.getSystemContext(),
        );
      }
      this.logger.info(`Started platform ${platform.name}`);
    }

    const plugins = await discoverPlugins(
      this.config.pluginsDir,
      this.logger,
      this.#keystore,
      this.config.pluginNames.length > 0 ? this.config.pluginNames : undefined,
    );
    for (const plugin of plugins) {
      await plugin.setup(this.#context);
      this.#plugins.push(plugin.metadata);
      this.logger.info(`Loaded plugin ${plugin.metadata.name}`);
    }

    this.#started = true;
  }

  async stop(): Promise<void> {
    await Promise.allSettled(
      this.#platforms.map((platform) => platform.stop()),
    );
    this.#platforms = [];
    this.#started = false;
  }

  async handleMessage(message: InboundMessage): Promise<void> {
    if (!this.#context) {
      throw new Error("AgentApp has not been started.");
    }

    const system = buildSystemInstructions({
      personalityXml: this.#context.personality.xml,
      tools: this.tools.list(),
      platformContext: this.#platformContexts.get(message.platform),
    });

    const inferredMemory = inferMemoryUpdates(message.content);
    await this.#context.memory.applyUserUpdates(
      message.authorId,
      inferredMemory,
      message.id,
    ).catch((e) => this.logger.warn("Memory update failed (pre)", e));

    const userMemory = this.#context.memory.getUserMemory(message.authorId);
    const images = extractImages(message);

    const firstOutput = await this.#context.ai.generate({
      instructions: system,
      input: buildConversationInput(message, userMemory),
      images,
    });

    const parsed = await this.#parseOrRepairOutput(system, firstOutput);
    const finalOutput = parsed.toolCalls.length > 0
      ? await this.#runToolsAndFinalize(
        system,
        message,
        parsed,
        firstOutput,
        userMemory,
      )
      : parsed;

    await this.#context.memory.applyUserUpdates(
      message.authorId,
      uniqueMemoryUpdates([
        ...inferredMemory,
        ...parsed.memoryUpdates,
        ...finalOutput.memoryUpdates,
      ]),
      message.id,
    ).catch((e) => this.logger.warn("Memory update failed (post)", e));

    if (finalOutput.respond && finalOutput.message.trim()) {
      await message.reply(this.#formatReply(finalOutput));
    }
  }

  async #runToolsAndFinalize(
    system: string,
    message: InboundMessage,
    firstParsed: AgentOutput,
    firstRawXml: string,
    userMemory: MemoryUpdate[],
  ): Promise<AgentOutput> {
    if (!this.#context) {
      throw new Error("AgentApp has not been started.");
    }

    const results: ToolResult[] = [];
    for (const call of firstParsed.toolCalls) {
      results.push(await this.#executeToolCall(call, message));
    }

    const images = extractImages(message);

    const finalRawXml = await this.#context.ai.generate({
      instructions: system,
      input: buildFinalInput({
        message,
        memory: userMemory,
        previousAssistantXml: firstRawXml,
        toolResultsXml: formatToolResultsXml(results),
      }),
      images,
    });

    return await this.#parseOrRepairOutput(system, finalRawXml);
  }

  async #parseOrRepairOutput(
    system: string,
    rawOutput: string,
  ): Promise<AgentOutput> {
    if (!this.#context) {
      throw new Error("AgentApp has not been started.");
    }

    const firstParse = tryParseAgentOutputXml(rawOutput);
    if (firstParse.ok && firstParse.output) {
      return firstParse.output;
    }

    this.logger.warn("AI returned invalid XML; requesting repair", {
      error: firstParse.error,
      outputPreview: previewModelOutput(rawOutput),
    });

    if (!rawOutput.trim()) {
      this.logger.warn("AI returned empty output; skipping repair attempt");
      return fallbackAgentOutput(rawOutput);
    }

    try {
      const repaired = await this.#context.ai.generate({
        instructions: [
          system,
          "<repair_instruction>",
          "Convert the invalid assistant output into the required <agent> XML only.",
          "Do not add markdown fences or explanation.",
          "Preserve the user-facing answer as <message> when possible.",
          "</repair_instruction>",
        ].join("\n"),
        input: [
          "<invalid_assistant_output>",
          rawOutput,
          "</invalid_assistant_output>",
        ].join("\n"),
      });

      const repairedParse = tryParseAgentOutputXml(repaired);
      if (repairedParse.ok && repairedParse.output) {
        return repairedParse.output;
      }

      this.logger.warn("AI XML repair failed; falling back to plain message", {
        error: repairedParse.error,
        originalOutputPreview: previewModelOutput(rawOutput),
        repairedOutputPreview: previewModelOutput(repaired),
      });
    } catch (error) {
      this.logger.warn("AI XML repair request failed; falling back", error);
    }

    return fallbackAgentOutput(rawOutput);
  }

  async #executeToolCall(
    call: ToolCall,
    message: InboundMessage,
  ): Promise<ToolResult> {
    if (!this.#context) {
      throw new Error("AgentApp has not been started.");
    }

    try {
      const output = await this.tools.execute(call.name, call.input, {
        logger: this.logger.child(`tool:${call.name}`),
        message,
      });
      return { name: call.name, ok: true, output };
    } catch (error) {
      this.logger.error(`Tool failed: ${call.name}`, error);
      return {
        name: call.name,
        ok: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #formatReply(output: AgentOutput): string {
    if (this.config.replyMode === "message") {
      return output.message;
    }

    return formatAgentOutputXml(output);
  }
}

function uniqueMemoryUpdates(updates: MemoryUpdate[]): MemoryUpdate[] {
  const byKey = new Map<string, MemoryUpdate>();
  for (const update of updates) {
    byKey.set(update.key, update);
  }

  return [...byKey.values()];
}

export function inferMemoryUpdates(content: string): MemoryUpdate[] {
  const updates: MemoryUpdate[] = [];
  const locationPatterns = [
    /\bi live in\s+([^,.!?;]+)/i,
    /\bi am in\s+([^,.!?;]+)/i,
    /\bi'm in\s+([^,.!?;]+)/i,
    /\bmy location is\s+([^,.!?;]+)/i,
  ];

  for (const pattern of locationPatterns) {
    const match = pattern.exec(content);
    if (match?.[1]) {
      updates.push({
        key: "location",
        value: normalizeMemoryValue(match[1]),
      });
      break;
    }
  }

  return updates;
}

function normalizeMemoryValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Filter message attachments down to images with accessible URLs.
 * Only returns attachments whose content type starts with "image/"
 * and that have a URL (Discord CDN, resolved Matrix mxc, etc.).
 */
function extractImages(message: InboundMessage): AiImage[] {
  return (message.attachments ?? [])
    .filter((a) => a.url && a.contentType?.startsWith("image/"))
    .map((a) => ({ url: a.url!, contentType: a.contentType }));
}

function previewModelOutput(output: string, maxLength = 1200): string {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}
