# Missy

Missy is a Discord bot powered by the Mistral chat completions API.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN` to your Discord bot token.
3. Optionally set `DISCORD_GUILD_IDS` to a comma-separated list of server IDs
   while testing. Guild-scoped slash commands update immediately; global slash
   commands can take time to appear in Discord.
4. Optionally set `MISTRAL_MODEL`; it defaults to `mistral-small-latest`.
5. Optionally set `DISCORD_CONTEXT_MESSAGES`; it defaults to `20` and controls
   how many recent channel messages are sent as context when Missy is mentioned.
6. Set `MCP_ADMIN_USER_IDS` to a comma-separated list of Discord user IDs that
   may add local MCP servers through slash commands.
7. In the Discord Developer Portal, enable the Message Content intent. Server
   Members intent is not required.
8. Invite the bot to a server with the `bot` and `applications.commands` scopes.
   It needs permission to view channels, send messages, read message history,
   and use slash commands.

## Run

```sh
deno task dev
```

## Slash Command Cleanup

Discord can keep old global slash commands cached after you switch to
guild-scoped commands. To remove stale global commands:

```sh
deno task commands:clear-global
```

To clear commands for every server listed in `DISCORD_GUILD_IDS`:

```sh
deno task commands:clear-guilds
```

To clear both scopes:

```sh
deno task commands:clear-all
```

After clearing, restart Missy with `deno task dev` so DiscordX registers the
current command set again.

## Use

- DM Missy your Mistral API key once, then DM normally to chat.
- In a server, run `/set-api-key` once, then mention Missy, reply to one of
  her messages, or prefix a message with `!M!`.
- For prefixed server messages, use `!M!<message>` to chat or `!M!clear` to
  clear the saved context.
- Use `/missy message:<text>` for an ephemeral slash-command chat.
- Use `/analyze-history` to ask Missy to inspect recent messages in the current
  channel. The optional `limit` can fetch up to 100 messages.
- Use `/clear` to clear Missy's saved context for your current DM or server
  channel conversation.
- Use `/api-key-status` and `/remove-api-key` to manage your saved key.
- Use `/mcp-add` to add or replace a local stdio MCP server. Only users listed
  in `MCP_ADMIN_USER_IDS` can run it.

## Context

Missy stores a short per-user conversation context in `data/contexts.json`.
Server context is scoped to the guild, channel, and user so different users do
not share saved chat state. DMs are scoped to the Discord user.

## MCP

Missy can expose local stdio MCP server tools to Mistral function calling. You
can copy `mcp.example.json` to `mcp.json` and configure servers manually:

```json
{
  "servers": {
    "filesystem": {
      "command": "node",
      "args": ["path/to/mcp-server.js"],
      "env": {}
    }
  }
}
```

Configured MCP tools are loaded on demand. Tool names are exposed to Mistral as
`<server>_<tool>`. The `mcp.json` file is ignored by git because it may contain
local paths or credentials.

Admins can also add servers from Discord:

```text
/mcp-add name:filesystem command:npx args-json:["-y","@modelcontextprotocol/server-filesystem","T:\\missy"]
```

`args-json` must be a JSON string array. `env-json`, when provided, must be a
JSON object with string values.

If `/mcp-add` does not appear in Discord, set `DISCORD_GUILD_IDS` to your server
ID and restart the bot. If it appears but refuses to run, add your Discord user
ID to `MCP_ADMIN_USER_IDS` and restart.
