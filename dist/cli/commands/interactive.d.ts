import { Command } from "@oclif/core";
export default class Interactive extends Command {
    static description: string;
    static examples: string[];
    static flags: {
        "dry-run": import("@oclif/core/interfaces").BooleanFlag<boolean>;
        "no-launch": import("@oclif/core/interfaces").BooleanFlag<boolean>;
    };
    run(): Promise<void>;
    private promptField;
}
//# sourceMappingURL=interactive.d.ts.map