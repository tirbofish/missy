# Missy

Missy is a Discord bot powered by Mistral. By default it uses Mistral's
Conversations API with built-in web search enabled.

this is vibe-coded, dont use in real-life scenarios. its for my own use. 

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN` to your Discord bot token.
3. Optionally set `DISCORD_GUILD_IDS` to a comma-separated list of server IDs
   while testing. Guild-scoped slash commands update immediately; global slash
   commands can take time to appear in Discord.
4. Optionally set `MISTRAL_MODEL`; it defaults to `mistral-small-latest`.
5. Optionally set `MISTRAL_ENABLE_WEBSEARCH=0` to use chat completions without
   Mistral's built-in web search. `MISTRAL_WEBSEARCH_TOOL` can be set to
   `web_search` or `web_search_premium`.
6. Optionally set `DISCORD_CONTEXT_MESSAGES`; it defaults to `20` and controls
   how many recent channel messages are sent as context when Missy is mentioned.
7. Set `MCP_ADMIN_USER_IDS` to a comma-separated list of Discord user IDs that
   may add local MCP servers through slash commands.
8. In the Discord Developer Portal, enable the Message Content intent. Server
   Members intent is not required.
9. Invite the bot to a server with the `bot` and `applications.commands` scopes.
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
- Missy can send multiple Discord messages when a response is long or when the
  model separates sections with `MISSY_MESSAGE_BREAK`.
- Missy can react to the triggering message with `MISSY_REACT: <emoji>` and can
  intentionally send no text reply with `MISSY_NO_REPLY`.
- Missy can search the web through Mistral's built-in `web_search` tool when
  answering recent/current-information questions.
- Use `/missy message:<text>` for an ephemeral slash-command chat.
- Use `/analyze-history` to ask Missy to inspect recent messages in the current
  channel. The optional `limit` can fetch up to 100 messages.
- Use `/clear` to clear Missy's saved context for your current DM or server
  channel conversation.
- Use `/api-key-status` and `/remove-api-key` to manage your saved key.
- Use `/help` to see command and tool availability.
- Use `/mcp-add` to add or replace a local stdio MCP server. Only users listed
  in `MCP_ADMIN_USER_IDS` can run it.
- In DMs, Missy can stat, list, read, copy, create folders, write text files,
  move/rename, overwrite, and delete local files/folders. Move, overwrite, and
  delete show an Approve/Deny prompt first. Filesystem tools are disabled in
  servers.

## Agent SDK MCP

Missy includes a local stdio MCP server that bridges to the OpenAI Agents SDK:

```json
{
  "servers": {
    "agent_sdk": {
      "command": "deno",
      "args": [
        "run",
        "-E",
        "-R",
        "--allow-run=powershell",
        "--allow-net=api.openai.com",
        "scripts/mcp/agent-sdk-google-computer.ts"
      ],
      "env": {}
    }
  }
}
```

The server exposes:

- `agent_sdk_desktop_list` and `agent_sdk_desktop_read` for read-only Desktop
  file access. Missy exposes these to Mistral only in DMs, never in servers.
- `agent_sdk_google_query` for Google Drive, Gmail, and Calendar through OpenAI
  connector-backed hosted MCP tools. This requires `OPENAI_API_KEY`.
- `agent_sdk_computer_task` for read-only local computer inspection through the
  Agents SDK shell tool. This requires `OPENAI_API_KEY` and is exposed only in
  DMs.

Set `OPENAI_API_KEY` in `.env`. For Google, set either
`GOOGLE_CONNECTOR_AUTHORIZATION` or service-specific
`GOOGLE_DRIVE_AUTHORIZATION`, `GMAIL_AUTHORIZATION`, and
`GOOGLE_CALENDAR_AUTHORIZATION` values. To enable the local computer tool, set
`MISSY_AGENT_ENABLE_COMPUTER=1`; it defaults to disabled and only permits a
small read-only PowerShell command allowlist rooted at `MISSY_AGENT_COMPUTER_ROOT`.
Set `MISSY_DESKTOP_ROOT` if your Desktop is not at `%USERPROFILE%\Desktop`.

## Filesystem Permissions

Local filesystem access is implemented as built-in Missy tools, not as an MCP
server. The model can use them only in DMs. Missy can inspect paths, list
folders, read text files, copy paths to new destinations, create folders, and
create text files directly. Move/rename, overwrite, and delete operations send
an Approve/Deny button prompt to the requesting Discord user first; deletion is
only available through that permission prompt. The `deno task dev` command
grants broad write permission to Deno so this app-level approval gate can cover
the whole local filesystem.

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
