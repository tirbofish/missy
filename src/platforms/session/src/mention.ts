/**
 * Session mention detection and stripping helpers.
 */

/** Build mention patterns from a list of names — each name generates `@name` and `name`. */
export function mentionPatterns(names: string[]): string[] {
  const patterns: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const lower = name.toLowerCase();
    patterns.push(`@${lower}`);
    patterns.push(lower);
  }
  return patterns;
}

/** Check if content mentions any of the given names (case-insensitive). */
export function hasTextMention(
  content: string,
  names: string[],
): boolean {
  const patterns = mentionPatterns(names);
  if (patterns.length === 0) return false;
  const lower = content.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

/** Remove the first mention pattern from content. */
export function stripMention(
  content: string,
  names: string[],
): string {
  let result = content;
  for (const pattern of mentionPatterns(names)) {
    const index = result.toLowerCase().indexOf(pattern);
    if (index !== -1) {
      result = result.slice(0, index) + result.slice(index + pattern.length);
    }
  }
  return result.trim().replace(/^[,:;.!?\s]+/, "").trim();
}
