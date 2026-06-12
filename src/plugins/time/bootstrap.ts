import type { PackageBootstrapModule } from "../../core/types.ts";
import plugin from "./mod.ts";

const bootstrap: PackageBootstrapModule = {
  metadata: plugin.metadata,
  kind: "plugin",
  modulePath: "src/mod.ts",
  configSchema: plugin.configSchema,
  bootstrap(context) {
    context.logger.debug("Bootstrapping time plugin", {
      keystoreKeys: Object.keys(context.keystore.entries()),
    });
    return plugin;
  },
};

export default bootstrap;
