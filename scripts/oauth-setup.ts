#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run

/**
 * One-time OAuth setup for remote MCP servers.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts <server-name> <url> <client-secret-json-path> <auth-url> <token-url> <scopes...>
 *
 * Example:
 *   deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts docs https://example.com/mcp ./client_secret.json https://idp.example.com/oauth/authorize https://idp.example.com/oauth/token documents.read
 *
 * This will:
 *   1. Read client_id and client_secret from the JSON file
 *   2. Open your browser for provider consent
 *   3. Catch the localhost redirect
 *   4. Exchange the code for a refresh token
 *   5. Save everything to mcp.json
 */

const LOCALHOST_PORT = 8914;
const REDIRECT_URI = `http://localhost:${LOCALHOST_PORT}`;

type ClientSecretFile = {
  installed?: {
    client_id: string;
    client_secret: string;
  };
  web?: {
    client_id: string;
    client_secret: string;
  };
};

function parseClientSecret(
  raw: string,
): { clientId: string; clientSecret: string } {
  const parsed = JSON.parse(raw) as ClientSecretFile;
  const creds = parsed.installed ?? parsed.web;

  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error(
      "Could not find client_id/client_secret in the JSON file.",
    );
  }

  return { clientId: creds.client_id, clientSecret: creds.client_secret };
}

async function openBrowser(url: string): Promise<void> {
  const cmd = Deno.build.os === "windows"
    ? new Deno.Command("cmd", { args: ["/c", "start", "", url] })
    : Deno.build.os === "darwin"
    ? new Deno.Command("open", { args: [url] })
    : new Deno.Command("xdg-open", { args: [url] });

  await cmd.output();
}

function waitForAuthCode(): Promise<string> {
  console.log(
    `Waiting for OAuth redirect on http://localhost:${LOCALHOST_PORT} ...`,
  );

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const server = Deno.serve(
      { port: LOCALHOST_PORT, signal: controller.signal, onListen: () => {} },
      (request) => {
        const url = new URL(request.url, REDIRECT_URI);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          controller.abort();
          reject(new Error(`OAuth error: ${error}`));
          return new Response(`<h1>Error: ${error}</h1>`, {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (!code) {
          return new Response("<h1>No authorization code received.</h1>", {
            headers: { "Content-Type": "text/html" },
            status: 400,
          });
        }

        resolve(code);
        setTimeout(() => controller.abort(), 500);
        return new Response(
          "<h1>Authorization successful!</h1><p>You can close this tab.</p>",
          { headers: { "Content-Type": "text/html" } },
        );
      },
    );

    server.finished.catch(() => {});
  });
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  tokenUrl: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!parsed.refresh_token) {
    throw new Error(
      "No refresh_token returned. Make sure access_type=offline and prompt=consent are set.",
    );
  }

  return {
    accessToken: parsed.access_token ?? "",
    refreshToken: parsed.refresh_token,
  };
}

async function saveMcpConfig(
  serverName: string,
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  authUrl: string,
  tokenUrl: string,
  scopes: string[],
): Promise<void> {
  const configFile = new URL("../mcp.json", import.meta.url);
  let config: { servers?: Record<string, unknown> } = {};

  try {
    const raw = await Deno.readTextFile(configFile);
    config = JSON.parse(raw);
  } catch {
    // Start fresh
  }

  config.servers = {
    ...(config.servers ?? {}),
    [serverName]: {
      command: serverUrl,
      oauth: {
        authUrl,
        clientId,
        clientSecret,
        refreshToken,
        scopes,
        tokenUrl,
      },
    },
  };

  await Deno.writeTextFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nSaved MCP server "${serverName}" to mcp.json`);
}

// --- Main ---

const [
  serverName,
  serverUrl,
  clientSecretPath,
  authUrlArg,
  tokenUrlArg,
  ...scopes
] = Deno.args;

if (
  !serverName || !serverUrl || !clientSecretPath || !authUrlArg ||
  !tokenUrlArg || scopes.length === 0
) {
  console.error(
    "Usage: deno run ... scripts/oauth-setup.ts <name> <url> <client-secret.json> <auth-url> <token-url> <scopes...>",
  );
  console.error(
    "\nExample:\n  deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts docs https://example.com/mcp ./client_secret.json https://idp.example.com/oauth/authorize https://idp.example.com/oauth/token documents.read",
  );
  Deno.exit(1);
}

console.log(`Setting up OAuth for MCP server: ${serverName}`);
console.log(`Remote URL: ${serverUrl}`);
console.log(`Scopes: ${scopes.join(", ")}`);

const raw = await Deno.readTextFile(clientSecretPath);
const { clientId, clientSecret } = parseClientSecret(raw);
console.log(`Client ID: ${clientId}`);

const authUrl = new URL(authUrlArg);
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scopes.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\nOpening browser for consent...");
await openBrowser(authUrl.toString());

const code = await waitForAuthCode();
console.log("Got authorization code, exchanging for tokens...");

const { refreshToken } = await exchangeCodeForTokens(
  code,
  clientId,
  clientSecret,
  tokenUrlArg,
);
console.log("Got refresh token!");

await saveMcpConfig(
  serverName,
  serverUrl,
  clientId,
  clientSecret,
  refreshToken,
  authUrlArg,
  tokenUrlArg,
  scopes,
);
console.log("Done! The remote MCP server is ready to use.");
