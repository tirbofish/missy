import { assertEquals } from "@std/assert";
import { splitDiscordMessage } from "./discord/message-split.ts";

Deno.test("splitDiscordMessage keeps chunks within the configured limit", () => {
  const chunks = splitDiscordMessage("one two three four five", 10);

  assertEquals(chunks, ["one two", "three four", "five"]);
});
