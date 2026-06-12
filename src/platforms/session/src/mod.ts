/**
 * Session platform module — composes the PlatformModule from split files.
 */

import type { ConfigSchema, PlatformModule } from "../../../core/types.ts";
import { SessionPlatform } from "./platform.ts";

const module: PlatformModule = {
  metadata: {
    name: "session",
    description:
      "Session messenger platform adapter backed by @session.js/client. Fully decentralized — no servers required.",
    version: "0.1.0",
  },
  configSchema: {
    module: "session",
    label: "Session Platform",
    fields: [
      {
        key: "session.mnemonic",
        label: "Session Mnemonic",
        description:
          "13-word mnemonic seed phrase for your Session bot account. If omitted, a new random identity is generated and persisted automatically.",
        type: "string",
        required: false,
        secret: true,
      },
      {
        key: "session.displayName",
        label: "Session Display Name",
        description: "Display name for the bot on the Session network",
        type: "string",
        required: false,
        default: "Missy",
      },
      {
        key: "session.commandPrefix",
        label: "Command Prefix",
        description: "Prefix for text commands",
        type: "string",
        required: false,
        default: "!M!",
      },
      {
        key: "session.mentionOnly",
        label: "Mention Only",
        description: "Only respond in groups when mentioned",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.respondToAllMessages",
        label: "Respond to All Messages",
        description: "Respond to every message in Session groups",
        type: "boolean",
        required: false,
        default: false,
        hidden: true,
      },
      {
        key: "session.maxMessageLength",
        label: "Max Message Length",
        description: "Maximum characters per Session message",
        type: "number",
        required: false,
        default: 0,
        hidden: true,
      },
      {
        key: "session.includeReplyContext",
        label: "Include Reply Context",
        description:
          "Include the quoted message when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.includeChannelContext",
        label: "Include Channel Context",
        description:
          "Include recent conversation when building the AI prompt",
        type: "boolean",
        required: false,
        default: true,
        hidden: true,
      },
      {
        key: "session.channelContextCount",
        label: "Channel Context Count",
        description:
          "Number of recent messages to include as conversation context",
        type: "number",
        required: false,
        default: 10,
        hidden: true,
      },
      {
        key: "session.multiMessageDelimiter",
        label: "Multi-Message Delimiter",
        description:
          "Delimiter used to split long responses into multiple messages",
        type: "string",
        required: false,
        default: "|||",
        hidden: true,
      },
      {
        key: "session.multiMessageDelayMs",
        label: "Multi-Message Delay",
        description: "Delay in milliseconds between multi-message parts",
        type: "number",
        required: false,
        default: 1500,
        hidden: true,
      },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new SessionPlatform(),
};

export default module;
