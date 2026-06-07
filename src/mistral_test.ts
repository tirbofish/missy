import { assertEquals } from "@std/assert";
import {
  shouldShowSourcesForRequest,
  splitDiscordMessages,
} from "./mistral.ts";

Deno.test("splits explicit message separators", () => {
  assertEquals(splitDiscordMessages("first\n---\nsecond"), [
    "first",
    "second",
  ]);
});

Deno.test("splits inline Missy message separators", () => {
  assertEquals(
    splitDiscordMessages("series is 2-0 knicks MISSY_MESSAGE_BREAK\nnext game"),
    [
      "series is 2-0 knicks",
      "next game",
    ],
  );
});

Deno.test("splits short casual multiline replies", () => {
  assertEquals(splitDiscordMessages("nah\nsame old missy, different day"), [
    "nah",
    "same old missy, different day",
  ]);
});

Deno.test("does not auto split lists", () => {
  const message = "- one\n- two";

  assertEquals(splitDiscordMessages(message), [message]);
});

Deno.test("detects explicit source requests", () => {
  assertEquals(shouldShowSourcesForRequest("who won the game"), false);
  assertEquals(shouldShowSourcesForRequest("is linux open source"), false);
  assertEquals(shouldShowSourcesForRequest("what is a url"), false);
  assertEquals(shouldShowSourcesForRequest("where did you find that"), true);
  assertEquals(shouldShowSourcesForRequest("where'd you read that"), true);
  assertEquals(shouldShowSourcesForRequest("link it"), true);
  assertEquals(shouldShowSourcesForRequest("send sources pls"), true);
});
