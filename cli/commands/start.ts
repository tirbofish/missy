import { Command } from "@oclif/core";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { CONFIG_FILE } from "../utils.js";

export default class Start extends Command {
  static override description = "Launch Missy using the saved configuration";

  static override examples = [
    "<%= config.bin %> start",
  ];

  async run(): Promise<void> {
    if (!existsSync(CONFIG_FILE)) {
      this.log(chalk.yellow(`No ${CONFIG_FILE} found. Run setup first:`));
      this.log(`  node bin/dev.js interactive`);
      this.exit(1);
    }

    this.log(`${chalk.green("Starting Missy...")} (config: ${CONFIG_FILE})\n`);
    const cmd = "bun bootstrap.ts start";
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  }
}
