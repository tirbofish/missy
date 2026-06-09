import { MistralApiError } from "./mistral/mod.ts";

const MISTRAL_MODELS_API_URL = "https://api.mistral.ai/v1/models";

export type MistralModelCapabilities = {
  classification?: boolean;
  completion_chat?: boolean;
  completion_fim?: boolean;
  fine_tuning?: boolean;
  function_calling?: boolean;
  vision?: boolean;
};

export type MistralModelStatus = {
  aliases?: string[];
  archived?: boolean;
  capabilities?: MistralModelCapabilities;
  created?: number;
  deprecation?: string | null;
  deprecation_replacement_model?: string | null;
  id: string;
  max_context_length?: number;
  name?: string | null;
  object?: string;
  owned_by?: string;
  root?: string;
  type?: string;
  TYPE?: string;
};

type MistralModelsResponse = {
  data?: MistralModelStatus[];
};

export type MistralModelStatusOptions = {
  fetcher?: typeof fetch;
};

function isModelStatus(value: unknown): value is MistralModelStatus {
  return Boolean(
    value && typeof value === "object" &&
      typeof (value as MistralModelStatus).id === "string",
  );
}

function parseModelsResponse(parsed: unknown): MistralModelStatus[] {
  const maybeModels = Array.isArray(parsed)
    ? parsed
    : (parsed as MistralModelsResponse | undefined)?.data;

  if (!Array.isArray(maybeModels)) {
    throw new MistralApiError(
      "Mistral Models API returned an unexpected response.",
    );
  }

  return maybeModels.filter(isModelStatus).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

export async function listMistralModels(
  apiKey: string,
  options: MistralModelStatusOptions = {},
): Promise<MistralModelStatus[]> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(MISTRAL_MODELS_API_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new MistralApiError(
      `Mistral Models API returned HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }

  return parseModelsResponse(JSON.parse(responseBody));
}

function formatCapabilities(
  capabilities: MistralModelCapabilities | undefined,
): string {
  if (!capabilities) {
    return "capabilities unknown";
  }

  const labels = [
    capabilities.completion_chat ? "chat" : undefined,
    capabilities.completion_fim ? "fim" : undefined,
    capabilities.function_calling ? "tools" : undefined,
    capabilities.vision ? "vision" : undefined,
    capabilities.classification ? "classify" : undefined,
    capabilities.fine_tuning ? "fine-tune" : undefined,
  ].filter(Boolean);

  return labels.length > 0 ? labels.join(", ") : "no advertised capabilities";
}

function formatContextLength(model: MistralModelStatus): string | undefined {
  return typeof model.max_context_length === "number"
    ? `ctx ${model.max_context_length.toLocaleString("en-US")}`
    : undefined;
}

function formatLifecycle(model: MistralModelStatus): string | undefined {
  if (model.archived) {
    return "archived";
  }

  if (model.deprecation_replacement_model) {
    return `deprecated -> ${model.deprecation_replacement_model}`;
  }

  if (model.deprecation) {
    return "deprecated";
  }

  return undefined;
}

export function formatMistralModelStatus(
  models: readonly MistralModelStatus[],
  currentModel: string,
): string {
  const routerMode = currentModel.trim().toLowerCase() === "router";
  const listedModelIds = new Set(models.flatMap((model) => [
    model.id,
    ...(model.aliases ?? []),
  ]));
  const currentStatus = routerMode
    ? "router mode"
    : listedModelIds.has(currentModel)
    ? "available"
    : "not listed for this API key";
  const lines = [
    "Mistral model status",
    `Current model: ${currentModel} (${currentStatus})`,
    `Available models for this API key: ${models.length}`,
    "",
  ];

  if (models.length === 0) {
    lines.push("No models were returned by Mistral for this API key.");
    return lines.join("\n");
  }

  if (routerMode) {
    lines.push(
      "Router mode resolves to a concrete model per request before calling Mistral.",
    );
    lines.push("");
  }

  for (const model of models) {
    const details = [
      formatCapabilities(model.capabilities),
      formatContextLength(model),
      formatLifecycle(model),
    ].filter(Boolean);
    const aliases = model.aliases?.length
      ? ` aliases: ${model.aliases.join(", ")}`
      : "";

    lines.push(
      `available: ${model.id} - ${details.join("; ")}${aliases}`,
    );
  }

  return lines.join("\n");
}
