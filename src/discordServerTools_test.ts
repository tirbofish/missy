import { assertEquals } from "@std/assert";
import {
  callDiscordServerTool,
  DISCORD_SERVER_TOOL_NAMES,
  isDiscordServerTool,
  shouldUseDiscordServerTools,
} from "./discordServerTools.ts";

function fakeCache<T>(values: T[]): { values: () => IterableIterator<T> } {
  return new Map(values.map((value, index) => [String(index), value]));
}

Deno.test("detects Discord server tool prompts", () => {
  assertEquals(shouldUseDiscordServerTools("who do you think is aric?"), true);
  assertEquals(
    shouldUseDiscordServerTools("Out of everyone in the server, who is aric?"),
    true,
  );
  assertEquals(
    shouldUseDiscordServerTools("post in <#123456789012345678> hi"),
    true,
  );
  assertEquals(shouldUseDiscordServerTools("what is the weather"), false);
  assertEquals(isDiscordServerTool("missy_discord_search_members"), true);
});

Deno.test("returns server, channel, and role summaries", async () => {
  const guild = {
    channels: {
      cache: fakeCache([
        {
          id: "c1",
          isTextBased: () => true,
          name: "general",
          parentId: null,
          rawPosition: 1,
          type: 0,
        },
      ]),
    },
    id: "g1",
    memberCount: 42,
    name: "Test Server",
    ownerId: "u1",
    preferredLocale: "en-US",
    roles: {
      cache: fakeCache([
        {
          hexColor: "#ffffff",
          hoist: false,
          id: "g1",
          name: "@everyone",
          position: 0,
        },
        {
          hexColor: "#ff0000",
          hoist: true,
          id: "r1",
          name: "Admin",
          position: 2,
        },
      ]),
    },
  };
  const context = {
    currentChannelId: "c1",
    guild,
    requesterId: "u1",
  } as never;

  assertEquals(
    JSON.parse(
      await callDiscordServerTool(
        DISCORD_SERVER_TOOL_NAMES.serverInfo,
        {},
        context,
      ),
    ).name,
    "Test Server",
  );
  assertEquals(
    JSON.parse(
      await callDiscordServerTool(
        DISCORD_SERVER_TOOL_NAMES.listChannels,
        { query: "gen" },
        context,
      ),
    ).channels[0].name,
    "general",
  );
  assertEquals(
    JSON.parse(
      await callDiscordServerTool(
        DISCORD_SERVER_TOOL_NAMES.listRoles,
        { query: "admin" },
        context,
      ),
    ).roles[0].name,
    "Admin",
  );
});
