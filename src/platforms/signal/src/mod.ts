/** Signal platform module — composes the PlatformModule from split files. */

import type { ConfigSchema, PlatformModule } from "../../../core/types.ts";
import { SignalPlatform } from "./platform.ts";

const module: PlatformModule = {
  metadata: {
    name: "signal",
    description: "Signal platform adapter backed by signal-cli JSON-RPC daemon. Self-installing — downloads signal-cli automatically.",
    version: "0.1.0",
  },
  configSchema: {
    module: "signal",
    label: "Signal Platform",
    fields: [
      { key: "signal.account", label: "Signal Account", description: "Registered Signal phone number (e.g. +1234567890). Required.", type: "string", required: true },
      { key: "signal.socketPath", label: "Daemon Socket Path", description: "Unix socket path or host:port for signal-cli daemon. Default: $XDG_RUNTIME_DIR/signal-cli/socket", type: "string", required: false, hidden: true },
      { key: "signal.commandPrefix", label: "Command Prefix", description: "Prefix for text commands", type: "string", required: false, default: "!M!", hidden: true },
      { key: "signal.displayName", label: "Display Name", description: "Bot display name for mention detection", type: "string", required: false, default: "Missy", hidden: true },
      { key: "signal.mentionOnly", label: "Mention Only", description: "Only respond in groups when mentioned", type: "boolean", required: false, default: true, hidden: true },
      { key: "signal.respondToAllMessages", label: "Respond to All Messages", description: "Respond to every message in Signal groups", type: "boolean", required: false, default: false, hidden: true },
      { key: "signal.maxMessageLength", label: "Max Message Length", description: "Maximum characters per Signal message", type: "number", required: false, default: 0, hidden: true },
      { key: "signal.includeReplyContext", label: "Include Reply Context", description: "Include the quoted message when building the AI prompt", type: "boolean", required: false, default: true, hidden: true },
      { key: "signal.includeChannelContext", label: "Include Channel Context", description: "Include recent conversation when building the AI prompt", type: "boolean", required: false, default: true, hidden: true },
      { key: "signal.channelContextCount", label: "Channel Context Count", description: "Number of recent messages to include as conversation context", type: "number", required: false, default: 10, hidden: true },
      { key: "signal.multiMessageDelimiter", label: "Multi-Message Delimiter", description: "Delimiter used to split long responses into multiple messages", type: "string", required: false, default: "|||", hidden: true },
      { key: "signal.multiMessageDelayMs", label: "Multi-Message Delay", description: "Delay in milliseconds between multi-message parts", type: "number", required: false, default: 1500, hidden: true },
    ],
  } satisfies ConfigSchema,
  createPlatform: () => new SignalPlatform(),
};

export default module;
