export interface Personality {
  xml: string;
}

import { readFileSync } from "node:fs";

export async function loadPersonality(path: string): Promise<Personality> {
  const xml = readFileSync(path, "utf-8");
  assertLooksLikeXml(xml, path);
  return { xml };
}

function assertLooksLikeXml(xml: string, path: string): void {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    throw new Error(`${path} must contain XML personality instructions.`);
  }
}
