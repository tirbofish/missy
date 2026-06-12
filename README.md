# Missy Modular Agent

Missy is a Deno TypeScript AI agent with a small core runtime and dynamically
loaded modules.

## What is modular

- `src/core`: orchestration, config, XML contract, tool registry, dynamic module
  loading.
- `src/providers/openai`: OpenAI SDK provider. Set `OPENAI_BASE_URL` to use
  OpenAI-compatible providers.
- `src/providers/mistral`: Mistral TypeScript SDK provider.
- `src/platforms/discord`: Discord platform adapter using `discord.js`.
- `src/platforms/matrix`: Matrix platform adapter using `matrix-js-sdk`.
- `src/plugins/*`: plug-n-play tool plugins. Each plugin lives in its own folder
  with a `mod.ts`.
- `src/web-search-providers/*`: plug-n-play providers used by the `web.search`
  tool.
- `personality.xml`: XML personality instructions injected into the model
  prompt.

## Run

Copy `.env.example` into your environment, then run:

```powershell
deno task start
```

For development:

```powershell
deno task dev
```

To inspect the configured launch state without starting Discord:

```powershell
deno task status
```

For one-off launch customization, use `bootstrap.ts`:

```powershell
deno task bootstrap -- start --provider=mistral --providers=mistral
deno task bootstrap -- status --platforms=discord --web-search-providers=duckduckgo,brave
```

## Discord

The Discord platform supports three ways to talk to Missy:

- Mention chat: `hello @Missy` or `@Missy what's up?`
- Prefix chat and commands: `!M! what's the weather for me?`, `!M! tools`,
  `!M! plugins`, `!M! memory`, `!M! status`, `!M! help`
- Slash commands: `/missy`, `/tools`, `/plugins`, `/memory`, `/status`

Discord replies are split automatically using `DISCORD_MAX_MESSAGE_LENGTH` so
long XML or normal responses do not exceed Discord message limits.

DMs do not require a mention or prefix. Server messages are handled when Missy
is mentioned, when `!M!` is used, or when the message replies to one of Missy's
messages. Set `DISCORD_RESPOND_TO_ALL_MESSAGES=true` if you want Missy to see
and decide on every server message.

Optional reaction settings:

- `DISCORD_REACT_TO_HANDLED_MESSAGES=true` makes Missy add
  `DISCORD_HANDLED_REACTION_EMOJI` to messages she handles.
- `DISCORD_OBSERVE_REACTIONS=true` makes Missy receive reaction events added to
  her own messages.
- `DISCORD_INCLUDE_REPLY_CONTEXT=true` includes the replied-to message in the
  core input.

## Matrix

The Matrix platform lets you talk to Missy through any Matrix client:

- Direct rooms: messages are handled without a mention or prefix.
- Group rooms: Missy responds when mentioned, when `!M!` is used, or when the
  message replies to one of Missy's messages.
- Commands: `!M! help`, `!M! status`, `!M! memory`, `!M! plugins`,
  `!M! tools`, or `!M! <message>`.

Enable Matrix instead of Discord:

```env
PLATFORMS=matrix
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=your-bot-access-token
MATRIX_USER_ID=@missy:matrix.org
```

Optional settings:

- `MATRIX_ROOM_IDS=!room:server,#alias:server` joins those rooms on startup.
- `MATRIX_COMMAND_PREFIX=!M!` changes the command prefix.
- `MATRIX_DISPLAY_NAME=Missy` controls fallback plain-text mention detection.
- `MATRIX_RESPOND_TO_ALL_MESSAGES=true` lets Missy see every group-room
  message.
- `MATRIX_INCLUDE_REPLY_CONTEXT=true` includes replied-to messages when they are
  still in the live timeline.
- `MATRIX_MAX_MESSAGE_LENGTH=4000` controls reply splitting.
- `MATRIX_AUTO_JOIN_INVITES=true` joins rooms when the bot account is invited.

## Adding a Plugin

Create a package folder under `src/plugins`:

```text
src/plugins/my-plugin/bootstrap.ts
src/plugins/my-plugin/package.json
src/plugins/my-plugin/src/mod.ts
src/plugins/my-plugin/mod.ts
```

Every package outside `src/core` owns a `bootstrap.ts` and `src/` folder. The
root bootstrap discovers those child bootstraps and gathers config fields, env
variables, CLI flags, and package entrypoints from them.

For plugins, `bootstrap.ts` also receives plugin management services, including
a plugin-scoped `keystore` and shared `globalKeystore`, then returns the plugin
module:

```ts
import type { PackageBootstrapModule } from "../../core/types.ts";
import plugin from "./mod.ts";

const bootstrap: PackageBootstrapModule = {
  metadata: plugin.metadata,
  kind: "plugin",
  modulePath: "src/mod.ts",
  configSchema: plugin.configSchema,
  async bootstrap(context) {
    const previous = context.keystore.get("lastStart");
    await context.keystore.set("lastStart", new Date().toISOString());
    return plugin;
  },
};

export default bootstrap;
```

Export the actual `PluginModule` from `src/mod.ts`; `mod.ts` can remain as a
compatibility re-export while packages are being migrated:

```ts
import type { PluginModule } from "../../../core/types.ts";

const module: PluginModule = {
  metadata: {
    name: "my-plugin",
    description: "My plugin.",
    version: "0.1.0",
  },
  setup(context) {
    context.tools.register({
      name: "my.action",
      description: "Do one thing.",
      inputSchema: { type: "object", properties: {} },
      execute(input, toolContext) {
        return { ok: true, input, channelId: toolContext.message.channelId };
      },
    });
  },
};

export default module;
```

The core discovers plugin folders at startup from `PLUGINS_DIR`.
Plugin bootstrap state is saved through `KEYSTORE_PATH`, which defaults to
`data/keystore.json`.

## Adding an AI Provider

Create a package folder under `src/providers` with `bootstrap.ts`,
`package.json`, and `src/mod.ts`. The package bootstrap declares its
`ConfigSchema`, env variables, and module entrypoint. Add it to `AI_PROVIDERS`,
and set `AI_PROVIDER` to the default provider Missy should use for normal model
calls.

The built-in `openai` provider uses the official OpenAI SDK and supports
`OPENAI_BASE_URL` for OpenAI-compatible services.

The built-in `mistral` provider uses Mistral's official TypeScript SDK:

```env
AI_PROVIDER=mistral
AI_PROVIDERS=mistral
MISTRAL_API_KEY=your-key
MISTRAL_MODEL=mistral-small-latest
```

## Web Search

Missy gets web search through the `web.search` plugin tool. The tool accepts:

```json
{
  "query": "latest Deno release",
  "maxResults": 5,
  "providers": ["duckduckgo", "brave"]
}
```

Configured search providers are loaded from `WEB_SEARCH_PROVIDERS_DIR`, with the
enabled list controlled by `WEB_SEARCH_PROVIDERS`.

Built-in providers:

- `duckduckgo`: no API key, uses DuckDuckGo Instant Answer.
- `brave`: requires `BRAVE_SEARCH_API_KEY`.

## Weather And Memory

Missy has a `weather.current` tool. The core maintains per-user memory in
`MEMORY_PATH`.

Discord memory commands:

- `!M! memory` or `/memory` shows your stored memory.
- `!M! memory all` or `/memory scope:all` shows all stored memory visible to the
  bot process.

When a user says something like
`@Missy I live in Sydney, so find the weather
for me`, the model is instructed
to emit a memory update such as `location = Sydney` and call `weather.current`
for Sydney. Later, when the same user asks `@Missy what's the weather for me?`,
the core includes that user's memory in the model input so the weather tool can
be called with Sydney again.

## Adding a Platform

Create a folder under `src/platforms` with a `mod.ts` that exports a
`PlatformModule`. Add its metadata name to `PLATFORMS`.

Matrix or another chat platform can be added this way without changing the core.

## XML Output Contract

The model is instructed to always return:

```xml
<agent>
  <respond>true</respond>
  <message>Text for the user.</message>
  <memory_updates>
    <memory key="location">Sydney</memory>
  </memory_updates>
  <tool_calls>
    <tool_call name="time.now">
      <input>{}</input>
    </tool_call>
  </tool_calls>
</agent>
```

The core parses this XML, runs requested tools, then asks the model for a final
XML response.
