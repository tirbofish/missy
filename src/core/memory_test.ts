import { assertEquals } from "@std/assert";
import { inferMemoryUpdates } from "./app.ts";

Deno.test("inferMemoryUpdates stores explicit user location", () => {
  assertEquals(
    inferMemoryUpdates("Missy, I live in Sydney, so find the weather for me"),
    [{ key: "location", value: "Sydney" }],
  );
});
