export function splitDiscordMessage(
  content: string,
  maxLength = 1900,
): string[] {
  const normalized = content.trim() || " ";
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const splitAt = findSplitIndex(remaining, maxLength);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

function findSplitIndex(content: string, maxLength: number): number {
  const candidates = [
    content.lastIndexOf("\n", maxLength),
    content.lastIndexOf(" ", maxLength),
  ].filter((index) => index > 0);

  return candidates.length > 0 ? Math.max(...candidates) : maxLength;
}
