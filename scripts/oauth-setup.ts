#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run

/**
 * One-time OAuth setup for remote MCP servers (e.g. Gmail).
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts <server-name> <url> <client-secret-json-path> [scopes...]
 *
 * Example:
 *   deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts gmail https://gmailmcp.googleapis.com/mcp/v1 ~/Downloads/client_secret_xxx.json https://www.googleapis.com/auth/gmail.readonly
 *
 * This will:
 *   1. Read client_id and client_secret from the JSON file
 *   2. Open your browser for Google consent
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

async function waitForAuthCode(): Promise<string> {
  const listener = Deno.listen({ port: LOCALHOST_PORT });
  console.log(`Waiting for OAuth redirect on http://localhost:${LOCALHOST_PORT} ...`);

  const conn = await listener.accept();
  const httpConn = Deno.serveHttp(conn);
  const event = await httpConn.nextRequest();

  if (!event) {
    listener.close();
    throw new Error("No request received.");
  }

  const url = new URL(event.request.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    await event.respondWith(
      new Response(`<h1>Error: ${error}</h1>`, {
        headers: { "Content-Type": "text/html" },
      }),
    );
    listener.close();
    throw new Error(`OAuth error: ${error}`);
  }

  if (!code) {
    await event.respondWith(
      new Response("<h1>No authorization code received.</h1>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    listener.close();
    throw new Error("No authorization code in redirect.");
  }

  await event.respondWith(
    new Response(
      "<h1>Authorization successful!</h1><p>You can close this tab.</p>",
      { headers: { "Content-Type": "text/html" } },
    ),
  );

  listener.close();
  return code;
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
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
      oauth: { clientId, clientSecret, refreshToken },
    },
  };

  await Deno.writeTextFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nSaved MCP server "${serverName}" to mcp.json`);
}

// --- Main ---

const [serverName, serverUrl, clientSecretPath, ...scopes] = Deno.args;

if (!serverName || !serverUrl || !clientSecretPath) {
  console.error(
    "Usage: deno run ... scripts/oauth-setup.ts <name> <url> <client-secret.json> [scopes...]",
  );
  console.error(
    "\nExample:\n  deno run --allow-read --allow-write --allow-net --allow-run scripts/oauth-setup.ts gmail https://gmailmcp.googleapis.com/mcp/v1 ./client_secret.json https://www.googleapis.com/auth/gmail.readonly",
  );
  Deno.exit(1);
}

const defaultScopes = [
  // Gmail
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  // Google Drive
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  // Google Calendar
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  // People API
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
];

const finalScopes = scopes.length > 0 ? scopes : defaultScopes;

console.log(`Setting up OAuth for MCP server: ${serverName}`);
console.log(`Remote URL: ${serverUrl}`);
console.log(`Scopes: ${finalScopes.join(", ")}`);

const raw = await Deno.readTextFile(clientSecretPath);
const { clientId, clientSecret } = parseClientSecret(raw);
console.log(`Client ID: ${clientId}`);

const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", finalScopes.join(" "));
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
);
console.log("Got refresh token!");

await saveMcpConfig(serverName, serverUrl, clientId, clientSecret, refreshToken);
console.log("Done! The Gmail MCP server is ready to use.");
