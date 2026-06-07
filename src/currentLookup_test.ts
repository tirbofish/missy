import { assertEquals } from "@std/assert";
import {
  currentLookupStatusMessage,
  isCurrentLookupRequest,
  isCurrentLookupWaitingOnlyResponse,
} from "./currentLookup.ts";

Deno.test("sports score requests are current lookups", () => {
  assertEquals(
    isCurrentLookupRequest(
      "what is the score on the latest knicks vs spurs game?",
    ),
    true,
  );
});

Deno.test("sports finals predictions are current lookups", () => {
  assertEquals(
    isCurrentLookupRequest(
      "do you think the Vegas golden knights will win or the Carolina hurricanes in the nhl finals",
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

Deno.test("detects waiting-only lookup replies", () => {
  assertEquals(
    isCurrentLookupWaitingOnlyResponse(
      "lemme check the current finals matchup",
    ),
    true,
  );
  assertEquals(
    isCurrentLookupWaitingOnlyResponse(
      "carolina probably has the edge, but it's close",
    ),
    false,
  );
});
