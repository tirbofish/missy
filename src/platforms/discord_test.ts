import { expect, test } from "bun:test";
import { splitDiscordMessage } from "./discord/message-split.ts";

test("splitDiscordMessage keeps chunks within the configured limit", () => {
  const chunks = splitDiscordMessage("one two three four five", 10);
  expect(chunks).toEqual(["one two", "three four", "five"]);
});
