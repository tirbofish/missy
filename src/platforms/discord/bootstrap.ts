import type { ConfigSchema, PackageBootstrapModule } from "../../core/types.ts";

const configSchema: ConfigSchema = {
  module: "discord",
  label: "Discord Platform",
  fields: [
    {
      key: "discord.token",
      label: "Discord Bot Token",
      description: "Your Discord bot token",
      type: "string",
      required: true,
      secret: true,
      env: "DISCORD_TOKEN",
      flag: "discord-token",
    },
    {
      key: "discord.commandPrefix",
      label: "Command Prefix",
      description: "Prefix for text commands",
      type: "string",
      required: false,
      default: "!M!",
      env: "DISCORD_COMMAND_PREFIX",
      flag: "discord-command-prefix",
    },
    {
      key: "discord.mentionOnly",
      label: "Mention Only",
      description: "Only respond when @mentioned",
      type: "boolean",
      required: false,
      default: true,
      hidden: true,
      env: "DISCORD_MENTION_ONLY",
      flag: "discord-mention-only",
    },
    {
      key: "discord.respondToAllMessages",
      label: "Respond to All Messages",
      description: "Respond to every message in the server",
      type: "boolean",
      required: false,
      default: false,
      hidden: true,
      env: "DISCORD_RESPOND_TO_ALL_MESSAGES",
      flag: "discord-respond-to-all-messages",
    },
    {
      key: "discord.maxMessageLength",
      label: "Max Message Length",
      description: "Maximum characters per Discord message",
      type: "number",
      required: false,
      default: 0,
      hidden: true,
      env: "DISCORD_MAX_MESSAGE_LENGTH",
      flag: "discord-max-message-length",
    },
  ],
};

const bootstrap: PackageBootstrapModule = {
  metadata: {
    name: "discord",
    description: "Discord platform adapter backed by discord.js.",
    version: "0.1.0",
  },
  kind: "platform",
  modulePath: "src/mod.ts",
  configSchema,
};

export default bootstrap;
