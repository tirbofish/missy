import path from "node:path";

const APP_DIR_NAME = "Missy";
const LEGACY_DATA_DIR = new URL("../data/", import.meta.url);

function homeDirectory(): string | undefined {
  return Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || undefined;
}

export function appDataDir(): string {
  const configured = Deno.env.get("MISSY_DATA_DIR")?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  if (Deno.build.os === "windows") {
    const localAppData = Deno.env.get("LOCALAPPDATA") ||
      Deno.env.get("APPDATA");

    if (localAppData) {
      return path.join(localAppData, APP_DIR_NAME);
    }
  }

  if (Deno.build.os === "darwin") {
    const home = homeDirectory();

    if (home) {
      return path.join(home, "Library", "Application Support", APP_DIR_NAME);
    }
  }

  const xdgDataHome = Deno.env.get("XDG_DATA_HOME");

  if (xdgDataHome) {
    return path.join(xdgDataHome, APP_DIR_NAME.toLowerCase());
  }

  const home = homeDirectory();

  if (home) {
    return path.join(home, ".local", "share", APP_DIR_NAME.toLowerCase());
  }

  return path.resolve("data");
}

export function dataFilePath(fileName: string): string {
  return path.join(appDataDir(), fileName);
}

function legacyDataFile(fileName: string): URL {
  return new URL(fileName, LEGACY_DATA_DIR);
}

export async function readDataTextFile(fileName: string): Promise<string> {
  try {
    return await Deno.readTextFile(dataFilePath(fileName));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }

    const legacyContent = await Deno.readTextFile(legacyDataFile(fileName));

    try {
      await writeDataTextFile(fileName, legacyContent);
    } catch (migrationError) {
      console.error(
        `Could not migrate legacy data file ${fileName} to ${appDataDir()}`,
        migrationError,
      );
    }

    return legacyContent;
  }
}

export async function writeDataTextFile(
  fileName: string,
  content: string,
): Promise<void> {
  await Deno.mkdir(appDataDir(), { recursive: true });
  await Deno.writeTextFile(dataFilePath(fileName), content);
}
