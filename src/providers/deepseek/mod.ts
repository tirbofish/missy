import OpenAI from "openai";
import type {
  AiGenerateRequest,
  AiProvider,
  ConfigSchema,
  ProviderModule,
} from "../../core/types.ts";

export interface DeepSeekProviderConfig {
  apiKey?: string;
  baseURL: string;
  model: string;
  thinking: boolean;
  reasoningEffort: "low" | "medium" | "high";
  temperature: number;
}

type DeepSeekReasoningEffort = "low" | "medium" | "high";

type ChatMessageContent =
  | string
  | (string | { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

interface DeepSeekChatCompletionParams {
  model: string;
  temperature: number;
  messages: {
    role: "system" | "user";
    content: ChatMessageContent;
  }[];
  thinking?: {
    type: "enabled";
  };
  reasoning_effort?: DeepSeekReasoningEffort;
  stream: false;
}

export class DeepSeekProvider implements AiProvider {
  #client: OpenAI;

  constructor(private readonly config: DeepSeekProviderConfig) {
    if (!config.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is required.");
    }

    this.#client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async generate(request: AiGenerateRequest): Promise<string> {
    const userContent = buildUserContent(request);

    const params: DeepSeekChatCompletionParams = {
      model: this.config.model,
      temperature: this.config.temperature,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: userContent },
      ],
      stream: false,
    };

    if (this.config.thinking) {
      params.thinking = { type: "enabled" };
      params.reasoning_effort = this.config.reasoningEffort;
    }

    const response = await this.#client.chat.completions.create(
      params as unknown as Record<string, unknown>,
    );

    const text = (response as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      const reason = (response as { choices?: { finish_reason?: string }[] }).choices?.[0]?.finish_reason ?? "unknown";
      throw new Error(
        `DeepSeek Chat API returned empty output (finish_reason: ${reason}).`,
      );
    }
    return text;
  }
}

function buildUserContent(request: AiGenerateRequest): ChatMessageContent {
  const images = request.images?.filter((img) => img.url) ?? [];
  if (images.length === 0) {
    return request.input;
  }

  // Build a multimodal content array: text first, then images
  const parts: ChatMessageContent = [
    { type: "text", text: request.input },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.url },
    })),
  ];
  return parts;
}

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
    },
    {
      key: "deepseek.baseURL",
      label: "DeepSeek Base URL",
      description: "DeepSeek OpenAI-compatible API base URL",
      type: "string",
      required: false,
      default: "https://api.deepseek.com",
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
    },
    {
      key: "deepseek.thinking",
      label: "Thinking",
      description: "Enable DeepSeek thinking mode",
      type: "boolean",
      required: false,
      default: true,
    },
    {
      key: "deepseek.reasoningEffort",
      label: "Reasoning Effort",
      description: "DeepSeek reasoning effort",
      type: "select",
      required: false,
      default: "high",
      options: ["low", "medium", "high"],
    },
    {
      key: "deepseek.temperature",
      label: "Temperature",
      description: "Sampling temperature (0-2)",
      type: "number",
      required: false,
      default: 0.2,
      hidden: true,
    },
  ],
};

function parseDeepSeekConfig(data: Record<string, unknown>): DeepSeekProviderConfig {
  const deepseek = (data.deepseek ?? data) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    apiKey: (deepseek.apiKey as string) ?? env["DEEPSEEK_API_KEY"],
    baseURL: (deepseek.baseURL as string) ?? env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com",
    model: (deepseek.model as string) ?? env["DEEPSEEK_MODEL"] ?? "deepseek-v4-pro",
    thinking: typeof deepseek.thinking === "boolean"
      ? deepseek.thinking
      : env["DEEPSEEK_THINKING"] !== undefined
        ? ["1", "true", "yes", "on"].includes(env["DEEPSEEK_THINKING"].toLowerCase())
        : true,
    reasoningEffort: parseReasoningEffort(
      (deepseek.reasoningEffort as string) ?? env["DEEPSEEK_REASONING_EFFORT"],
    ),
    temperature: typeof deepseek.temperature === "number"
      ? deepseek.temperature
      : 0.2,
  };
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "high";
}

const module: ProviderModule = {
  metadata: {
    name: "deepseek",
    description: "DeepSeek OpenAI-compatible provider using chat completions.",
    version: "0.1.0",
  },
  configSchema,
  createProvider: (config) =>
    new DeepSeekProvider(parseDeepSeekConfig(config)),
};

export default module;
