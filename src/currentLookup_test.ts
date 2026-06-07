import { assertEquals } from "@std/assert";
import {
  currentLookupStatusMessage,
  isCurrentLookupRequest,
} from "./currentLookup.ts";

Deno.test("sports score requests are current lookups", () => {
  assertEquals(
    isCurrentLookupRequest(
      "what is the score on the latest knicks vs spurs game?",
    ),
    true,
  );
});

Deno.test("casual messages are not current lookups", () => {
  assertEquals(isCurrentLookupRequest("holla at me"), false);
});

Deno.test("current lookup status messages are short", () => {
  const status = currentLookupStatusMessage(
    "what is the score on the latest knicks vs spurs game?",
  );

  assertEquals(status.split(/\s+/).length <= 4, true);
});
