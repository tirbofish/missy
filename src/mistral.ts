const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";
const DISCORD_MESSAGE_LIMIT = 2_000;

export class MistralApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "MistralApiError";
  }
}

export type MistralMessagePayload = {
  message: string;
  source: "discord-dm" | "discord-server" | "discord-slash";
  discord: {
    userId: string;
    username: string;
    channelId?: string;
    guildId?: string;
  };
};

type MistralContentBlock = {
  type?: string;
  text?: string;
};

type MistralChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | MistralContentBlock[] | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function getMistralModel(): string {
  return Deno.env.get("MISTRAL_MODEL") ?? DEFAULT_MISTRAL_MODEL;
}

function extractResponseText(response: MistralChatResponse): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => block.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim();
  }

  return "";
}

export function fitDiscordMessage(message: string): string {
  if (message.length <= DISCORD_MESSAGE_LIMIT) {
    return message;
  }

  return `${message.slice(0, DISCORD_MESSAGE_LIMIT - 3)}...`;
}

export async function sendMistralMessage(
  apiKey: string,
  payload: MistralMessagePayload,
): Promise<string> {
  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getMistralModel(),
      messages: [
        {
          role: "system",
          content:
            "You are Missy, a helpful Discord bot powered by Mistral. Reply naturally and keep answers concise unless the user asks for detail.",
        },
        {
          role: "user",
          content: payload.message,
        },
      ],
    }),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new MistralApiError(
      `Mistral API returned HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }

  const parsed = JSON.parse(responseBody) as MistralChatResponse;
  const reply = extractResponseText(parsed);

  if (!reply) {
    throw new MistralApiError("Mistral API returned an empty response");
  }

  return reply;
}
