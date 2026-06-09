import OpenAI from "@openai/openai";
import type {
  AiGenerateRequest,
  AiProvider,
  ConfigSchema,
  ProviderModule,
} from "../../core/types.ts";
import type { OpenAIProviderConfig } from "../../core/config.ts";

export class OpenAIProvider implements AiProvider {
  #client: OpenAI;

  constructor(private readonly config: OpenAIProviderConfig) {
    if (!config.apiKey) {
      throw new Error("OPENAI_API_KEY is required.");
    }

    this.#client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async generate(request: AiGenerateRequest): Promise<string> {
    if (this.config.api === "chat") {
      return this.#generateChat(request);
    }
    return this.#generateResponses(request);
  }

  async #generateResponses(request: AiGenerateRequest): Promise<string> {
    const response = await this.#client.responses.create({
      model: this.config.model,
      instructions: request.instructions,
      input: request.input,
      temperature: this.config.temperature,
    });

    const text = response.output_text ?? "";
    if (!text.trim()) {
      throw new Error(
        `OpenAI Responses API returned empty output (status: ${response.status ?? "unknown"}).`,
      );
    }
    return text;
  }

  async #generateChat(request: AiGenerateRequest): Promise<string> {
    const response = await this.#client.chat.completions.create({
      model: this.config.model,
      temperature: this.config.temperature,
      messages: [
        { role: "developer", content: request.instructions },
        { role: "user", content: request.input },
      ],
    });

    const text = response.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      const reason = response.choices?.[0]?.finish_reason ?? "unknown";
      throw new Error(
        `OpenAI Chat API returned empty output (finish_reason: ${reason}).`,
      );
    }
    return text;
  }
}

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
    },
    {
      key: "openai.baseURL",
      label: "OpenAI Base URL",
      description: "Custom API base URL (leave empty for default)",
      type: "string",
      required: false,
    },
    {
      key: "openai.api",
      label: "API Mode",
      description: "Use 'responses' for OpenAI native, 'chat' for compatible endpoints",
      type: "select",
      required: false,
      default: "responses",
      options: ["responses", "chat"],
    },
    {
      key: "openai.model",
      label: "Model",
      description: "OpenAI model to use",
      type: "select",
      required: true,
      default: "gpt-4.1",
      options: ["gpt-5.2", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
    },
    {
      key: "openai.temperature",
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
    name: "openai",
    description: "OpenAI SDK provider using the Responses API.",
    version: "0.1.0",
  },
  configSchema,
  createProvider: (config) => new OpenAIProvider(config.openai),
};

export default module;
