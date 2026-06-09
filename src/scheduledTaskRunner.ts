import { Client } from "discord.js";
import { getEffectiveApiKey, removeResolvedApiKey } from "./apiKeys.ts";
import {
  buildScheduledTaskPrompt,
  dueScheduledTasks,
  recordScheduledTaskRun,
  ScheduledTask,
} from "./scheduledTasks.ts";
import { MistralApiError, splitDiscordMessages } from "./mistral/mod.ts";
import { sendModelMessage } from "./modelProviders.ts";
import { getEffectiveModel } from "./models.ts";

const RUNNER_INTERVAL_MS = 60_000;

let runnerStarted = false;
let runnerBusy = false;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendTaskMessage(
  client: Client,
  task: ScheduledTask,
  content: string,
): Promise<void> {
  const [firstMessage, ...remainingMessages] = splitDiscordMessages(content);

  if (task.delivery === "channel" && task.channelId) {
    const channel = await client.channels.fetch(task.channelId);

    if (channel?.isTextBased() && "send" in channel) {
      await channel.send(firstMessage);

      for (const message of remainingMessages) {
        await channel.send(message);
      }

      return;
    }

    throw new Error(
      `Scheduled task channel ${task.channelId} is not sendable.`,
    );
  }

  const user = await client.users.fetch(task.ownerUserId);
  await user.send(firstMessage);

  for (const message of remainingMessages) {
    await user.send(message);
  }
}

async function runOneScheduledTask(
  client: Client,
  task: ScheduledTask,
): Promise<void> {
  const resolvedApiKey = await getEffectiveApiKey(
    task.ownerUserId,
    task.guildId,
  );

  if (!resolvedApiKey) {
    await sendTaskMessage(
      client,
      task,
      `Scheduled task \`${task.id}\` could not run because Missy has no model provider API key for this context.`,
    );
    await recordScheduledTaskRun(task, {
      error: "No model provider API key for scheduled task.",
    });
    return;
  }

  try {
    const model = await getEffectiveModel(task.ownerUserId);
    const reply = await sendModelMessage(resolvedApiKey.apiKey, {
      message: buildScheduledTaskPrompt(task),
      source: task.guildId ? "discord-server" : "discord-dm",
      discord: {
        channelId: task.channelId,
        guildId: task.guildId,
        roleIds: [],
        userId: task.ownerUserId,
        username: task.ownerUsername,
      },
    }, {
      model,
    });

    await sendTaskMessage(client, task, reply);
    await recordScheduledTaskRun(task, {});
  } catch (error) {
    if (error instanceof MistralApiError && error.status === 401) {
      await removeResolvedApiKey(resolvedApiKey);
    }

    await recordScheduledTaskRun(task, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runDueScheduledTasks(client: Client): Promise<void> {
  if (runnerBusy) {
    return;
  }

  runnerBusy = true;

  try {
    const tasks = await dueScheduledTasks();

    for (const task of tasks) {
      try {
        await runOneScheduledTask(client, task);
      } catch (error) {
        console.error(`Scheduled task ${task.id} failed`, error);
      }
    }
  } finally {
    runnerBusy = false;
  }
}

export function startScheduledTaskRunner(client: Client): void {
  if (runnerStarted) {
    return;
  }

  runnerStarted = true;
  setInterval(() => {
    void runDueScheduledTasks(client);
  }, RUNNER_INTERVAL_MS);
  void sleep(5_000).then(() => runDueScheduledTasks(client));
}
