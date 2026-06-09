import type { PluginModule } from "../../core/types.ts";

const module: PluginModule = {
  metadata: {
    name: "time",
    description: "Time utility plugin.",
    version: "0.1.0",
  },
  setup(context) {
    context.tools.register({
      name: "time.now",
      description: "Return the current time as ISO-8601.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute() {
        return {
          iso: new Date().toISOString(),
        };
      },
    });
  },
};

export default module;
