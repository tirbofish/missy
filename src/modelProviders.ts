import {
  MistralApiError,
  MistralMessagePayload,
  MistralSendOptions,
  sendMistralMessage,
} from "./mistral/mod.ts";

export { MistralApiError as ModelProviderApiError };

export type ModelProvider = {
  id: string;
  displayName: string;
  defaultModelEnv: string;
  sendMessage: (
    apiKey: string,
    payload: MistralMessagePayload,
    options?: MistralSendOptions,
  ) => Promise<string>;
};

const mistralProvider: ModelProvider = {
  id: "mistral",
  displayName: "Mistral",
  defaultModelEnv: "MISTRAL_MODEL",
  sendMessage: sendMistralMessage,
};

const openAiCompatibleProvider: ModelProvider = {
  id: "openai-compatible",
  displayName: "OpenAI-compatible chat completions",
  defaultModelEnv: "MISSY_MODEL",
  sendMessage: async (apiKey, payload, options = {}) => {
    const chatCompletionsUrl = Deno.env.get(
      "MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL",
    )?.trim();

    if (!chatCompletionsUrl) {
      throw new Error(
        "MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL is required when MISSY_MODEL_PROVIDER=openai-compatible.",
      );
    }

    return await sendMistralMessage(apiKey, payload, {
      ...options,
      chatCompletionsUrl,
      forceChatCompletions: true,
    });
  },
};

const providers: Record<string, ModelProvider> = {
  mistral: mistralProvider,
  "openai-compatible": openAiCompatibleProvider,
};

export function configuredModelProviderId(): string {
  return (Deno.env.get("MISSY_MODEL_PROVIDER") ?? "mistral").trim()
    .toLowerCase();
}

export function activeModelProvider(): ModelProvider {
  const providerId = configuredModelProviderId();
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(
      `Unknown model provider "${providerId}". Registered providers: ${
        Object.keys(providers).join(", ")
      }.`,
    );
  }

  return provider;
}

export async function sendModelMessage(
  apiKey: string,
  payload: MistralMessagePayload,
  options: MistralSendOptions = {},
): Promise<string> {
  return await activeModelProvider().sendMessage(apiKey, payload, options);
}
