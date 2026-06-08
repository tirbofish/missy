import { assertEquals } from "@std/assert";
import {
  buildSkillDetailMessage,
  buildSkillsOverviewMessage,
  findSkill,
  listSkills,
  skillSelectOptions,
} from "./skills.ts";

Deno.test("lists local computer skill only when local access is enabled", () => {
  assertEquals(
    listSkills(false).some((skill) => skill.id === "local-computer"),
    false,
  );
  assertEquals(
    listSkills(true).some((skill) => skill.id === "local-computer"),
    true,
  );
});

Deno.test("finds skill details by id", () => {
  assertEquals(findSkill("memories", false)?.name, "memories");
  assertEquals(findSkill("local-computer", false), undefined);
});

Deno.test("builds skills overview and detail messages", () => {
  assertEquals(
    buildSkillsOverviewMessage(false).includes("Missy skills"),
    true,
  );
  assertEquals(
    buildSkillDetailMessage("automations", false).includes("`/automation`"),
    true,
  );
});

Deno.test("builds select menu options", () => {
  assertEquals(
    skillSelectOptions(false).some((option) => option.value === "memories"),
    true,
  );
});
