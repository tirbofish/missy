import { AgentApp } from "./src/core/app.ts";
import { type AppConfig, loadConfig } from "./src/core/config.ts";
import { isRecord } from "./src/core/helpers.ts";
import { createLogger } from "./src/core/logger.ts";
import type {
  ConfigField,
  ConfigSchema,
  PackageBootstrapModule,
  PackageKind,
} from "./src/core/types.ts";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type Command = "start" | "status" | "help";

interface ParsedArgs {
  command: Command;
  env: Record<string, string>;
}

const ROOT_CONFIG_SCHEMA: ConfigSchema = {
  module: "core",
  label: "Missy Core",
  fields: [
    {
      key: "provider",
      label: "Default AI Provider",
      type: "string",
      env: "AI_PROVIDER",
      flag: "provider",
      aliases: ["ai-provider"],
    },
    {
      key: "providers",
      label: "Loaded AI Providers",
      type: "string",
      env: "AI_PROVIDERS",
      flag: "providers",
      aliases: ["ai-providers"],
    },
    {
      key: "providersDir",
      label: "Providers Directory",
      type: "string",
      env: "PROVIDERS_DIR",
      flag: "providers-dir",
    },
    {
      key: "platforms",
      label: "Enabled Platforms",
      type: "string",
      env: "PLATFORMS",
      flag: "platforms",
    },
    {
      key: "platformsDir",
      label: "Platforms Directory",
      type: "string",
      env: "PLATFORMS_DIR",
      flag: "platforms-dir",
    },
    {
      key: "plugins",
      label: "Enabled Plugins",
      type: "string",
      env: "PLUGINS",
      flag: "plugins",
    },
    {
      key: "pluginsDir",
      label: "Plugins Directory",
      type: "string",
      env: "PLUGINS_DIR",
      flag: "plugins-dir",
    },
    {
      key: "replyMode",
      label: "Reply Mode",
      type: "select",
      options: ["xml", "message"],
      env: "AGENT_REPLY_MODE",
      flag: "reply-mode",
    },
    {
      key: "personalityPath",
      label: "Personality XML Path",
      type: "string",
      env: "PERSONALITY_PATH",
      flag: "personality",
    },
    {
      key: "keystore.path",
      label: "Plugin Keystore Path",
      type: "string",
      env: "KEYSTORE_PATH",
      flag: "keystore-path",
    },
    {
      key: "keystore.enabled",
      label: "Plugin Keystore Enabled",
      type: "boolean",
      env: "KEYSTORE_ENABLED",
      flag: "keystore-enabled",
    },
    {
      key: "webSearch.providersDir",
      label: "Web Search Providers Directory",
      type: "string",
      env: "WEB_SEARCH_PROVIDERS_DIR",
      flag: "web-search-providers-dir",
    },
    {
      key: "webSearch.providerNames",
      label: "Web Search Providers",
      type: "string",
      env: "WEB_SEARCH_PROVIDERS",
      flag: "web-search-providers",
    },
  ],
};

if (import.meta.main) {
  // Pre-flight: install npm dependencies for enabled packages before
  // we import their bootstrap.ts files (which may require those deps).
  await installPackageDependencies("missy.config.json", "src");

  const packageBootstraps = await discoverPackageBootstraps("src");
  const schemas = [
    ROOT_CONFIG_SCHEMA,
    ...packageBootstraps.flatMap((item) =>
      item.configSchema ? [item.configSchema] : []
    ),
  ];
  const parsed = parseArgs(process.argv.slice(2), buildFlagEnv(schemas));

  if (parsed.command === "help") {
    printHelp(schemas);
    process.exit(0);
  }

  // Ensure missy.config.json exists before attempting to start
  try {
    statSync("missy.config.json");
  } catch {
    console.error(
      "\x1b[33mNo missy.config.json found.\x1b[0m Run the interactive setup first:\n" +
      "  bun run setup\n" +
      "  # or: bun bin/dev.js\n",
    );
    process.exit(1);
  }

  const env = { ...process.env, ...parsed.env } as Record<string, string>;
  const config = loadConfig(env);

  if (parsed.command === "status") {
    await printStatus(config, env, packageBootstraps);
    process.exit(0);
  }

  const logger = createLogger("bootstrap");
  const app = new AgentApp(config, logger);

  const cleanup = () => {
    app.stop().catch((error) => logger.error("Failed to stop cleanly", error));
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", cleanup);

  const setupStartedAt = performance.now();
  await app.start();
  const timeToSetupMs = Math.round(performance.now() - setupStartedAt);
  console.log(`\x1b[32mReady! time=${timeToSetupMs}ms\x1b[0m`);
}

function parseArgs(
  args: string[],
  flagEnv: Record<string, string>,
): ParsedArgs {
  const env: Record<string, string> = {};
  let command: Command = "start";

  for (const arg of args) {
    if (arg === "--") continue;

    if (arg === "start" || arg === "status" || arg === "help") {
      command = arg;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }

    if (arg.startsWith("--set=")) {
      const assignment = arg.slice("--set=".length);
      const separator = assignment.indexOf("=");
      if (separator < 1) {
        throw new Error("--set expects KEY=VALUE.");
      }
      env[assignment.slice(0, separator)] = assignment.slice(separator + 1);
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown command or argument: ${arg}`);
    }

    const [rawName, ...valueParts] = arg.slice(2).split("=");
    const envName = flagEnv[rawName];
    if (!envName) {
      throw new Error(`Unknown flag: --${rawName}`);
    }
    env[envName] = valueParts.join("=");
  }

  return { command, env };
}

async function printStatus(
  config: AppConfig,
  env: Record<string, string>,
  packageBootstraps: PackageBootstrapModule[],
): Promise<void> {
  const requiredFieldChecks = requiredPackageFields(config, packageBootstraps)
    .map((field) =>
      keyCheck(
        field.env ?? field.key,
        stringValue(getConfigPath(config, field.key)) ?? env[field.env ?? ""],
        true,
      )
    );
  const checks = [
    await fileCheck("personality", config.personalityPath),
    ...await folderModuleChecks("plugin", config.pluginsDir),
    ...await namedModuleChecks(
      "AI provider",
      config.providersDir,
      config.providerNames,
    ),
    ...await namedModuleChecks(
      "platform",
      config.platformsDir,
      config.enabledPlatforms,
    ),
    ...await namedModuleChecks(
      "web search provider",
      config.webSearchProvidersDir,
      config.webSearchProviderNames,
    ),
    ...requiredFieldChecks,
  ];

  console.log("Missy bootstrap status");
  console.log("");
  console.log(`Default AI provider: ${config.providerName}`);
  console.log(
    `Loaded AI providers: ${config.providerNames.join(", ") || "(none)"}`,
  );
  console.log(`Platforms: ${config.enabledPlatforms.join(", ") || "(none)"}`);
  console.log(`Plugins: ${config.pluginNames.join(", ") || "all"}`);
  console.log(
    `Web search providers: ${
      config.webSearchProviderNames.join(", ") || "(none)"
    }`,
  );
  console.log(`Reply mode: ${config.replyMode}`);
  console.log(
    `Keystore: ${config.keystore.enabled ? "enabled" : "disabled"} (${
      config.keystore.path
    })`,
  );
  console.log("");

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"}  ${check.label}`);
  }
}

async function fileCheck(label: string, path: string): Promise<StatusCheck> {
  try {
    const s = statSync(path);
    return { label: `${label}: ${path}`, ok: s.isFile() };
  } catch {
    return { label: `${label}: ${path}`, ok: false };
  }
}

async function folderModuleChecks(
  kind: string,
  folder: string,
): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];
  try {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      checks.push(
        await fileCheck(
          `${kind} module ${entry.name}`,
          `${folder}/${entry.name}/bootstrap.ts`,
        ),
      );
    }
  } catch {
    checks.push({ label: `${kind} folder: ${folder}`, ok: false });
  }
  return checks;
}

async function namedModuleChecks(
  kind: string,
  folder: string,
  names: string[],
): Promise<StatusCheck[]> {
  return await Promise.all(
    names.map((name) =>
      fileCheck(`${kind} ${name}`, `${folder}/${name}/bootstrap.ts`)
    ),
  );
}

function keyCheck(
  name: string,
  value: string | undefined,
  required: boolean,
): StatusCheck {
  return {
    label: `${name}${required ? " required" : " optional"}`,
    ok: !required || Boolean(value),
  };
}

function printHelp(schemas: ConfigSchema[]): void {
  const flags = schemas
    .flatMap((schema) => schema.fields)
    .filter((field) => field.env)
    .flatMap((field) => [
      field.flag ?? envToFlag(field.env!),
      ...(field.aliases ?? []),
    ])
    .sort();

  console.log(`Missy bootstrap (Bun runtime)

Usage:
  bun run start                 Start Missy with defaults/env
  bun run status                Print readiness status

Flags:
${flags.map((flag) => `  --${flag}=<value>`).join("\n")}
  --set=KEY=VALUE                Override any environment variable

For the interactive setup wizard, use the oclif CLI:
  bun bin/dev.js
  bun bin/dev.js interactive
  bun bin/dev.js start --provider=mistral --model=mistral-large-latest
  bun bin/dev.js status
`);
}

interface StatusCheck {
  label: string;
  ok: boolean;
}

async function discoverPackageBootstraps(
  rootDir: string,
): Promise<PackageBootstrapModule[]> {
  const bootstraps: PackageBootstrapModule[] = [];
  await collectPackageBootstraps(rootDir, bootstraps);
  return bootstraps;
}

async function collectPackageBootstraps(
  dir: string,
  bootstraps: PackageBootstrapModule[],
): Promise<void> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "core" || entry.name === "src") {
      continue;
    }

    const bootstrapPath = join(p, "bootstrap.ts");
    let hasBootstrap = false;
    try {
      const s = statSync(bootstrapPath);
      if (s.isFile()) {
        hasBootstrap = true;
      }
    } catch {
      // Not a package root; keep looking below.
    }

    if (hasBootstrap) {
      const imported = await import(pathToFileURL(bootstrapPath).href);
      const bootstrap = (imported.default ?? imported) as
        | PackageBootstrapModule
        | undefined;
      if (bootstrap?.metadata && bootstrap.kind) {
        bootstraps.push(bootstrap);
        continue;
      }
    }

    await collectPackageBootstraps(p, bootstraps);
  }
}

/**
 * Read enabled platform/provider names from missy.config.json, scan their
 * package.json files for npm dependencies, and install any that are missing
 * from node_modules.  This keeps the root package.json lean — only the
 * packages needed by currently-enabled modules are installed.
 */
async function installPackageDependencies(
  configPath: string,
  srcDir: string,
): Promise<void> {
  // 1. Read enabled names from config
  let enabledNames: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const platforms = asStringArray(raw["platforms"]);
    const providers = asStringArray(raw["providers"]);
    const plugins = asStringArray(raw["plugins"]);
    const webSearch = asStringArray(
      isRecord(raw["webSearch"]) ? raw["webSearch"]["providerNames"] : undefined,
    );
    enabledNames = [...platforms, ...providers, ...plugins, ...webSearch];
  } catch {
    // Config may not exist yet (e.g. first-time setup); skip install.
    return;
  }

  if (enabledNames.length === 0) return;

  // 2. Walk src/ subdirectories to find package.json for each enabled name
  const categories = ["platforms", "providers", "plugins", "web-search-providers"];
  const neededPackages = new Set<string>();

  for (const category of categories) {
    const catDir = join(srcDir, category);
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = readdirSync(catDir, { withFileTypes: true }) as unknown as typeof entries;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!enabledNames.includes(entry.name)) continue;

      const pkgJsonPath = join(catDir, entry.name, "package.json");
      let pkgJson: Record<string, unknown>;
      try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      } catch {
        continue;
      }
      const deps = pkgJson["dependencies"];
      if (!isRecord(deps)) continue;
      for (const dep of Object.keys(deps)) {
        neededPackages.add(dep);
      }
    }
  }

  if (neededPackages.size === 0) return;

  // 3. Check which packages are missing from node_modules
  const missing: string[] = [];
  for (const pkg of neededPackages) {
    // Scoped packages: @scope/name → node_modules/@scope/name
    const modPath = pkg.startsWith("@")
      ? join("node_modules", pkg.replace("/", sep))
      : join("node_modules", pkg);
    if (!existsSync(modPath)) {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) return;

  // 4. Install missing packages
  console.log(
    `\x1b[36mInstalling ${missing.length} missing package(s) for enabled modules…\x1b[0m\n` +
    missing.map((p) => `  + ${p}`).join("\n"),
  );

  const result = spawnSync("bun", ["add", ...missing], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    console.error(
      `\x1b[31mFailed to install packages: ${missing.join(", ")}\x1b[0m`,
    );
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string") as string[];
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function buildFlagEnv(schemas: ConfigSchema[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const field of schemas.flatMap((schema) => schema.fields)) {
    if (!field.env) {
      continue;
    }

    flags[field.flag ?? envToFlag(field.env)] = field.env;
    for (const alias of field.aliases ?? []) {
      flags[alias] = field.env;
    }
  }
  return flags;
}

function envToFlag(envName: string): string {
  return envName.toLowerCase().replaceAll("_", "-");
}

function requiredPackageFields(
  config: AppConfig,
  bootstraps: PackageBootstrapModule[],
): ConfigField[] {
  const enabledNames = new Set([
    ...config.providerNames,
    ...config.enabledPlatforms,
    ...config.webSearchProviderNames,
    ...(config.pluginNames.length > 0
      ? config.pluginNames
      : bootstraps
        .filter((item) => item.kind === "plugin")
        .map((item) => item.metadata.name)),
  ]);

  return bootstraps
    .filter((item) => enabledNames.has(item.metadata.name))
    .flatMap((item) => item.configSchema?.fields ?? [])
    .filter((field) => field.required);
}

function getConfigPath(config: AppConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config.data;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return undefined;
}
