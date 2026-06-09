import { Command } from "@oclif/core";
import { execSync } from "node:child_process";

export default class Status extends Command {
  static override description =
    "Print config, module, and API key readiness status";

  static override examples = ["<%= config.bin %> status"];

  async run(): Promise<void> {
    const cmd = "deno run --allow-env --allow-read bootstrap.ts status";
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  }
}
