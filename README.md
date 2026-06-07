# Missy

Missy is a Discord bot powered by the Mistral chat completions API.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN` to your Discord bot token.
3. Optionally set `MISTRAL_MODEL`; it defaults to `mistral-small-latest`.
4. In the Discord Developer Portal, enable the Message Content intent and Server
   Members intent is not required.
5. Invite the bot to a server with the `bot` and `applications.commands` scopes.
   It needs permission to view channels, send messages, read message history,
   and use slash commands.

## Run

```sh
deno task dev
```

## Use

- DM Missy your Mistral API key once, then DM normally to chat.
- In a server, run `/set-api-key` once, then mention Missy or reply to one of
  her messages.
- Use `/missy message:<text>` for an ephemeral slash-command chat.
- Use `/missy-test` to verify your saved Mistral key.
- Use `/api-key-status` and `/remove-api-key` to manage your saved key.
