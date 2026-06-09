# Missy

Missy is a Discord bot with pluggable model, search, and MCP providers. Mistral
and Brave Search remain the default built-in provider modules.

this is vibe-coded, dont use in real-life scenarios. its for my own use.

heavily inspired by poke ai by the interaction company.

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
4. Optionally set `MISSY_MODEL_PROVIDER`; it defaults to `mistral`. Set it to
   `openai-compatible` to use an OpenAI-compatible chat completions endpoint and
   configure `MISSY_OPENAI_COMPATIBLE_CHAT_COMPLETIONS_URL`.
5. Optionally set `MISSY_MODEL`; it defaults to `mistral-small-latest` through
   the Mistral provider. `MISTRAL_MODEL` is still accepted as a compatibility
   fallback. Set the model to `router` to let Missy choose a concrete model per
   request. Router targets can be changed with `MISTRAL_ROUTER_FAST_MODEL`,
   `MISTRAL_ROUTER_GENERAL_MODEL`, `MISTRAL_ROUTER_TOOL_MODEL`,
   `MISTRAL_ROUTER_VISION_MODEL`, and `MISTRAL_ROUTER_REASONING_MODEL`.
6. Optionally set `MISSY_SEARCH_PROVIDER`; it defaults to `brave`. Set
   `BRAVE_SEARCH_API_KEY` to enable current web, image, video, and news lookups
   through the Brave provider. Optionally set `BRAVE_ENABLE_SEARCH=0` to disable
   search tools, or set `BRAVE_SEARCH_COUNTRY`, `BRAVE_SEARCH_LANG`, and
   `BRAVE_SEARCH_UI_LANG` to change Brave defaults. Set
   `MISSY_SEARCH_PROVIDER=http-json` and `MISSY_SEARCH_HTTP_URL` to send search
   tool calls to a custom HTTP JSON search plugin; optional
   `MISSY_SEARCH_HTTP_API_KEY`, `MISSY_SEARCH_HTTP_AUTH_HEADER`, and
   `MISSY_SEARCH_HTTP_AUTH_PREFIX` configure auth.
7. Optionally set `MISTRAL_USE_CONVERSATIONS=1` to use Mistral's Conversations
   API for non-vision messages when `MISSY_MODEL_PROVIDER=mistral`.
8. Optionally set `DISCORD_CONTEXT_MESSAGES`; it defaults to `20` and controls
   how many recent channel messages are sent as context when Missy is mentioned.
9. Optionally set `GIPHY_API_KEY` to let Missy resolve GIF search replies
   through the GIPHY API.
10. Set `MCP_ADMIN_USER_IDS` and/or `MCP_ADMIN_ROLE_IDS` to Discord users or
    roles that may add local MCP servers through slash commands.
11. Set `MISSY_LOCAL_ACCESS_USER_IDS` and/or `MISSY_LOCAL_ACCESS_ROLE_IDS` to
    Discord users or roles that may use the embedded Deno REPL and upload
    approved local files. If omitted, no Discord user can access local files,
    including in DMs.
12. Set `MISSY_SHUTDOWN_USER_IDS` and/or `MISSY_SHUTDOWN_ROLE_IDS` to Discord
    users or roles that may stop the bot with `/shutdown`. If omitted, no
    Discord user can shut the bot down from Discord.
13. In the Discord Developer Portal, enable the Message Content intent. Enable
    the Server Members intent too if you want Missy to search members by
    nickname/display name/username across the server.
14. Invite the bot to a server with the `bot` and `applications.commands`
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

- DM Missy your active model provider API key once, then DM normally to chat.
- In a server, run `/set-api-key` once to save a shared server key. Everyone in
  that server can then mention Missy, reply to one of her messages, or prefix a
  message with `!M!`.
- For prefixed server messages, use `!M!<message>` to chat or `!M!clear` to
  clear the saved context.
- Missy can send multiple Discord messages when a response is long or when the
  model separates sections with `MISSY_MESSAGE_BREAK`.
- Missy can react to the triggering message with `MISSY_REACT: <emoji>` and can
  intentionally send no text reply with `MISSY_NO_REPLY`.
- Missy can resolve GIF replies through GIPHY when `GIPHY_API_KEY` is set.
- Image attachments are sent to vision-capable chat completions models as
  structured image inputs.
- Missy can search the web, images, videos, and news through the configured
  search provider when answering recent/current-information or explicit online
  lookup questions.
- Use `/missy message:<text>` for an ephemeral slash-command chat.
- Use `/model` to see your current model, `/model model:<name>` to set a
  per-user model override, `/model model:router` to route per request, or
  `/model model:default` to return to `MISSY_MODEL`.
- Use `/status` to check which Mistral models are available to the saved API key
  and whether your current model is listed.
- Use `/analyze-history` to ask Missy to inspect recent messages in the current
  channel. The optional `limit` can fetch up to 100 messages.
- In servers, Missy can inspect server info, search members, list roles, list
  channels, and send a plain text message to a channel when you explicitly ask
  or confirm the target channel and content. Member search works best when the
  Discord Developer Portal Server Members intent is enabled.
- Use `/clear` to clear Missy's saved context for your current DM or server
  channel conversation. In servers it also clears the user+server memory scope
  for the person running it. After a clear, Missy ignores earlier channel
  history unless you explicitly say `look past your clear point`.
- Use `/skills` to browse Missy's available skills with a Discord select menu.
- Use `/memory` to list, add, remove, or clear persistent memories. Scopes are
  `user`, `server`, and `user-server`; the list view includes buttons, an add
  modal, and a delete menu for the selected scope. Missy can also save memories
  during chat when the user asks her to remember something or a stable
  preference is useful. The `id` field autocompletes saved memories for removal.
- Right-click a Discord message or user and use `Apps > Missy: remember message`
  or `Apps > Missy: remember user` to save a memory without copying text into a
  slash command.
- Use `/automation` in servers to list, add, edit, remove, or clear
  trigger-based automations. The list view includes buttons plus add/edit modals
  for faster management, the `id` field autocompletes configured automations,
  and slash-command adds or edits can be limited to a specific channel. Editing
  automations requires Discord's Manage Server permission.
- In normal chat, ask Missy to create a scheduled task when you want a daily
  timed lookup or notification. For example, "message me at 7:00am with the best
  390X bus route to arrive at Tempe High School by 8:40" lets Missy save a daily
  task that runs at that local time, performs the lookup with current tools, and
  DMs or posts the result.
- Missy can save self-authored skills for repeatable workflows, API patterns,
  and automation procedures. These are stored in the app data directory and are
  read back on later requests in the same user or server context. Skills should
  not contain secrets.
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
  `MISSY_LOCAL_ACCESS_ROLE_IDS` can use the embedded Deno REPL from DMs or
  servers and can upload selected local files into Discord after read approval.
  The REPL can perform compound local tasks anywhere Deno has OS permission,
  including paths such as `D:\`. It starts without local permissions; when it
  requests read/write/run/net/env access, that permission is sent to chat for
  check/cross approval before rerunning with only the approved scoped Deno flag.
  Local file uploads also ask for read approval first. Users not listed have no
  local access, including in DMs.

## Personality

Missy's response style is loaded from `PERSONALITY.md` on each request. Edit
that file to tune tone, texting style, multi-message behavior, and reaction
rules without changing TypeScript.

## Deno REPL Permissions

The only embedded local tool is `missy_deno_repl`. Other local computer,
desktop, Google, or service-specific capabilities should be supplied as MCP
plugins in `mcp.json` or through `/mcp-add`.

The model can use the Deno REPL only when the requesting Discord user ID is
listed in `MISSY_LOCAL_ACCESS_USER_IDS` or one of their role IDs is listed in
`MISSY_LOCAL_ACCESS_ROLE_IDS`; by default, no one is allowed. The REPL starts
without local permissions. If evaluated code attempts to read, write, run a
command, use network, or access environment variables, Deno returns a
missing-permission error; Missy sends that specific permission request and the
REPL code to the requesting Discord user for check/cross approval, then reruns
with only the approved scoped Deno flag. The `deno task dev` command grants
broad read/write/run permission to the bot so it can host this app-level
approval gate and launch permission-scoped child Deno processes.

For example, a local-access user can ask Missy to locate model files in their
home directory and move them into a new folder. Missy can choose an appropriate
recursive Deno snippet, forward Deno's requested read/write permissions to chat,
then execute it after approval instead of only explaining what the user should
type.

REPL permission prompts, local attachment read approvals, and tool execution are
logged to stdout as JSON. Logs include the Discord user ID, username,
guild/channel where available, action, permission, target path, approval result,
and execution success/failure. File contents are not written to the log.

## Context

Missy stores runtime data such as contexts, memories, API keys, model choices,
and automations in the OS app data directory by default. On Windows this is
`%LOCALAPPDATA%\Missy`; on macOS it is `~/Library/Application Support/Missy`; on
Linux it is `${XDG_DATA_HOME:-~/.local/share}/missy`. Set `MISSY_DATA_DIR` to
override this location. Legacy repo-local `data/*.json` files are ignored by git
and are migrated into the app data directory on first read.

To clear all runtime data and start from a blank slate, stop Missy and run:

```sh
deno task data:reset -- --yes
```

Conversation context is scoped to the guild, channel, and user so different
users do not share saved chat state. DMs are scoped to the Discord user.

## MCP

Missy can expose local stdio or remote HTTP MCP server tools to the active model
provider. You can copy `mcp.example.json` to `mcp.json` and configure servers
manually:

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

Configured MCP tools are loaded on demand. Tool names are exposed to the active
model provider as `<server>_<tool>`. The `mcp.json` file is ignored by git
because it may contain local paths or credentials.

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

## Public API Lookup

Missy has a built-in read-only `missy_http_get` tool for public HTTP(S) API docs
and unauthenticated public JSON/text endpoints. It blocks localhost and
private-network targets and does not send arbitrary auth headers. For APIs that
need keys, OAuth, writes, or service-specific actions, configure an MCP server
or the HTTP JSON search provider instead.
