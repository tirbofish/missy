import type { PackageBootstrapModule } from "../../core/types.ts";

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "duckduckgo",
    description: "No-key DuckDuckGo Instant Answer web search provider.",
    version: "0.1.0",
  },
  kind: "web-search-provider",
  modulePath: "src/mod.ts",
};

export default bootstrap;
