import { assertEquals } from "@std/assert";
import {
  buildMemoryListMessage,
  buildMessageMemoryContent,
  buildScopedMemoryListMessage,
  buildUserMemoryContent,
  memoryAddModalId,
  memoryComponentId,
  memoryIdAutocompleteChoices,
  parseMemoryAddModalId,
  parseMemoryComponentId,
  parseMemoryScope,
} from "./memories.ts";

const memory = {
  id: "m1",
  content: "likes concise replies",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
  createdBy: "1",
};

Deno.test("parses memory scope aliases", () => {
  assertEquals(parseMemoryScope("user"), "user");
  assertEquals(parseMemoryScope("server"), "server");
  assertEquals(parseMemoryScope("combined"), "user-server");
  assertEquals(parseMemoryScope("server_user"), "user-server");
  assertEquals(parseMemoryScope("unknown"), undefined);
});

Deno.test("builds context menu message memory content", () => {
  assertEquals(
    buildMessageMemoryContent({
      attachmentCount: 2,
      authorLabel: "tester#0001",
      content: "  remember   this bit  ",
    }),
    "Message from tester#0001: remember this bit [2 attachments]",
  );
  assertEquals(buildMessageMemoryContent({ content: "" }), undefined);
});

Deno.test("builds context menu user memory content", () => {
  assertEquals(
    buildUserMemoryContent({
      displayName: "Thribhu",
      userId: "123",
      username: "thribhuwu",
    }),
    "Discord user ID 123 is thribhuwu and is known here as Thribhu",
  );
});

Deno.test("builds and parses memory component ids", () => {
  assertEquals(
    memoryComponentId("add", "user-server"),
    "missy-memory:add:user-server",
  );
  assertEquals(parseMemoryComponentId("missy-memory:delete:server"), {
    action: "delete",
    scope: "server",
  });
  assertEquals(parseMemoryComponentId("missy-memory:delete:nope"), undefined);
  assertEquals(memoryAddModalId("user"), "missy-memory-add-modal:user");
  assertEquals(
    parseMemoryAddModalId("missy-memory-add-modal:user-server"),
    "user-server",
  );
  assertEquals(parseMemoryAddModalId("missy-memory-add-modal:nope"), undefined);
});

Deno.test("builds memory id autocomplete choices", () => {
  assertEquals(memoryIdAutocompleteChoices([memory], "concise"), [{
    name: "m1 - likes concise replies",
    value: "m1",
  }]);
  assertEquals(memoryIdAutocompleteChoices([memory], "missing"), []);
});

Deno.test("formats memory list by scope", () => {
  assertEquals(
    buildMemoryListMessage({
      user: [{
        ...memory,
        id: "u1",
      }],
      server: [],
      "user-server": [{
        id: "s1",
        content: "uses AU timezone in this server",
        createdAt: "2026-06-08T00:00:00.000Z",
        updatedAt: "2026-06-08T00:00:00.000Z",
        createdBy: "1",
      }],
    }),
    [
      "User memories:",
      "- (u1) likes concise replies",
      "",
      "Memories for this user in this server:",
      "- (s1) uses AU timezone in this server",
    ].join("\n"),
  );
});

Deno.test("formats scoped memory lists", () => {
  assertEquals(
    buildScopedMemoryListMessage("server", []),
    "No server memories are saved for this context.",
  );
});
