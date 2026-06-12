import type { ConfigSchema, PackageBootstrapModule } from "../../core/types.ts";

const configSchema: ConfigSchema = {
  module: "brave",
  label: "Brave Search",
  fields: [
    {
      key: "webSearch.braveApiKey",
      label: "Brave Search API Key",
      description: "Your Brave Search API key",
      type: "string",
      required: true,
      secret: true,
      env: "BRAVE_SEARCH_API_KEY",
      flag: "brave-search-api-key",
    },
  ],
};

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "brave",
    description: "Brave Search API provider.",
    version: "0.1.0",
  },
  kind: "web-search-provider",
  modulePath: "src/mod.ts",
  configSchema,
};

export default bootstrap;
