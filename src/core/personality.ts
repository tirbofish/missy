export interface Personality {
  xml: string;
}

export async function loadPersonality(path: string): Promise<Personality> {
  const xml = await Deno.readTextFile(path);
  assertLooksLikeXml(xml, path);
  return { xml };
}

function assertLooksLikeXml(xml: string, path: string): void {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    throw new Error(`${path} must contain XML personality instructions.`);
  }
}
