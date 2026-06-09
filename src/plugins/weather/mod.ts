import type { PluginModule } from "../../core/types.ts";

interface WeatherInput {
  location?: unknown;
}

const module: PluginModule = {
  metadata: {
    name: "weather",
    description: "Weather lookup tool.",
    version: "0.1.0",
  },
  setup(context) {
    context.tools.register({
      name: "weather.current",
      description:
        'Fetch current weather for a location. Input: {"location":"Sydney"}. Use remembered user location when the user asks for weather for them.',
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
      async execute(input) {
        const location = parseLocation(input);
        const url = new URL(`https://wttr.in/${encodeURIComponent(location)}`);
        url.searchParams.set("format", "j1");

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Weather lookup failed with HTTP ${response.status}.`,
          );
        }

        return normalizeWeather(location, await response.json());
      },
    });
  },
};

function parseLocation(input: unknown): string {
  if (!isRecord(input)) {
    throw new Error(
      'weather.current expects input like {"location":"Sydney"}.',
    );
  }

  const rawInput = input as WeatherInput;
  if (typeof rawInput.location !== "string") {
    throw new Error(
      'weather.current expects input like {"location":"Sydney"}.',
    );
  }

  const location = rawInput.location.trim();
  if (!location) {
    throw new Error("weather.current location cannot be empty.");
  }

  return location;
}

function normalizeWeather(location: string, payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.current_condition)) {
    return { location, raw: payload };
  }

  const current = payload.current_condition.find(isRecord);
  if (!current) {
    return { location, raw: payload };
  }

  return {
    location,
    observedAt: stringValue(current.localObsDateTime),
    temperatureC: stringValue(current.temp_C),
    feelsLikeC: stringValue(current.FeelsLikeC),
    humidityPercent: stringValue(current.humidity),
    windKph: stringValue(current.windspeedKmph),
    description: Array.isArray(current.weatherDesc)
      ? current.weatherDesc.find(isRecord)?.value
      : undefined,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default module;
