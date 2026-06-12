/** Matrix attachment conversion and MXC URL resolution. */

import { isRecord } from "../../../core/helpers.ts";
import type { MessageAttachment } from "../../../core/types.ts";
import type { MatrixEventContent } from "./types.ts";

export function isSupportedMessageType(msgtype: unknown): boolean {
  return msgtype === "m.text" || msgtype === "m.notice" ||
    msgtype === "m.emote" || msgtype === "m.image" ||
    msgtype === "m.file" || msgtype === "m.audio" ||
    msgtype === "m.video";
}

export function matrixAttachments(
  raw: MatrixEventContent,
  homeserverUrl?: string,
): MessageAttachment[] {
  const msgtype = raw.msgtype;
  if (msgtype !== "m.image" && msgtype !== "m.file" &&
      msgtype !== "m.audio" && msgtype !== "m.video") {
    return [];
  }

  const rawUrl = typeof raw.url === "string" ? raw.url : undefined;
  if (!rawUrl) return [];

  const url = resolveMxcUrl(rawUrl, homeserverUrl);

  const info = isRecord(raw.info) ? raw.info : {};
  return [{
    id: rawUrl,
    contentType: typeof info.mimetype === "string"
      ? info.mimetype
      : msgtypeToContentType(String(msgtype)),
    name: typeof raw.body === "string" ? raw.body : undefined,
    size: typeof info.size === "number" ? info.size : undefined,
    url,
    width: typeof info.w === "number" ? info.w : undefined,
    height: typeof info.h === "number" ? info.h : undefined,
  }];
}

export function resolveMxcUrl(url: string, homeserverUrl?: string): string {
  if (!url.startsWith("mxc://") || !homeserverUrl) {
    return url;
  }

  const parts = url.slice("mxc://".length).split("/");
  if (parts.length < 2) return url;

  const serverName = parts[0];
  const mediaId = parts.slice(1).join("/");
  const base = homeserverUrl.replace(/\/+$/, "");
  return `${base}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
}

export function msgtypeToContentType(msgtype: string): string {
  switch (msgtype) {
    case "m.image": return "image/unknown";
    case "m.file": return "application/octet-stream";
    case "m.audio": return "audio/unknown";
    case "m.video": return "video/unknown";
    default: return "application/octet-stream";
  }
}

export function matrixAttachmentSummary(
  msgtype: unknown,
  attachments: MessageAttachment[],
): string {
  if (attachments.length === 0) return "";
  const [a] = attachments;
  const label = a.name ?? "attachment";
  switch (msgtype) {
    case "m.image": return `[Image: ${label}]`;
    case "m.file": return `[File: ${label}]`;
    case "m.audio": return `[Audio: ${label}]`;
    case "m.video": return `[Video: ${label}]`;
    default: return `[Attachment: ${label}]`;
  }
}
