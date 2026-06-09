import { assertEquals } from "@std/assert";
import path from "node:path";
import {
  appDataDir,
  dataFilePath,
  readDataTextFile,
  writeDataTextFile,
} from "./dataDir.ts";

Deno.test("uses MISSY_DATA_DIR when configured", async () => {
  const previous = Deno.env.get("MISSY_DATA_DIR");
  const dir = path.resolve("tmp-test-data-dir");

  try {
    Deno.env.set("MISSY_DATA_DIR", dir);
    assertEquals(appDataDir(), dir);
    assertEquals(
      dataFilePath("memories.json"),
      path.join(dir, "memories.json"),
    );

    await writeDataTextFile("probe.json", '{"ok":true}\n');
    assertEquals(await readDataTextFile("probe.json"), '{"ok":true}\n');
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});

    if (previous === undefined) {
      Deno.env.delete("MISSY_DATA_DIR");
    } else {
      Deno.env.set("MISSY_DATA_DIR", previous);
    }
  }
});
