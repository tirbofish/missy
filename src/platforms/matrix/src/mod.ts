/** Matrix platform module — composes the PlatformModule from split files. */

import type { ConfigSchema, PlatformModule } from "../../../core/types.ts";
import { MatrixPlatform } from "./platform.ts";

const module: PlatformModule = {
  metadata: {
    name: "matrix",
    description: "Matrix platform adapter backed by matrix-bot-sdk.",
    version: "0.2.0",
  },
  configSchema: {
    module: "matrix",
    label: "Matrix Platform",
    fields: [
      { key: "matrix.homeserverUrl", label: "Matrix Homeserver URL", description: "Example: https://matrix.org", type: "string", required: true },
      { key: "matrix.accessToken", label: "Matrix Access Token", description: "Existing access token for the bot account; optional when username/password are set", type: "string", required: false, secret: true },
      { key: "matrix.username", label: "Matrix Username", description: "Bot Matrix username or user ID for automatic device login", type: "string", required: false },
      { key: "matrix.password", label: "Matrix Password", description: "Bot Matrix password for automatic Missy device login", type: "string", required: false, secret: true },
      { key: "matrix.userId", label: "Matrix User ID", description: "Example: @missy:matrix.org; optional when username/password are set", type: "string", required: false },
      { key: "matrix.deviceDisplayName", label: "Matrix Device Display Name", description: "Display name for the automatically-created Matrix device", type: "string", required: false, default: "Missy Bot" },
      { key: "matrix.deviceId", label: "Matrix Device ID", description: "Explicit device ID to reuse across servers. When set, Missy logs in as this device instead of creating a new one, preserving crypto identity. Automatically stored from the first managed-device login.", type: "string", required: false, hidden: true },
      { key: "matrix.roomIds", label: "Matrix Room IDs", description: "Comma-separated room IDs or aliases to join on startup", type: "string", required: false, default: "" },
      { key: "matrix.commandPrefix", label: "Command Prefix", description: "Prefix for Matrix text commands", type: "string", required: false, default: "!M!" },
      { key: "matrix.displayName", label: "Matrix Display Name", description: "Display name used for plain-text mentions", type: "string", required: false, default: "Missy" },
      { key: "matrix.mentionOnly", label: "Mention Only", description: "Only respond in rooms when mentioned", type: "boolean", required: false, default: true, hidden: true },
      { key: "matrix.respondToAllMessages", label: "Respond to All Messages", description: "Respond to every message in Matrix rooms", type: "boolean", required: false, default: false, hidden: true },
      { key: "matrix.maxMessageLength", label: "Max Message Length", description: "Maximum characters per Matrix message", type: "number", required: false, default: 0, hidden: true },
      { key: "matrix.autoJoinInvites", label: "Auto-Join Invites", description: "Automatically join rooms the bot is invited to", type: "boolean", required: false, default: true, hidden: true },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new MatrixPlatform(),
};

export default module;
