import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "./logger.ts";
import type {
  AgentPlatform,
  PackageBootstrapModule,
  PackageKind,
  PlatformModule,
  PluginKeystore,
  PluginModule,
  ProviderModule,
  WebSearchProviderModule,
} from "./types.ts";
import { isRecord } from "./helpers.ts";

export async function discoverPlugins(
  pluginsDir: string,
  logger: Logger,
  keystore?: PluginKeystore,
  enabledPluginNames?: string[],
): Promise<PluginModule[]> {
  const modules = await loadPluginModules(
    pluginsDir,
    logger,
    keystore,
    enabledPluginNames,
  );
  return modules.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

export async function discoverPlatforms(
  platformsDir: string,
  enabledPlatforms: string[],
  logger: Logger,
): Promise<AgentPlatform[]> {
  const platforms: AgentPlatform[] = [];

  for (const platformName of enabledPlatforms) {
    const modPath = await resolvePackageModulePath(
      platformsDir,
      platformName,
      "platform",
      logger,
    );
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
  const resolvedPath = await resolvePackageModulePath(
    providersDir,
    providerName,
    "provider",
    logger,
  );
  const module = await loadModule<ProviderModule>(
    resolvedPath,
    "provider",
    logger,
  );
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
    const modPath = await resolvePackageModulePath(
      providersDir,
      providerName,
      "web-search-provider",
      logger,
    );
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

async function loadPluginModules(
  rootDir: string,
  logger: Logger,
  keystore?: PluginKeystore,
  enabledPluginNames?: string[],
): Promise<PluginModule[]> {
  const modules: PluginModule[] = [];
  const effectiveKeystore = keystore ?? inMemoryKeystore();
  const enabled = enabledPluginNames && enabledPluginNames.length > 0
    ? new Set(enabledPluginNames)
    : undefined;

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (enabled && !enabled.has(entry.name)) {
      continue;
    }

    const packageRoot = join(rootDir, entry.name);
    const packageBootstrap = await loadPackageBootstrap(
      packageRoot,
      entry.name,
      "plugin",
      logger,
    );

    if (packageBootstrap?.bootstrap) {
      const bootstrapped = await packageBootstrap.bootstrap({
        globalKeystore: effectiveKeystore,
        keystore: effectiveKeystore.namespace(entry.name),
        logger: logger.child(`plugin:${entry.name}`),
        pluginName: entry.name,
      });
      validatePluginModule(entry.name, bootstrapped);
      modules.push(bootstrapped);
      continue;
    }

    const modPath = packageBootstrap
      ? join(packageRoot, packageBootstrap.modulePath ?? "src/mod.ts")
      : join(packageRoot, "mod.ts");
    const module = await loadModule<PluginModule>(modPath, "plugin", logger);
    if (!module) {
      logger.debug(
        `Skipping plugin folder without bootstrap.ts or mod.ts: ${entry.name}`,
      );
      continue;
    }

    logger.warn(
      `Plugin ${entry.name} has no bootstrap.ts; falling back to mod.ts.`,
    );
    validatePluginModule(entry.name, module);
    modules.push(module);
  }

  return modules;
}

async function resolvePackageModulePath(
  rootDir: string,
  packageName: string,
  kind: PackageKind,
  logger: Logger,
): Promise<string> {
  const packageRoot = join(rootDir, packageName);
  const bootstrap = await loadPackageBootstrap(
    packageRoot,
    packageName,
    kind,
    logger,
  );
  return bootstrap
    ? join(packageRoot, bootstrap.modulePath ?? "src/mod.ts")
    : join(packageRoot, "mod.ts");
}

async function loadPackageBootstrap(
  packageRoot: string,
  packageName: string,
  expectedKind: PackageKind,
  logger: Logger,
): Promise<PackageBootstrapModule | undefined> {
  const bootstrapPath = join(packageRoot, "bootstrap.ts");
  try {
    statSync(bootstrapPath);
  } catch {
    return undefined;
  }

  const imported = await import(pathToFileURL(bootstrapPath).href);
  const bootstrapModule = (imported.default ?? imported.module) as
    | PackageBootstrapModule
    | undefined;
  if (!bootstrapModule?.metadata || !bootstrapModule.kind) {
    logger.warn(
      `Skipping package bootstrap without metadata/kind: ${bootstrapPath}`,
    );
    return undefined;
  }

  if (bootstrapModule.kind !== expectedKind) {
    throw new Error(
      `Package ${packageName} declared kind ${bootstrapModule.kind}; expected ${expectedKind}.`,
    );
  }
  if (bootstrapModule.metadata.name !== packageName) {
    throw new Error(
      `Package folder ${packageName} exported ${bootstrapModule.metadata.name}. Names must match.`,
    );
  }

  return bootstrapModule;
}

function inMemoryKeystore(
  data: Record<string, unknown> = {},
  prefix: string[] = [],
): PluginKeystore {
  const container = (create: boolean): Record<string, unknown> | undefined => {
    let current = data;
    for (const part of prefix) {
      const existing = current[part];
      if (!isRecord(existing)) {
        if (!create) {
          return undefined;
        }
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    return current;
  };

  return {
    get<T = unknown>(key: string): T | undefined {
      return container(false)?.[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      container(true)![key] = value;
    },
    async delete(key: string): Promise<boolean> {
      const scoped = container(false);
      if (!scoped || !(key in scoped)) {
        return false;
      }
      delete scoped[key];
      return true;
    },
    entries(): Record<string, unknown> {
      return { ...(container(false) ?? {}) };
    },
    namespace(name: string): PluginKeystore {
      const cleanName = name.trim();
      if (!cleanName) {
        throw new Error("Keystore namespace name cannot be empty.");
      }
      return inMemoryKeystore(data, [...prefix, cleanName]);
    },
  };
}

function validatePluginModule(folderName: string, module: PluginModule): void {
  if (module.metadata.name !== folderName) {
    throw new Error(
      `Plugin folder ${folderName} exported ${module.metadata.name}. Names must match.`,
    );
  }
}

async function loadModule<T>(
  modPath: string,
  kind: string,
  logger: Logger,
): Promise<T | undefined> {
  try {
    statSync(modPath);
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
