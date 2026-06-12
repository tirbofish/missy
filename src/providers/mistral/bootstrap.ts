import type { ConfigSchema, PackageBootstrapModule } from "../../core/types.ts";

const configSchema: ConfigSchema = {
  module: "mistral",
  label: "Mistral Provider",
  fields: [
    {
      key: "mistral.apiKey",
      label: "Mistral API Key",
      description: "Your Mistral API key",
      type: "string",
      required: true,
      secret: true,
      env: "MISTRAL_API_KEY",
      flag: "mistral-api-key",
    },
    {
      key: "mistral.model",
      label: "Model",
      description: "Mistral model to use",
      type: "select",
      required: true,
      default: "mistral-small-latest",
      options: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
      env: "MISTRAL_MODEL",
      flag: "mistral-model",
    },
    {
      key: "mistral.temperature",
      label: "Temperature",
      description: "Sampling temperature (0-2)",
      type: "number",
      required: false,
      default: 0.2,
      hidden: true,
      env: "MISTRAL_TEMPERATURE",
      flag: "mistral-temperature",
    },
  ],
};

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "mistral",
    description: "Mistral TypeScript SDK provider using chat completions.",
    version: "0.1.0",
  },
  kind: "provider",
  modulePath: "src/mod.ts",
  configSchema,
};

export default bootstrap;
