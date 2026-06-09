import { assertEquals } from "@std/assert";
import {
  buildScheduledTaskPrompt,
  callScheduledTaskTool,
  dueScheduledTasks,
  nextDailyRunAt,
  SCHEDULED_TASK_TOOL_NAMES,
} from "./scheduledTasks.ts";

const payload = {
  message: "schedule this",
  source: "discord-dm" as const,
  discord: {
    channelId: "c1",
    userId: "u1",
    username: "tester",
  },
};

Deno.test("computes next daily run in requested timezone", () => {
  assertEquals(
    nextDailyRunAt(
      "07:00",
      "Australia/Sydney",
      new Date("2026-06-08T20:30:00.000Z"),
    ),
    "2026-06-08T21:00:00.000Z",
  );
});

Deno.test("schedules and lists daily tasks", async () => {
  const originalDataDir = Deno.env.get("MISSY_DATA_DIR");
  const dataDir = await Deno.makeTempDir();
  Deno.env.set("MISSY_DATA_DIR", dataDir);

  try {
    const task = JSON.parse(
      await callScheduledTaskTool(SCHEDULED_TASK_TOOL_NAMES.schedule, {
        delivery: "dm",
        prompt: "Check the 390X bus and send the best route.",
        time: "07:00",
        timezone: "Australia/Sydney",
      }, payload),
    ) as { id: string; prompt: string; time: string };

    assertEquals(task.time, "07:00");
    assertEquals(task.prompt, "Check the 390X bus and send the best route.");

    const tasks = JSON.parse(
      await callScheduledTaskTool(SCHEDULED_TASK_TOOL_NAMES.list, {}, payload),
    ) as Array<{ id: string }>;
    assertEquals(tasks.map((item) => item.id), [task.id]);
    assertEquals(
      (await dueScheduledTasks(new Date("2100-01-01T00:00:00.000Z"))).length,
      1,
    );
    assertEquals(
      buildScheduledTaskPrompt({
        ...tasks[0],
        createdAt: "2026-06-08T00:00:00.000Z",
        delivery: "dm",
        enabled: true,
        nextRunAt: "2026-06-08T21:00:00.000Z",
        ownerUserId: "u1",
        ownerUsername: "tester",
        prompt: "Check the 390X bus and send the best route.",
        time: "07:00",
        timezone: "Australia/Sydney",
        updatedAt: "2026-06-08T00:00:00.000Z",
      }).includes("scheduled Missy task is due now"),
      true,
    );
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete("MISSY_DATA_DIR");
    } else {
      Deno.env.set("MISSY_DATA_DIR", originalDataDir);
    }
    await Deno.remove(dataDir, { recursive: true });
  }
});
