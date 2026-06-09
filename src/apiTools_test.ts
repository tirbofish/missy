import { assertEquals, assertRejects } from "@std/assert";
import { callApiTool, isApiTool, shouldUseApiFetch } from "./apiTools.ts";

Deno.test("detects public API lookup intent", () => {
  assertEquals(shouldUseApiFetch("haha"), false);
  assertEquals(shouldUseApiFetch("look up the bus timetable API"), true);
  assertEquals(
    shouldUseApiFetch("inspect https://example.com/data.json"),
    true,
  );
});

Deno.test("blocks local HTTP fetch targets", async () => {
  await assertRejects(
    () => callApiTool("missy_http_get", { url: "http://localhost:8080" }),
    Error,
    "Local and private-network URLs are blocked",
  );
  assertEquals(isApiTool("missy_http_get"), true);
});
