import { assertEquals } from "@std/assert";
import {
  isStandaloneCasualMessage,
  shouldUsePriorConversation,
} from "./contextIntent.ts";

Deno.test("standalone casual messages do not use prior context", () => {
  assertEquals(isStandaloneCasualMessage("holla at me"), true);
  assertEquals(shouldUsePriorConversation("holla at me"), false);
  assertEquals(shouldUsePriorConversation("hello"), false);
  assertEquals(shouldUsePriorConversation("haha"), false);
  assertEquals(shouldUsePriorConversation("lmao"), false);
});

Deno.test("follow-up messages use prior context", () => {
  assertEquals(
    shouldUsePriorConversation("anything else, preferably cheaper?"),
    true,
  );
  assertEquals(shouldUsePriorConversation("sydney"), true);
  assertEquals(shouldUsePriorConversation("look past your clear point"), true);
  assertEquals(shouldUsePriorConversation("hurry up im waiting"), true);
});
