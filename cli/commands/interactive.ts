import { Command, Flags } from "@oclif/core";
import { checkbox, confirm, input, number, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import { execSync } from "node:child_process";
import {
  type ConfigField,
  type ConfigSchema,
  CONFIG_FILE,
  DEFAULT_PLATFORMS,
  DEFAULT_PROVIDER,
  DEFAULT_REPLY_MODE,
  DEFAULT_WEB_SEARCH,
  getNestedValue,
  loadExistingConfig,
  loadSchemas,
  PLATFORMS_DIR,
  PLUGINS_DIR,
  PROVIDERS_DIR,
  saveConfig,
  scanModules,
  setNestedValue,
  WEB_SEARCH_DIR,
} from "../utils.js";

export default class Interactive extends Command {
  static override description = "Interactively configure and launch Missy";

  static override examples = [
    "<%= config.bin %> interactive",
    "<%= config.bin %>",
  ];

  static override flags = {
    "dry-run": Flags.boolean({
      description: "Show the config without saving or launching",
      default: false,
    }),
    "no-launch": Flags.boolean({
      description: "Save config without launching Missy",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Interactive);

    this.log("");
    this.log(chalk.bold("╔══════════════════════════════════════╗"));
    this.log(chalk.bold("║     🤖 Missy Interactive Setup       ║"));
    this.log(chalk.bold("╚══════════════════════════════════════╝"));
    this.log("");

    // Load existing config for defaults
    const existing = loadExistingConfig();
    const hasExisting = Object.keys(existing).length > 0;

    // Scan available modules
    const availableProviders = scanModules(PROVIDERS_DIR);
    const availablePlugins = scanModules(PLUGINS_DIR);
    const availablePlatforms = scanModules(PLATFORMS_DIR);
    const availableWebSearch = scanModules(WEB_SEARCH_DIR);

    // ─── If config exists, ask what to edit ──────────────────────────────────

    if (hasExisting) {
      this.log(chalk.green("Existing configuration found.\n"));
      this.log(`  ${chalk.cyan("Provider:")}    ${existing.provider ?? "(none)"}`);
      this.log(`  ${chalk.cyan("Plugins:")}     ${(existing.plugins as string[] ?? []).join(", ") || "(none)"}`);
      this.log(`  ${chalk.cyan("Platforms:")}   ${(existing.platforms as string[] ?? []).join(", ") || "(none)"}`);
      this.log(`  ${chalk.cyan("Web Search:")} ${((existing.webSearch as Record<string, unknown>)?.providerNames as string[] ?? []).join(", ") || "(none)"}`);
      this.log("");

      const editChoice = await select({
        message: "What would you like to do?",
        choices: [
          { name: "Keep everything, just launch", value: "none" },
          { name: "Edit modules and their settings", value: "modules" },
        ],
        default: "none",
      });

      if (editChoice === "none") {
        // Skip to save/launch with existing config
        if (flags["dry-run"]) {
          this.log(chalk.yellow("\nDry run — no changes."));
          this.log(JSON.stringify(existing, null, 2));
          return;
        }
        if (!flags["no-launch"]) {
          this.log(`\n${chalk.green("Starting Missy...")}\n`);
          const cmd = "bun bootstrap.ts start";
          execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
        }
        return;
      }

      // Any edit path continues into module selection, followed immediately by
      // configuration for the selected modules.
    }

    // ─── Step 1: Choose which modules to enable ──────────────────────────────

    let selectedProvider: string;
    let selectedPlugins: string[];
    let selectedPlatforms: string[];
    let selectedWebSearch: string[];

    this.log(chalk.bold.underline("\nStep 1: Select Modules\n"));

    selectedProvider = await select({
      message: "AI Provider",
      choices: availableProviders.map((p) => ({ name: p, value: p })),
      default: (existing.provider as string) ??
        (availableProviders.includes(DEFAULT_PROVIDER) ? DEFAULT_PROVIDER : availableProviders[0]),
    });

    selectedPlugins = availablePlugins.length > 0
      ? await checkbox({
        message: "Plugins (space to toggle)",
        choices: availablePlugins.map((p) => ({
          name: p,
          value: p,
          checked: Array.isArray(existing.plugins)
            ? (existing.plugins as string[]).includes(p)
            : true,
        })),
      })
      : [];

    selectedPlatforms = availablePlatforms.length > 0
      ? await checkbox({
        message: "Platforms",
        choices: availablePlatforms.map((p) => ({
          name: p,
          value: p,
          checked: Array.isArray(existing.platforms)
            ? (existing.platforms as string[]).includes(p)
            : DEFAULT_PLATFORMS.includes(p),
        })),
      })
      : [];

    selectedWebSearch = availableWebSearch.length > 0
      ? await checkbox({
        message: "Web Search Providers",
        choices: availableWebSearch.map((p) => ({
          name: p,
          value: p,
          checked: Array.isArray((existing.webSearch as Record<string, unknown>)?.providerNames)
            ? ((existing.webSearch as Record<string, unknown>).providerNames as string[]).includes(p)
            : DEFAULT_WEB_SEARCH.includes(p),
        })),
      })
      : [];

    // ─── Step 2: Load config schemas from selected modules ───────────────────

    const allSchemas: ConfigSchema[] = [];

    // Provider schemas
    const providerSchemas = await loadSchemas(PROVIDERS_DIR, [selectedProvider]);
    allSchemas.push(...providerSchemas);

    // Platform schemas
    const platformSchemas = await loadSchemas(PLATFORMS_DIR, selectedPlatforms);
    allSchemas.push(...platformSchemas);

    // Plugin schemas
    const pluginSchemas = await loadSchemas(PLUGINS_DIR, selectedPlugins);
    allSchemas.push(...pluginSchemas);

    // Web search provider schemas
    const webSearchSchemas = await loadSchemas(WEB_SEARCH_DIR, selectedWebSearch);
    allSchemas.push(...webSearchSchemas);

    // ─── Step 3: Prompt for each schema's fields ─────────────────────────────

    const config: Record<string, unknown> = {};

    // Set top-level selections
    setNestedValue(config, "provider", selectedProvider);
    setNestedValue(config, "providers", [selectedProvider]);
    setNestedValue(config, "plugins", selectedPlugins);
    setNestedValue(config, "platforms", selectedPlatforms);
    setNestedValue(config, "webSearch.providerNames", selectedWebSearch);
    setNestedValue(config, "replyMode", (existing.replyMode as string) ?? DEFAULT_REPLY_MODE);

    // Module selection and module configuration are a single flow: after
    // choosing modules, immediately prompt all selected module settings.
    const schemasToPrompt = allSchemas;

    // Prompt for schemas the user chose to edit
    if (schemasToPrompt.length > 0) {
      this.log("");
      this.log(chalk.bold.underline("Module Configuration\n"));
    }

    for (const schema of schemasToPrompt) {
      this.log(`\n${chalk.cyan.bold(`── ${schema.label} ──`)}`);

      for (const field of schema.fields) {
        const existingValue = getNestedValue(existing, field.key);
        const value = await this.promptField(field, existingValue);
        if (value !== undefined && value !== "") {
          setNestedValue(config, field.key, value);
        } else if (existingValue !== undefined) {
          setNestedValue(config, field.key, existingValue);
        } else if (field.default !== undefined) {
          setNestedValue(config, field.key, field.default);
        }
      }
    }

    // ─── Step 4: Summary ─────────────────────────────────────────────────────

    this.log("\n" + chalk.bold("━━━ Configuration Summary ━━━"));
    this.log(`  ${chalk.cyan("Provider:")}           ${selectedProvider}`);
    this.log(`  ${chalk.cyan("Plugins:")}            ${selectedPlugins.join(", ") || "(none)"}`);
    this.log(`  ${chalk.cyan("Platforms:")}          ${selectedPlatforms.join(", ") || "(none)"}`);
    this.log(`  ${chalk.cyan("Web Search:")}         ${selectedWebSearch.join(", ") || "(none)"}`);

    this.log("");

    // Print non-secret config values
    for (const schema of allSchemas) {
      for (const field of schema.fields) {
        const val = getNestedValue(config, field.key);
        if (val !== undefined) {
          const display = field.secret ? "••••••••" : String(val);
          this.log(`  ${chalk.dim(field.key + ":")} ${display}`);
        }
      }
    }
    this.log("");

    if (flags["dry-run"]) {
      this.log(chalk.yellow("Dry run — config not saved."));
      this.log(JSON.stringify(config, null, 2));
      return;
    }

    // ─── Step 5: Save ────────────────────────────────────────────────────────

    const shouldSave = await confirm({
      message: `Save configuration to ${CONFIG_FILE}?`,
      default: true,
    });

    if (!shouldSave) {
      this.log("\nAborted.");
      return;
    }

    saveConfig(config);
    this.log(`\n${chalk.green(`✓ Configuration saved to ${CONFIG_FILE}`)}`);

    // ─── Step 6: Optionally launch ──────────────────────────────────────────

    if (flags["no-launch"]) {
      return;
    }

    const shouldLaunch = await confirm({
      message: "Launch Missy now?",
      default: true,
    });

    if (!shouldLaunch) {
      this.log("\nDone. Run `bun run dev` to launch later.");
      return;
    }

    this.log(`\n${chalk.green("Starting Missy...")}\n`);
    const cmd = "bun bootstrap.ts start";
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  }

  private async promptField(
    field: ConfigField,
    existingValue: unknown,
  ): Promise<string | number | boolean | undefined> {
    const defaultValue = existingValue ?? field.default;
    const hint = field.description ? chalk.dim(` (${field.description})`) : "";

    switch (field.type) {
      case "string": {
        if (field.secret) {
          if (typeof existingValue === "string" && existingValue.length > 0) {
            const masked = existingValue.slice(0, 4) + "••••" + existingValue.slice(-4);
            const keep = await confirm({
              message: `${field.label} [${masked}] — keep existing?`,
              default: true,
            });
            if (keep) return existingValue;
          }
          const result = await password({
            message: `${field.label}${hint}`,
            mask: "*",
          });
          return result || (typeof defaultValue === "string" ? defaultValue : undefined);
        }
        return await input({
          message: `${field.label}${hint}`,
          default: typeof defaultValue === "string" ? defaultValue : undefined,
        });
      }

      case "number": {
        const result = await number({
          message: `${field.label}${hint}`,
          default: typeof defaultValue === "number" ? defaultValue : undefined,
        });
        return result ?? (typeof defaultValue === "number" ? defaultValue : undefined);
      }

      case "boolean": {
        return await confirm({
          message: `${field.label}${hint}`,
          default: typeof defaultValue === "boolean" ? defaultValue : false,
        });
      }

      case "select": {
        if (!field.options || field.options.length === 0) {
          return await input({
            message: `${field.label}${hint}`,
            default: typeof defaultValue === "string" ? defaultValue : undefined,
          });
        }
        const choices = field.options.map((o) => ({ name: o, value: o }));
        return await select({
          message: `${field.label}${hint}`,
          choices,
          default: typeof defaultValue === "string" ? defaultValue : field.options[0],
        });
      }

      default:
        return undefined;
    }
  }
}
