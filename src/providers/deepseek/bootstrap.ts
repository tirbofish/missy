import type { ConfigSchema, PackageBootstrapModule } from "../../core/types.ts";

const configSchema: ConfigSchema = {
  module: "deepseek",
  label: "DeepSeek Provider",
  fields: [
    {
      key: "deepseek.apiKey",
      label: "DeepSeek API Key",
      description: "Your DeepSeek API key",
      type: "string",
      required: true,
      secret: true,
      env: "DEEPSEEK_API_KEY",
      flag: "deepseek-api-key",
    },
    {
      key: "deepseek.baseURL",
      label: "DeepSeek Base URL",
      description: "DeepSeek OpenAI-compatible API base URL",
      type: "string",
      required: false,
      default: "https://api.deepseek.com",
      env: "DEEPSEEK_BASE_URL",
      flag: "deepseek-base-url",
    },
    {
      key: "deepseek.model",
      label: "Model",
      description: "DeepSeek model to use",
      type: "select",
      required: true,
      default: "deepseek-v4-pro",
      options: [
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "deepseek-chat",
        "deepseek-reasoner",
      ],
      env: "DEEPSEEK_MODEL",
      flag: "deepseek-model",
    },
    {
      key: "deepseek.thinking",
      label: "Thinking",
      description: "Enable DeepSeek thinking mode",
      type: "boolean",
      required: false,
      default: true,
      env: "DEEPSEEK_THINKING",
      flag: "deepseek-thinking",
    },
    {
      key: "deepseek.reasoningEffort",
      label: "Reasoning Effort",
      description: "DeepSeek reasoning effort",
      type: "select",
      required: false,
      default: "high",
      options: ["low", "medium", "high"],
      env: "DEEPSEEK_REASONING_EFFORT",
      flag: "deepseek-reasoning-effort",
    },
    {
      key: "deepseek.temperature",
      label: "Temperature",
      description: "Sampling temperature (0-2)",
      type: "number",
      required: false,
      default: 0.2,
      hidden: true,
      env: "DEEPSEEK_TEMPERATURE",
      flag: "deepseek-temperature",
    },
  ],
};

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "deepseek",
    description: "DeepSeek OpenAI-compatible provider using chat completions.",
    version: "0.1.0",
  },
  kind: "provider",
  modulePath: "src/mod.ts",
  configSchema,
};

export default bootstrap;
