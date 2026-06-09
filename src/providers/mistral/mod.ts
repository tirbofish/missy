import { Mistral } from "@mistralai/mistralai";
import type { MistralProviderConfig } from "../../core/config.ts";
import type {
  AiGenerateRequest,
  AiProvider,
  ConfigSchema,
  ProviderModule,
} from "../../core/types.ts";
import { createLogger } from "../../core/logger.ts";

export class MistralProvider implements AiProvider {
  #client: Mistral;

  constructor(private readonly config: MistralProviderConfig) {
    if (!config.apiKey) {
      throw new Error("MISTRAL_API_KEY is required.");
    }

    this.#client = new Mistral({
      apiKey: config.apiKey,
    });
  }

  async generate(request: AiGenerateRequest): Promise<string> {
    const msg = [
        {
          role: "system",
          content: request.instructions,
        },
        {
          role: "user",
          content: request.input,
        },
      ];

    createLogger("provider.mistral").debug("input", msg);
    
    const response = await this.#client.chat.complete({
      model: this.config.model,
      temperature: this.config.temperature,
      messages: msg,
      toolChoice: "none",
    });

    createLogger("provider.mistral").debug("output", response);

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }

    return JSON.stringify(content ?? response);
  }
}

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
    },
    {
      key: "mistral.model",
      label: "Model",
      description: "Mistral model to use",
      type: "select",
      required: true,
      default: "mistral-small-latest",
      options: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
    },
    {
      key: "mistral.temperature",
      label: "Temperature",
      description: "Sampling temperature (0-2)",
      type: "number",
      required: false,
      default: 0.2,
      hidden: true,
    },
  ],
};

const module: ProviderModule = {
  metadata: {
    name: "mistral",
    description: "Mistral TypeScript SDK provider using chat completions.",
    version: "0.1.0",
  },
  configSchema,
  createProvider: (config) => new MistralProvider(config.mistral),
};

export default module;
