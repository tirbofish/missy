export type MediaAttachment = {
  contentType?: string | null;
  name?: string | null;
  size?: number | null;
  url: string;
};

export type MediaKind = "gif" | "image" | "video" | "file";

const IMAGE_EXTENSIONS = /\.(avif|bmp|jpe?g|png|webp)(?:[?#].*)?$/i;
const GIF_EXTENSION = /\.gif(?:[?#].*)?$/i;
const VIDEO_EXTENSIONS = /\.(mov|mp4|webm)(?:[?#].*)?$/i;
const MEDIA_CONTROL_PREFIX = /^MISSY_(IMAGE|GIF|MEDIA):\s*(.+)$/i;
const MESSAGE_BREAK_LINE = /^MISSY_MESSAGE_BREAK$/i;

export function classifyMediaAttachment(
  attachment: MediaAttachment,
): MediaKind {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  const nameOrUrl = `${attachment.name ?? ""} ${attachment.url}`;

  if (contentType === "image/gif" || GIF_EXTENSION.test(nameOrUrl)) {
    return "gif";
  }

  if (contentType.startsWith("image/") || IMAGE_EXTENSIONS.test(nameOrUrl)) {
    return "image";
  }

  if (contentType.startsWith("video/") || VIDEO_EXTENSIONS.test(nameOrUrl)) {
    return "video";
  }

  return "file";
}

function formatBytes(size?: number | null): string | undefined {
  if (!Number.isFinite(size ?? NaN) || !size || size < 0) {
    return undefined;
  }

  if (size < 1024) {
    return `${size} bytes`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMediaAttachments(
  attachments: readonly MediaAttachment[],
): string | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const lines = attachments.map((attachment) => {
    const kind = classifyMediaAttachment(attachment);
    const details = [
      attachment.name?.trim(),
      attachment.contentType?.trim(),
      formatBytes(attachment.size),
    ].filter(Boolean).join(", ");

    return details
      ? `- ${kind}: ${details}\n  url: ${attachment.url}`
      : `- ${kind}: ${attachment.url}`;
  });

  return [
    "Attachments:",
    ...lines,
    "",
    "Images and GIFs are part of the user input. Use the attachment URLs when you need to refer to them.",
  ].join("\n");
}

export function visionImageUrls(
  attachments: readonly MediaAttachment[],
): string[] {
  return attachments
    .filter((attachment) => classifyMediaAttachment(attachment) === "image")
    .map((attachment) => attachment.url);
}

function mediaKindFromUrl(url: string): MediaKind | undefined {
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return undefined;
  }

  if (
    GIF_EXTENSION.test(url) ||
    /(?:^|\.)giphy\.com\/media\//i.test(url) ||
    /(?:^|\.)tenor\.com\/view\//i.test(url)
  ) {
    return "gif";
  }

  if (IMAGE_EXTENSIONS.test(url)) {
    return "image";
  }

  if (VIDEO_EXTENSIONS.test(url)) {
    return "video";
  }

  return undefined;
}

function mediaSummary(kinds: Set<MediaKind>): string | undefined {
  if (kinds.has("gif")) {
    return "[sent a gif]";
  }

  if (kinds.has("image")) {
    return "[sent an image]";
  }

  if (kinds.has("video")) {
    return "[sent a video]";
  }

  if (kinds.size > 0) {
    return "[sent media]";
  }

  return undefined;
}

export function summarizeAssistantMediaContent(content: string): string {
  const mediaKinds = new Set<MediaKind>();
  const textLines: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || MESSAGE_BREAK_LINE.test(trimmed)) {
      continue;
    }

    const mediaControl = trimmed.match(MEDIA_CONTROL_PREFIX);
    if (mediaControl?.[1]) {
      const explicitKind = mediaControl[1].toLowerCase();
      const controlUrlKind = mediaKindFromUrl(mediaControl[2]?.trim() ?? "");
      mediaKinds.add(
        explicitKind === "gif" ? "gif" : controlUrlKind ?? "image",
      );
      continue;
    }

    const urlKind = mediaKindFromUrl(trimmed);
    if (urlKind) {
      mediaKinds.add(urlKind);
      continue;
    }

    textLines.push(line);
  }

  const summary = mediaSummary(mediaKinds);

  return [...textLines.map((line) => line.trim()).filter(Boolean), summary]
    .filter(Boolean)
    .join("\n")
    .trim();
}
