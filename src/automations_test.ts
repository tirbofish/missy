import { assertEquals } from "@std/assert";
import {
  automationComponentId,
  automationEditModalId,
  automationIdAutocompleteChoices,
  buildAutomationPrompt,
  findMatchingAutomation,
  parseAutomationComponentId,
  parseAutomationEditModalId,
} from "./automations.ts";

const automation = {
  channelId: undefined,
  id: "a1",
  trigger: "ship it",
  prompt: "reply with a release checklist",
  enabled: true,
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
  createdBy: "1",
};

Deno.test("finds enabled automation by case-insensitive trigger", () => {
  assertEquals(
    findMatchingAutomation([automation], "Okay, SHIP IT today")?.id,
    "a1",
  );
  assertEquals(findMatchingAutomation([automation], "not yet"), undefined);
  assertEquals(
    findMatchingAutomation([{ ...automation, enabled: false }], "ship it"),
    undefined,
  );
  assertEquals(
    findMatchingAutomation(
      [
        { ...automation, channelId: "channel-1" },
      ],
      "ship it",
      "channel-2",
    ),
    undefined,
  );
  assertEquals(
    findMatchingAutomation(
      [
        { ...automation, channelId: "channel-1" },
      ],
      "ship it",
      "channel-1",
    )?.id,
    "a1",
  );
});

Deno.test("builds and parses automation component ids", () => {
  assertEquals(automationComponentId("add"), "missy-automation:add");
  assertEquals(
    automationComponentId("toggle", "a1"),
    "missy-automation:toggle:a1",
  );
  assertEquals(
    automationComponentId("edit", "a1"),
    "missy-automation:edit:a1",
  );
  assertEquals(parseAutomationComponentId("missy-automation:refresh"), {
    action: "refresh",
    automationId: undefined,
  });
  assertEquals(parseAutomationComponentId("missy-automation:edit:a1"), {
    action: "edit",
    automationId: "a1",
  });
  assertEquals(parseAutomationComponentId("missy-automation:delete:a1"), {
    action: "delete",
    automationId: "a1",
  });
  assertEquals(
    parseAutomationComponentId("missy-automation:toggle"),
    undefined,
  );
  assertEquals(parseAutomationComponentId("other:toggle:a1"), undefined);
  assertEquals(automationEditModalId("a1"), "missy-automation-edit-modal:a1");
  assertEquals(
    parseAutomationEditModalId("missy-automation-edit-modal:a1"),
    "a1",
  );
  assertEquals(parseAutomationEditModalId("other:a1"), undefined);
});

Deno.test("builds automation id autocomplete choices", () => {
  assertEquals(automationIdAutocompleteChoices([automation], "ship"), [{
    name: "a1 - on - ship it",
    value: "a1",
  }]);
  assertEquals(
    automationIdAutocompleteChoices([
      { ...automation, channelId: "123" },
    ], "123"),
    [{
      name: "a1 - on - <#123> - ship it",
      value: "a1",
    }],
  );
  assertEquals(automationIdAutocompleteChoices([automation], "missing"), []);
});

Deno.test("builds automation prompt with trigger and original message", () => {
  assertEquals(
    buildAutomationPrompt({
      id: "a1",
      channelId: "123",
      trigger: "standup",
      prompt: "summarize blockers",
      enabled: true,
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      createdBy: "1",
    }, "standup: waiting on review"),
    [
      'A Discord server automation matched trigger "standup".',
      "Automation channel scope: <#123>.",
      "Automation instruction: summarize blockers",
      "",
      "Original user message: standup: waiting on review",
    ].join("\n"),
  );
});
