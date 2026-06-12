import type { PackageBootstrapModule } from "../core/types.ts";

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "commands",
    description: "Legacy Discord command definitions.",
    version: "0.1.0",
  },
  kind: "package",
  modulePath: "src/mod.ts",
};

export default bootstrap;
