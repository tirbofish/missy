import type { ConfigSchema, PackageBootstrapModule } from "../../core/types.ts";

const configSchema: ConfigSchema = {
  module: "openai",
  label: "OpenAI Provider",
  fields: [
    {
      key: "openai.apiKey",
      label: "OpenAI API Key",
      description: "Your OpenAI API key (sk-...)",
      type: "string",
      required: true,
      secret: true,
      env: "OPENAI_API_KEY",
      flag: "openai-api-key",
    },
    {
      key: "openai.baseURL",
      label: "OpenAI Base URL",
      description: "Custom API base URL (leave empty for default)",
      type: "string",
      required: false,
      env: "OPENAI_BASE_URL",
      flag: "openai-base-url",
    },
    {
      key: "openai.api",
      label: "API Mode",
      description: "Use 'responses' for OpenAI native, 'chat' for compatible endpoints",
      type: "select",
      required: false,
      default: "responses",
      options: ["responses", "chat"],
      env: "OPENAI_API",
      flag: "openai-api",
    },
    {
      key: "openai.model",
      label: "Model",
      description: "OpenAI model to use",
      type: "select",
      required: true,
      default: "gpt-4.1",
      options: ["gpt-5.2", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
      env: "OPENAI_MODEL",
      flag: "openai-model",
    },
    {
      key: "openai.temperature",
      label: "Temperature",
      description: "Sampling temperature (0-2)",
      type: "number",
      required: false,
      default: 0.2,
      hidden: true,
      env: "OPENAI_TEMPERATURE",
      flag: "openai-temperature",
    },
  ],
};

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "openai",
    description: "OpenAI SDK provider using the Responses API.",
    version: "0.1.0",
  },
  kind: "provider",
  modulePath: "src/mod.ts",
  configSchema,
};

export default bootstrap;
