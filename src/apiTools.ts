import { MistralToolDefinition } from "./mcp.ts";

const HTTP_GET_TOOL_NAME = "missy_http_get";
const MAX_RESPONSE_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 12_000;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i,
];

export const apiTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: HTTP_GET_TOOL_NAME,
      description:
        "Fetch a public HTTP(S) URL with GET for API docs, public JSON endpoints, timetable data, or other current web/API details. Does not send credentials or custom headers.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Public http:// or https:// URL to fetch. Local/private network addresses are blocked.",
          },
          timeoutMs: {
            type: "integer",
            description: "Optional timeout in milliseconds. Defaults to 12000.",
          },
        },
        required: ["url"],
      },
    },
  },
];

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function clampTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1_000, Math.min(parsed, 30_000))
    : DEFAULT_TIMEOUT_MS;
}

function parsePublicUrl(value: unknown): URL {
  const rawUrl = String(value ?? "").trim();

  if (!rawUrl) {
    throw new Error("url is required.");
  }

  const url = new URL(rawUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http:// and https:// URLs can be fetched.");
  }

  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error("Local and private-network URLs are blocked.");
  }

  return url;
}

export function shouldUseApiFetch(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return /https?:\/\/\S+/i.test(message) ||
    /\b(api|endpoint|json|open data|developer docs?|docs?|timetable|timetables|bus|train|route|transit|transport|schedule|departure|arriv(?:e|al)|public data)\b/
        .test(normalized) &&
      /\b(fetch|call|check|find|look up|lookup|inspect|read|get|use|search|query|optimal|best|fastest)\b/
        .test(normalized);
}

export function isApiTool(toolName: string): boolean {
  return toolName === HTTP_GET_TOOL_NAME;
}

export async function callApiTool(
  toolName: string,
  rawArguments: unknown,
): Promise<string> {
  if (!isApiTool(toolName)) {
    throw new Error(`Unknown API tool: ${toolName}`);
  }

  const args = parseArgs(rawArguments);
  const url = parsePublicUrl(args.url);
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    clampTimeoutMs(args.timeoutMs),
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept:
          "application/json,text/plain,text/html,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Missy/0.1 (+https://local.discord.bot)",
      },
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

    return JSON.stringify({
      body,
      contentType: response.headers.get("content-type"),
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      truncated: body.length >= MAX_RESPONSE_CHARS,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
