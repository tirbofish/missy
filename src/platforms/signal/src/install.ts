/** signal-cli installation and Java verification. */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentContext } from "../../../core/types.ts";

export const SIGNAL_CLI_DIR = path.join("data", "signal-cli");
export const SIGNAL_CLI_CONFIG_DIR = path.join("data", "signal-cli-config");
const SIGNAL_CLI_REPO = "AsamK/signal-cli";

export async function ensureJava(logger: AgentContext["logger"]): Promise<void> {
  try {
    execSync("java -version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "Java is required to run signal-cli. Install a JRE (Java 17+) and ensure 'java' is on your PATH.",
    );
  }
}

export async function ensureSignalCli(logger: AgentContext["logger"]): Promise<string> {
  const binName = process.platform === "win32" ? "signal-cli.bat" : "signal-cli";
  const binPath = path.join(SIGNAL_CLI_DIR, "bin", binName);

  if (fs.existsSync(binPath)) {
    logger.info(`Using signal-cli at ${binPath}`);
    return binPath;
  }

  logger.info("signal-cli not found — downloading latest release...");
  fs.mkdirSync(SIGNAL_CLI_DIR, { recursive: true });
  fs.mkdirSync(SIGNAL_CLI_CONFIG_DIR, { recursive: true });

  const url = await getLatestReleaseUrl(logger);
  logger.info(`Downloading signal-cli from ${url}...`);

  const tarball = path.join(SIGNAL_CLI_DIR, "signal-cli.tar.gz");
  const dl = spawn("curl", ["-sL", "-o", tarball, url], { stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    dl.on("close", (code) => code === 0 ? resolve() : reject(new Error(`curl exited ${code}`)));
    dl.on("error", reject);
  });

  const extract = spawn("tar", ["-xzf", tarball, "-C", SIGNAL_CLI_DIR, "--strip-components=1"], { stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    extract.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
    extract.on("error", reject);
  });

  fs.unlinkSync(tarball);

  if (!fs.existsSync(binPath)) throw new Error(`signal-cli binary not found after extraction at ${binPath}`);
  if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);

  logger.info(`signal-cli installed to ${binPath}`);
  return binPath;
}

async function getLatestReleaseUrl(logger: AgentContext["logger"]): Promise<string> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${SIGNAL_CLI_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
    const release = await resp.json() as { assets?: { browser_download_url?: string; name?: string }[] };
    const asset = release.assets?.find((a) =>
      a.name?.includes("signal-cli") && a.name?.endsWith(".tar.gz") && !a.name?.includes("Windows")
    ) ?? release.assets?.find((a) =>
      a.name?.includes("signal-cli") && a.name?.endsWith(".tar.gz")
    );
    if (asset?.browser_download_url) return asset.browser_download_url;
  } catch (error) {
    logger.warn("Failed to fetch latest signal-cli release from GitHub", error);
  }
  return "https://github.com/AsamK/signal-cli/releases/download/v0.13.11/signal-cli-0.13.11.tar.gz";
}
