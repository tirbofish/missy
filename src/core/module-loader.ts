import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "./logger.ts";
import type {
  AgentPlatform,
  PlatformModule,
  PluginModule,
  ProviderModule,
  WebSearchProviderModule,
} from "./types.ts";

export async function discoverPlugins(
  pluginsDir: string,
  logger: Logger,
): Promise<PluginModule[]> {
  const modules = await loadModules<PluginModule>(pluginsDir, "plugin", logger);
  return modules.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

export async function discoverPlatforms(
  platformsDir: string,
  enabledPlatforms: string[],
  logger: Logger,
): Promise<AgentPlatform[]> {
  const platforms: AgentPlatform[] = [];

  for (const platformName of enabledPlatforms) {
    const modPath = join(platformsDir, platformName, "mod.ts");
    const module = await loadModule<PlatformModule>(
      modPath,
      "platform",
      logger,
    );
    if (!module) {
      throw new Error(`Enabled platform was not found: ${platformName}`);
    }

    if (module.metadata.name !== platformName) {
      throw new Error(
        `Platform folder ${platformName} exported ${module.metadata.name}. Names must match.`,
      );
    }

    platforms.push(module.createPlatform());
  }

  return platforms;
}

export async function discoverProvider(
  providersDir: string,
  providerName: string,
  logger: Logger,
): Promise<ProviderModule> {
  const modPath = join(providersDir, providerName, "mod.ts");
  const module = await loadModule<ProviderModule>(modPath, "provider", logger);
  if (!module) {
    throw new Error(`AI provider was not found: ${providerName}`);
  }

  if (module.metadata.name !== providerName) {
    throw new Error(
      `Provider folder ${providerName} exported ${module.metadata.name}. Names must match.`,
    );
  }

  return module;
}

export async function discoverProviders(
  providersDir: string,
  providerNames: string[],
  logger: Logger,
): Promise<ProviderModule[]> {
  const providers: ProviderModule[] = [];

  for (const providerName of providerNames) {
    providers.push(await discoverProvider(providersDir, providerName, logger));
  }

  return providers;
}

export async function discoverWebSearchProviders(
  providersDir: string,
  providerNames: string[],
  logger: Logger,
): Promise<WebSearchProviderModule[]> {
  const providers: WebSearchProviderModule[] = [];

  for (const providerName of providerNames) {
    const modPath = join(providersDir, providerName, "mod.ts");
    const module = await loadModule<WebSearchProviderModule>(
      modPath,
      "web-search-provider",
      logger,
    );
    if (!module) {
      throw new Error(`Web search provider was not found: ${providerName}`);
    }

    if (module.metadata.name !== providerName) {
      throw new Error(
        `Web search provider folder ${providerName} exported ${module.metadata.name}. Names must match.`,
      );
    }

    providers.push(module);
  }

  return providers;
}

async function loadModules<T>(
  rootDir: string,
  kind: string,
  logger: Logger,
): Promise<T[]> {
  const modules: T[] = [];

  for await (const entry of Deno.readDir(rootDir)) {
    if (!entry.isDirectory) {
      continue;
    }

    const modPath = join(rootDir, entry.name, "mod.ts");
    const module = await loadModule<T>(modPath, kind, logger);
    if (!module) {
      logger.debug(`Skipping ${kind} folder without mod.ts: ${entry.name}`);
      continue;
    }

    modules.push(module);
  }

  return modules;
}

async function loadModule<T>(
  modPath: string,
  kind: string,
  logger: Logger,
): Promise<T | undefined> {
  try {
    await Deno.stat(modPath);
  } catch {
    return undefined;
  }

  const imported = await import(pathToFileURL(modPath).href);
  const module = (imported.default ?? imported.module) as T | undefined;
  if (!module) {
    logger.warn(`Skipping ${kind} without default export: ${modPath}`);
  }

  return module;
}
