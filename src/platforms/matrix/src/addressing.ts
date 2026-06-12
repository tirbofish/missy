/** Matrix message addressing / mention parsing. */

import { escapeRegExp, isRecord } from "../../../core/helpers.ts";
import type { MatrixAddressing, MatrixEventContent } from "./types.ts";

export function parseMatrixAddressing({
  body,
  content,
  botUserId,
  displayName,
  prefix,
}: {
  body: string;
  content: MatrixEventContent;
  botUserId: string | undefined;
  displayName: string;
  prefix: string;
}): MatrixAddressing {
  const trimmed = body.trim();
  if (prefix && trimmed.startsWith(prefix)) {
    return {
      content: trimmed.slice(prefix.length).trim(),
      isPrefixCommand: true,
      mentioned: false,
    };
  }

  const nativeMentioned = hasMatrixUserMention(content, botUserId);
  const leadingAddress = stripLeadingAddressName(
    trimmed,
    matrixAddressNames(displayName, botUserId),
  );
  if (leadingAddress.addressed) {
    return {
      content: cleanMentionContent(
        leadingAddress.content,
        botUserId,
        displayName,
      ),
      isPrefixCommand: false,
      mentioned: true,
    };
  }

  const textMentioned = hasTextMention(trimmed, displayName, botUserId);
  if (nativeMentioned || textMentioned) {
    return {
      content: cleanMentionContent(trimmed, botUserId, displayName),
      isPrefixCommand: false,
      mentioned: true,
    };
  }

  return {
    content: trimmed,
    isPrefixCommand: false,
    mentioned: false,
  };
}

export function hasMatrixUserMention(
  content: MatrixEventContent,
  botUserId: string | undefined,
): boolean {
  const mentions = content["m.mentions"];
  return Boolean(
    botUserId &&
      isRecord(mentions) &&
      Array.isArray(mentions.user_ids) &&
      mentions.user_ids.includes(botUserId),
  );
}

export function matrixAddressNames(
  displayName: string,
  botUserId: string | undefined,
): string[] {
  const names = new Set<string>();
  const cleanDisplayName = normalizeAddressName(displayName);
  if (cleanDisplayName) {
    names.add(cleanDisplayName);
  }

  const localpart = botUserId?.match(/^@([^:]+)/)?.[1];
  const cleanLocalpart = normalizeAddressName(localpart ?? "");
  if (cleanLocalpart) {
    names.add(cleanLocalpart);
  }

  return [...names].sort((a, b) => b.length - a.length);
}

export function normalizeAddressName(value: string): string {
  return value.trim().replace(/^@/, "");
}

export function stripLeadingAddressName(
  body: string,
  names: string[],
): { addressed: boolean; content: string } {
  for (const name of names) {
    const pattern = new RegExp(
      `^@?${escapeRegExp(name)}(?:\\s+|[,:;.!?]+\\s*|$)`,
      "i",
    );
    const match = body.match(pattern);
    if (match) {
      return {
        addressed: true,
        content: body.slice(match[0].length).trim(),
      };
    }
  }

  return { addressed: false, content: body };
}

export function hasTextMention(
  body: string,
  displayName: string,
  botUserId: string | undefined,
): boolean {
  const names = matrixAddressNames(displayName, botUserId);
  return names.some((name) =>
    new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[,:;.!?])`, "i").test(
      body,
    )
  ) || (botUserId ? body.includes(botUserId) : false);
}

export function cleanMentionContent(
  body: string,
  botUserId: string | undefined,
  displayName: string,
): string {
  let result = body.trim();
  if (botUserId) {
    result = result.replaceAll(botUserId, "");
  }

  for (const name of matrixAddressNames(displayName, botUserId)) {
    result = result.replace(
      new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[,:;.!?])`, "gi"),
      " ",
    );
  }

  return result.trim();
}
