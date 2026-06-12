import type { PackageBootstrapModule } from "../../core/types.ts";
import plugin from "./mod.ts";

const bootstrap: PackageBootstrapModule = {
  metadata: plugin.metadata,
  kind: "plugin",
  modulePath: "src/mod.ts",
  configSchema: plugin.configSchema
    ? {
      ...plugin.configSchema,
      fields: plugin.configSchema.fields.map((field) => ({
        ...field,
        env: field.key === "webSearch.maxResults"
          ? "WEB_SEARCH_MAX_RESULTS"
          : field.env,
        flag: field.key === "webSearch.maxResults"
          ? "web-search-max-results"
          : field.flag,
      })),
    }
    : undefined,
  bootstrap(context) {
    context.logger.debug("Bootstrapping web-search plugin", {
      keystoreKeys: Object.keys(context.keystore.entries()),
    });
    return plugin;
  },
};

export default bootstrap;
