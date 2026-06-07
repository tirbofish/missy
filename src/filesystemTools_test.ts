import { assertEquals, assertRejects } from "@std/assert";
import path from "node:path";
import {
  callFilesystemTool,
  FILESYSTEM_TOOL_NAMES,
  filesystemTools,
  resolveLocalPath,
} from "./filesystemTools.ts";

Deno.test("local Deno REPL tool is exposed to the model", () => {
  assertEquals(
    filesystemTools.some((tool) =>
      tool.function.name === FILESYSTEM_TOOL_NAMES.denoRepl
    ),
    true,
  );
});

Deno.test("filesystem paths expand home shorthand", () => {
  const previousUserProfile = Deno.env.get("USERPROFILE");
  const previousHome = Deno.env.get("HOME");
  const testHome = path.resolve("tmp-test-home");

  try {
    Deno.env.set("USERPROFILE", testHome);
    Deno.env.delete("HOME");

    assertEquals(resolveLocalPath("~"), testHome);
    assertEquals(
      resolveLocalPath("~/Downloads"),
      path.join(testHome, "Downloads"),
    );
    assertEquals(
      resolveLocalPath("~\\Documents"),
      path.join(testHome, "Documents"),
    );
  } finally {
    if (previousUserProfile === undefined) {
      Deno.env.delete("USERPROFILE");
    } else {
      Deno.env.set("USERPROFILE", previousUserProfile);
    }

    if (previousHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", previousHome);
    }
  }
});

Deno.test("local Deno REPL tool requires approval for requested permissions", async () => {
  await assertRejects(
    () =>
      callFilesystemTool(FILESYSTEM_TOOL_NAMES.denoRepl, {
        code: "await Deno.readTextFile('deno.json')",
      }),
    Error,
    "approval prompt",
  );
});

Deno.test("local Deno REPL tool keeps read permissions scoped", async () => {
  const approvalTargets: string[] = [];
  const result = JSON.parse(
    await callFilesystemTool(
      FILESYSTEM_TOOL_NAMES.denoRepl,
      {
        code:
          "await Deno.readTextFile('deno.json'); await Deno.readTextFile('README.md')",
      },
      (request) => {
        approvalTargets.push(request.permission?.target ?? "");
        return Promise.resolve(approvalTargets.length === 1);
      },
    ),
  ) as { deniedPermissions?: Array<{ name: string; target?: string }> };

  assertEquals(approvalTargets.length, 2);
  assertEquals(result.deniedPermissions?.[0]?.name, "read");
  assertEquals(result.deniedPermissions?.[0]?.target, "README.md");
});
