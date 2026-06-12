import { expect, test } from "bun:test";
import { inferMemoryUpdates } from "./app.ts";

test("inferMemoryUpdates stores explicit user location", () => {
  expect(
    inferMemoryUpdates("Missy, I live in Sydney, so find the weather for me"),
  ).toEqual([{ key: "location", value: "Sydney" }]);
});
