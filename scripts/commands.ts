import { REST, Routes } from "discord.js";

type DiscordApplication = {
  id: string;
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getGuildIds(): string[] {
  return (Deno.env.get("DISCORD_GUILD_IDS") ?? "")
    .split(/[,\s]+/)
    .map((guildId) => guildId.trim())
    .filter(Boolean);
}

function getMode(): string {
  const mode = Deno.args[0];

  if (
    mode === "clear-global" ||
    mode === "clear-guilds" ||
    mode === "clear-all"
  ) {
    return mode;
  }

  throw new Error(
    "Usage: deno task commands:clear-global | commands:clear-guilds | commands:clear-all",
  );
}

async function getApplicationId(rest: REST): Promise<string> {
  const configuredId = Deno.env.get("DISCORD_CLIENT_ID")?.trim() ||
    Deno.env.get("APPLICATION_ID")?.trim();

  if (configuredId) {
    return configuredId;
  }

  const application = await rest.get(
    Routes.oauth2CurrentApplication(),
  ) as DiscordApplication;
  return application.id;
}

async function clearGlobalCommands(rest: REST, applicationId: string) {
  await rest.put(Routes.applicationCommands(applicationId), { body: [] });
  console.log("Deleted all global application commands.");
}

async function clearGuildCommands(
  rest: REST,
  applicationId: string,
  guildIds: string[],
) {
  if (guildIds.length === 0) {
    throw new Error("DISCORD_GUILD_IDS must contain at least one guild ID.");
  }

  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: [],
    });
    console.log(`Deleted all guild commands for ${guildId}.`);
  }
}

const token = getRequiredEnv("BOT_TOKEN");
const mode = getMode();
const rest = new REST().setToken(token);
const applicationId = await getApplicationId(rest);
const guildIds = getGuildIds();

if (mode === "clear-global" || mode === "clear-all") {
  await clearGlobalCommands(rest, applicationId);
}

if (mode === "clear-guilds" || mode === "clear-all") {
  await clearGuildCommands(rest, applicationId, guildIds);
}
