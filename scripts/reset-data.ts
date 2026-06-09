import path from "node:path";
import { appDataDir } from "../src/dataDir.ts";

const LEGACY_DATA_DIR = path.resolve(
  "data",
);

function homeDirectory(): string | undefined {
  return Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || undefined;
}

function isUnsafeDeleteTarget(target: string): boolean {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const cwd = path.resolve(Deno.cwd());
  const home = homeDirectory();

  return resolved === root ||
    resolved === cwd ||
    (home !== undefined && resolved === path.resolve(home));
}

async function removeDirectoryIfPresent(target: string): Promise<boolean> {
  const resolved = path.resolve(target);

  if (isUnsafeDeleteTarget(resolved)) {
    throw new Error(`Refusing to delete unsafe data directory: ${resolved}`);
  }

  try {
    await Deno.remove(resolved, { recursive: true });
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

const shouldReset = Deno.args.includes("--yes");
const targets = [
  ...new Set(
    [appDataDir(), LEGACY_DATA_DIR].map((target) => path.resolve(target)),
  ),
];

if (!shouldReset) {
  console.log("This will delete all Missy runtime data:");
  for (const target of targets) {
    console.log(`- ${target}`);
  }
  console.log("");
  console.log("Run `deno task data:reset -- --yes` to confirm.");
  Deno.exit(1);
}

for (const target of targets) {
  const removed = await removeDirectoryIfPresent(target);
  console.log(`${removed ? "Removed" : "Already empty"}: ${target}`);
}
