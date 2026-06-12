import type { PluginModule } from "../../core/types.ts";
import { isRecord } from "../../core/helpers.ts";

const module: PluginModule = {
  metadata: {
    name: "echo",
    description: "Example plugin that repeats supplied text.",
    version: "0.1.0",
  },
  setup(context) {
    context.tools.register({
      name: "echo.repeat",
      description: "Repeat text exactly. Useful for testing tool calling.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
      execute(input) {
        if (!isRecord(input) || typeof input.text !== "string") {
          throw new Error('echo.repeat expects input like {"text":"hello"}.');
        }

        return input.text;
      },
    });
  },
};

export default module;
