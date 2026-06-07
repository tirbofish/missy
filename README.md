# Missy

Missy is a Discord bot powered by Mistral. By default it uses Mistral's
Conversations API with built-in web search enabled.

this is vibe-coded, dont use in real-life scenarios. its for my own use.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN` to your Discord bot token.
3. Optionally set `DISCORD_GUILD_IDS` to a comma-separated list of server IDs
   while testing. Guild-scoped slash commands update immediately; global slash
   commands can take time to appear in Discord. When guild IDs are set, Missy
   clears global commands on startup by default so Discord does not show two
   copies of each command in the server. Set
   `DISCORD_REGISTER_GLOBAL_COMMANDS=1` only if you intentionally want both
   guild-scoped and global slash commands.
4. Optionally set `MISTRAL_MODEL`; it defaults to `mistral-small-latest`.
5. Optionally set `MISTRAL_ENABLE_WEBSEARCH=0` to use chat completions without
   Mistral's built-in web search. `MISTRAL_WEBSEARCH_TOOL` can be set to
   `web_search` or `web_search_premium`.
6. Optionally set `DISCORD_CONTEXT_MESSAGES`; it defaults to `20` and controls
   how many recent channel messages are sent as context when Missy is mentioned.
7. Set `MCP_ADMIN_USER_IDS` and/or `MCP_ADMIN_ROLE_IDS` to Discord users or
   roles that may add local MCP servers through slash commands.
8. Set `MISSY_LOCAL_ACCESS_USER_IDS` and/or `MISSY_LOCAL_ACCESS_ROLE_IDS` to
   Discord users or roles that may use local computer and filesystem tools. If
   omitted, no Discord user can access local files, including in DMs.
9. Set `MISSY_SHUTDOWN_USER_IDS` and/or `MISSY_SHUTDOWN_ROLE_IDS` to Discord
   users or roles that may stop the bot with `/shutdown`. If omitted, no Discord
   user can shut the bot down from Discord.
10. In the Discord Developer Portal, enable the Message Content intent. Server
    Members intent is not required.
11. Invite the bot to a server with the `bot` and `applications.commands`
    scopes. It needs permission to view channels, send messages, read message
    history, and use slash commands.

## Run

```sh
deno task dev
```

## Slash Command Cleanup

Discord can keep old global slash commands cached after you switch to
guild-scoped commands. Missy clears global commands automatically on startup
when `DISCORD_GUILD_IDS` is set and `DISCORD_REGISTER_GLOBAL_COMMANDS` is not
`1`. To remove stale global commands manually:

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
- In a server, run `/set-api-key` once to save a shared server key. Everyone in
  that server can then mention Missy, reply to one of her messages, or prefix a
  message with `!M!`.
- For prefixed server messages, use `!M!<message>` to chat or `!M!clear` to
  clear the saved context.
- Missy can send multiple Discord messages when a response is long or when the
  model separates sections with `MISSY_MESSAGE_BREAK`.
- Missy can react to the triggering message with `MISSY_REACT: <emoji>` and can
  intentionally send no text reply with `MISSY_NO_REPLY`.
- Missy can search the web through Mistral's built-in `web_search` tool when
  answering recent/current-information questions.
- Use `/missy message:<text>` for an ephemeral slash-command chat.
- Use `/model` to see your current Mistral model, `/model model:<name>` to set a
  per-user model override, or `/model model:default` to return to
  `MISTRAL_MODEL`.
- Use `/analyze-history` to ask Missy to inspect recent messages in the current
  channel. The optional `limit` can fetch up to 100 messages.
- Use `/clear` to clear Missy's saved context for your current DM or server
  channel conversation. After a clear, Missy ignores earlier channel history
  unless you explicitly say `look past your clear point`.
- Use `/api-key-status` and `/remove-api-key` to manage the server key in a
  server, or your personal key in DMs.
- Use `/help` to see command and tool availability.
- Use `/mcp-add` to add or replace a local stdio MCP server. Only users or roles
  listed in `MCP_ADMIN_USER_IDS` or `MCP_ADMIN_ROLE_IDS` can run it.
- Use `/shutdown` to stop the running bot process. Only users or roles listed in
  `MISSY_SHUTDOWN_USER_IDS` or `MISSY_SHUTDOWN_ROLE_IDS` can run it. Message
  commands `shutdown` and `/shutdown` are also recognized in DMs or server
  mention/prefix flows.
- Users or roles listed in `MISSY_LOCAL_ACCESS_USER_IDS` or
  `MISSY_LOCAL_ACCESS_ROLE_IDS` can use local computer and filesystem tools from
  DMs or servers. Missy can stat, list, recursively find, read, copy, create
  folders, write text files, move/rename, overwrite, delete local files/folders,
  and use a local Deno REPL for compound file tasks anywhere Deno has OS
  permission, including paths such as `D:\`. The REPL starts without local
  permissions; when it requests read/write/run/net/env access, that permission
  is sent to chat for check/cross approval before rerunning with only the
  approved scoped Deno flag. Users not listed have no local access, including in
  DMs.

## Personality

Missy's response style is loaded from `PERSONALITY.md` on each request. Edit
that file to tune tone, texting style, multi-message behavior, and reaction
rules without changing TypeScript.

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
  file access. Missy hides these from Mistral so file browsing goes through the
  approval-gated built-in filesystem tools instead.
- `agent_sdk_google_query` for Google Drive, Gmail, and Calendar through OpenAI
  connector-backed hosted MCP tools. This requires `OPENAI_API_KEY`.
- `agent_sdk_computer_task` for read-only local computer inspection through the
  Agents SDK shell tool. This requires `OPENAI_API_KEY` and is exposed only for
  users or roles listed in `MISSY_LOCAL_ACCESS_USER_IDS` or
  `MISSY_LOCAL_ACCESS_ROLE_IDS`.

Set `OPENAI_API_KEY` in `.env`. For Google, set either
`GOOGLE_CONNECTOR_AUTHORIZATION` or service-specific
`GOOGLE_DRIVE_AUTHORIZATION`, `GMAIL_AUTHORIZATION`, and
`GOOGLE_CALENDAR_AUTHORIZATION` values. To enable the local computer tool, set
`MISSY_AGENT_ENABLE_COMPUTER=1`; it defaults to disabled and only permits a
small read-only PowerShell command allowlist rooted at
`MISSY_AGENT_COMPUTER_ROOT`. Set `MISSY_DESKTOP_ROOT` if your Desktop is not at
`%USERPROFILE%\Desktop`.

## Filesystem Permissions

Local filesystem access is implemented as built-in Missy tools, not as an MCP
server. The model can use them only when the requesting Discord user ID is
listed in `MISSY_LOCAL_ACCESS_USER_IDS` or one of their role IDs is listed in
`MISSY_LOCAL_ACCESS_ROLE_IDS`; by default, no one is allowed. Allowed users can
inspect paths, list folders, recursively find files, read text files, copy paths
to new destinations, create folders, create text files, move/rename paths,
delete paths, and use a local Deno REPL from DMs or servers. Access is not
limited to the Desktop; absolute paths such as `D:\` work if Deno has OS
permission. The REPL tool starts without local permissions. If the evaluated
code attempts to read, write, run a command, use network, or access environment
variables, Deno returns a missing-permission error; Missy sends that specific
permission request and the REPL code to the requesting Discord user for
check/cross approval, then reruns with only the approved scoped Deno flag. The
`deno task dev` command grants broad read/write/run permission to the bot so it
can host this app-level approval gate and launch permission-scoped child Deno
processes.

For example, a local-access user can ask Missy to locate model files in their
home directory and move them into a new folder. Missy can choose an appropriate
recursive Deno snippet, forward Deno's requested read/write permissions to chat,
then execute it after approval instead of only explaining what the user should
type.

Filesystem approval prompts and tool execution are logged to stdout as JSON.
Logs include the Discord user ID, username, guild/channel where available,
action, source path, destination path, target path, approval result, and
execution success/failure. File contents are not written to the log.

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
ID to `MCP_ADMIN_USER_IDS` or one of your Discord role IDs to
`MCP_ADMIN_ROLE_IDS`, then restart.
