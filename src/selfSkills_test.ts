import { assertEquals } from "@std/assert";
import {
  buildSelfSkillContext,
  callSelfSkillTool,
  listSelfSkills,
  SELF_SKILL_TOOL_NAMES,
} from "./selfSkills.ts";

Deno.test("saves, lists, reads, and deletes self skills in context", async () => {
  const originalDataDir = Deno.env.get("MISSY_DATA_DIR");
  const dataDir = await Deno.makeTempDir();
  Deno.env.set("MISSY_DATA_DIR", dataDir);

  try {
    const context = { guildId: "g1", userId: "u1" };
    const saved = JSON.parse(
      await callSelfSkillTool(SELF_SKILL_TOOL_NAMES.save, {
        content: "Use endpoint X, then verify Y.",
        description: "Transit lookup workflow",
        name: "390X transit",
        scope: "server",
      }, context),
    ) as { id: string; scope: string };

    assertEquals(saved.scope, "server");
    assertEquals((await listSelfSkills(context)).length, 1);
    assertEquals(
      (await listSelfSkills({ guildId: "g2", userId: "u1" })).length,
      0,
    );

    const read = JSON.parse(
      await callSelfSkillTool(
        SELF_SKILL_TOOL_NAMES.read,
        { id: saved.id },
        context,
      ),
    ) as { content: string };
    assertEquals(read.content, "Use endpoint X, then verify Y.");
    assertEquals(
      (await buildSelfSkillContext(context))?.includes("390X transit"),
      true,
    );

    const deleted = JSON.parse(
      await callSelfSkillTool(
        SELF_SKILL_TOOL_NAMES.delete,
        { id: saved.id },
        context,
      ),
    ) as { deleted: boolean };
    assertEquals(deleted.deleted, true);
    assertEquals((await listSelfSkills(context)).length, 0);
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete("MISSY_DATA_DIR");
    } else {
      Deno.env.set("MISSY_DATA_DIR", originalDataDir);
    }
    await Deno.remove(dataDir, { recursive: true });
  }
});
