/** Discord platform module — composes the PlatformModule from split files. */

import type { ConfigSchema, PlatformModule } from "../../../core/types.ts";
import { DiscordPlatform } from "./platform.ts";

const module: PlatformModule = {
  metadata: {
    name: "discord",
    description: "Discord platform adapter backed by discord.js.",
    version: "0.1.0",
  },
  configSchema: {
    module: "discord",
    label: "Discord Platform",
    fields: [
      { key: "discord.token", label: "Discord Bot Token", description: "Discord bot token from the developer portal", type: "string", required: true, secret: true },
      { key: "discord.commandPrefix", label: "Command Prefix", description: "Prefix for text commands", type: "string", required: false, default: "!M!", hidden: true },
      { key: "discord.mentionOnly", label: "Mention Only", description: "Only respond when mentioned", type: "boolean", required: false, default: true, hidden: true },
      { key: "discord.respondToAllMessages", label: "Respond to All Messages", description: "Respond to every message in guild channels", type: "boolean", required: false, default: false, hidden: true },
      { key: "discord.maxMessageLength", label: "Max Message Length", description: "Maximum characters per Discord message", type: "number", required: false, default: 0, hidden: true },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new DiscordPlatform(),
};

export default module;
