import { AgentApp } from "./src/core/app.ts";
import { type AppConfig, loadConfig } from "./src/core/config.ts";
import { createLogger } from "./src/core/logger.ts";

type Command = "start" | "status" | "help";

interface ParsedArgs {
  command: Command;
  env: Record<string, string>;
}

const FLAG_ENV: Record<string, string> = {
  "ai-provider": "AI_PROVIDER",
  "ai-providers": "AI_PROVIDERS",
  "openai-api": "OPENAI_API",
  "plugins-dir": "PLUGINS_DIR",
  "platforms": "PLATFORMS",
  "platforms-dir": "PLATFORMS_DIR",
  "provider": "AI_PROVIDER",
  "providers": "AI_PROVIDERS",
  "providers-dir": "PROVIDERS_DIR",
  "reply-mode": "AGENT_REPLY_MODE",
  "personality": "PERSONALITY_PATH",
  "web-search-max-results": "WEB_SEARCH_MAX_RESULTS",
  "web-search-providers": "WEB_SEARCH_PROVIDERS",
  "web-search-providers-dir": "WEB_SEARCH_PROVIDERS_DIR",
};

if (import.meta.main) {
  const parsed = parseArgs(Deno.args);

  if (parsed.command === "help") {
    printHelp();
    Deno.exit(0);
  }

  // Ensure missy.config.json exists before attempting to start
  try {
    Deno.statSync("missy.config.json");
  } catch {
    console.error(
      "\x1b[33mNo missy.config.json found.\x1b[0m Run the interactive setup first:\n" +
      "  deno task setup\n" +
      "  # or: node bin/dev.js\n",
    );
    Deno.exit(1);
  }

  const env = { ...Deno.env.toObject(), ...parsed.env };
  const config = loadConfig(env);

  if (parsed.command === "status") {
    await printStatus(config, env);
    Deno.exit(0);
  }

  const logger = createLogger("bootstrap");
  const app = new AgentApp(config, logger);

  addEventListener("unload", () => {
    app.stop().catch((error) => logger.error("Failed to stop cleanly", error));
  });

  await app.start();
}

function parseArgs(args: string[]): ParsedArgs {
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
    const envName = FLAG_ENV[rawName];
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
): Promise<void> {
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
      config.webSearch.providersDir,
      config.webSearch.providerNames,
    ),
    keyCheck(
      "OPENAI_API_KEY",
      env.OPENAI_API_KEY,
      config.providerNames.includes("openai"),
    ),
    keyCheck(
      "MISTRAL_API_KEY",
      env.MISTRAL_API_KEY,
      config.providerNames.includes("mistral"),
    ),
    keyCheck(
      "DISCORD_TOKEN",
      env.DISCORD_TOKEN,
      config.enabledPlatforms.includes("discord"),
    ),
    keyCheck(
      "BRAVE_SEARCH_API_KEY",
      env.BRAVE_SEARCH_API_KEY,
      config.webSearch.providerNames.includes("brave"),
    ),
  ];

  console.log("Missy bootstrap status");
  console.log("");
  console.log(`Default AI provider: ${config.providerName}`);
  console.log(
    `Loaded AI providers: ${config.providerNames.join(", ") || "(none)"}`,
  );
  console.log(`Platforms: ${config.enabledPlatforms.join(", ") || "(none)"}`);
  console.log(
    `Web search providers: ${
      config.webSearch.providerNames.join(", ") || "(none)"
    }`,
  );
  console.log(`Reply mode: ${config.replyMode}`);
  console.log("");

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"}  ${check.label}`);
  }
}

async function fileCheck(label: string, path: string): Promise<StatusCheck> {
  try {
    const stat = await Deno.stat(path);
    return { label: `${label}: ${path}`, ok: stat.isFile };
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
    for await (const entry of Deno.readDir(folder)) {
      if (!entry.isDirectory) continue;
      checks.push(
        await fileCheck(
          `${kind} module ${entry.name}`,
          `${folder}/${entry.name}/mod.ts`,
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
      fileCheck(`${kind} ${name}`, `${folder}/${name}/mod.ts`)
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

function printHelp(): void {
  console.log(`Missy bootstrap (Deno runtime)

Usage:
  deno task start              Start Missy with defaults/env
  deno task status             Print readiness status

Flags:
  --provider=<name>              Set default AI provider
  --providers=<a,b>              Set loaded AI providers
  --platforms=<a,b>              Set enabled platforms
  --reply-mode=<xml|message>     Set reply mode
  --personality=<path>           Set personality XML path
  --web-search-providers=<a,b>   Set web search providers
  --web-search-max-results=<n>   Set web search result count
  --set=KEY=VALUE                Override any environment variable

For the interactive setup wizard, use the oclif CLI:
  node bin/dev.js
  node bin/dev.js interactive
  node bin/dev.js start --provider=mistral --model=mistral-large-latest
  node bin/dev.js status
`);
}

interface StatusCheck {
  label: string;
  ok: boolean;
}
