/**
 * Session platform configuration parsing.
 */

import * as crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { AppConfig } from "../../../core/config.ts";
import type { AgentContext } from "../../../core/types.ts";
import { isRecord } from "../../../core/helpers.ts";
import type { SessionPlatformConfig } from "./types.ts";

/** Parse Session config from AppConfig data + environment variables. */
export function parseSessionConfig(config: AppConfig): SessionPlatformConfig {
  const s = (config.data.session ?? {}) as Record<string, unknown>;
  const env = process.env as Record<string, string>;
  return {
    mnemonic: (s.mnemonic as string) ?? env["SESSION_MNEMONIC"],
    displayName: (s.displayName as string) ?? env["SESSION_DISPLAY_NAME"] ?? "Missy",
    commandPrefix: (s.commandPrefix as string) ?? env["SESSION_COMMAND_PREFIX"] ?? "!M!",
    mentionOnly: typeof s.mentionOnly === "boolean" ? s.mentionOnly : true,
    respondToAllMessages: typeof s.respondToAllMessages === "boolean" ? s.respondToAllMessages : false,
    maxMessageLength: typeof s.maxMessageLength === "number" ? s.maxMessageLength : 0,
    includeReplyContext: typeof s.includeReplyContext === "boolean" ? s.includeReplyContext : true,
    includeChannelContext: typeof s.includeChannelContext === "boolean" ? s.includeChannelContext : true,
    channelContextCount: typeof s.channelContextCount === "number" ? s.channelContextCount : 10,
    multiMessageDelimiter: (s.multiMessageDelimiter as string) ?? env["SESSION_MULTI_MESSAGE_DELIMITER"] ?? "|||",
    multiMessageDelayMs: typeof s.multiMessageDelayMs === "number" ? s.multiMessageDelayMs : 1500,
    autoAcceptRequests: typeof s.autoAcceptRequests === "boolean" ? s.autoAcceptRequests : true,
  };
}

/** Generate a cryptographically random hex string. */
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Persist the Session mnemonic to missy.config.json as a nested
 * `session.mnemonic` key so parseSessionConfig can find it via
 * config.data.session.mnemonic.
 */
export async function persistConfigMnemonic(
  mnemonic: string,
  logger: AgentContext["logger"],
): Promise<void> {
  const configPath = "missy.config.json";
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // file doesn't exist yet — start fresh
    }
    // Write as nested structure (session.mnemonic → { session: { mnemonic: ... } })
    // so parseSessionConfig can find it via config.data.session.mnemonic.
    const session = isRecord(config["session"])
      ? config["session"] as Record<string, unknown>
      : {};
    session["mnemonic"] = mnemonic;
    config["session"] = session;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    logger.info(`Mnemonic written to ${configPath} (session.mnemonic)`);
  } catch (error) {
    logger.warn(
      `Could not persist mnemonic to ${configPath}: ${String(error)}`,
    );
  }
}

/**
 * Persist the bot's Session ID to missy.config.json under session.sessionId.
 * This makes the identity portable when copying the config to another server.
 */
export async function persistConfigSessionId(
  sessionId: string,
  logger: AgentContext["logger"],
): Promise<void> {
  const configPath = "missy.config.json";
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // file doesn't exist yet — start fresh
    }
    const session = isRecord(config["session"])
      ? config["session"] as Record<string, unknown>
      : {};
    session["sessionId"] = sessionId;
    config["session"] = session;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    logger.info(`Session ID written to ${configPath} (session.sessionId)`);
  } catch (error) {
    logger.warn(
      `Could not persist Session ID to ${configPath}: ${String(error)}`,
    );
  }
}
