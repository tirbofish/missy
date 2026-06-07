import { assertEquals } from "@std/assert";
import { hasConfiguredPermission } from "./permissions.ts";

Deno.test("configured permissions allow direct user ids", () => {
  Deno.env.set("TEST_USER_IDS", "123,456");
  Deno.env.set("TEST_ROLE_IDS", "");

  assertEquals(
    hasConfiguredPermission(
      { userId: "123", roleIds: [] },
      "TEST_USER_IDS",
      "TEST_ROLE_IDS",
    ),
    true,
  );
});

Deno.test("configured permissions allow role ids", () => {
  Deno.env.set("TEST_USER_IDS", "");
  Deno.env.set("TEST_ROLE_IDS", "role-a role-b");

  assertEquals(
    hasConfiguredPermission(
      { userId: "999", roleIds: ["role-b"] },
      "TEST_USER_IDS",
      "TEST_ROLE_IDS",
    ),
    true,
  );
});

Deno.test("configured permissions reject unmatched actors", () => {
  Deno.env.set("TEST_USER_IDS", "123");
  Deno.env.set("TEST_ROLE_IDS", "role-a");

  assertEquals(
    hasConfiguredPermission(
      { userId: "999", roleIds: ["role-z"] },
      "TEST_USER_IDS",
      "TEST_ROLE_IDS",
    ),
    false,
  );
});
