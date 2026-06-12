import { Command } from "@oclif/core";
import { execSync } from "node:child_process";
export default class Status extends Command {
    static description = "Print config, module, and API key readiness status";
    static examples = ["<%= config.bin %> status"];
    async run() {
        const cmd = "bun bootstrap.ts status";
        execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
    }
}
//# sourceMappingURL=status.js.map