/**
 * Shared helper utilities used across providers, platforms, and plugins.
 *
 * These were previously duplicated in multiple packages. Centralizing them
 * reduces code duplication and ensures consistent behavior everywhere.
 *
 * NOTE: `isRecord` in `core/keystore.ts` has a different return type
 * (`JsonObject` vs `Record<string, unknown>`) and is kept local there.
 */

import * as crypto from "node:crypto";

/** Type guard: checks whether a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Promise-based delay via setTimeout. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Split content by a configurable delimiter string, trimming and filtering empties. */
export function splitByDelimiter(content: string, delimiter: string): string[] {
  return content
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Normalize a user-supplied session name: lowercase, replace non-alphanumeric
 * chars with hyphens, trim leading/trailing hyphens, limit to 48 characters.
 */
export function normalizeSessionName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || undefined;
}

/** Escape special regex characters in a string so it can be used literally in a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate a random session ID like `session-xxxxxxxxxx`.
 * Uses 6 bytes of crypto-random data, base-36 encoded, truncated to 10 chars.
 */
export function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(36).padStart(2, "0"),
  )
    .join("")
    .toLowerCase()
    .slice(0, 10);
  return `session-${suffix}`;
}
