import { readDataTextFile, writeDataTextFile } from "./dataDir.ts";
import type { MistralMessagePayload } from "./mistral/mod.ts";
import { MistralToolDefinition } from "./mcp.ts";

export type ScheduledTaskDelivery = "channel" | "dm";

export type ScheduledTask = {
  id: string;
  channelId?: string;
  createdAt: string;
  delivery: ScheduledTaskDelivery;
  enabled: boolean;
  guildId?: string;
  lastError?: string;
  lastRunAt?: string;
  nextRunAt: string;
  ownerUserId: string;
  ownerUsername: string;
  prompt: string;
  time: string;
  timezone: string;
  updatedAt: string;
};

type ScheduledTaskStore = {
  tasks: ScheduledTask[];
};

export const SCHEDULED_TASK_TOOL_NAMES = {
  delete: "missy_delete_scheduled_task",
  list: "missy_list_scheduled_tasks",
  schedule: "missy_schedule_task",
} as const;

const storeFile = "scheduled-tasks.json";
const MAX_TASKS_PER_USER = 25;
const MAX_PROMPT_LENGTH = 2_000;
const DEFAULT_TIMEZONE = "Australia/Sydney";

let cachedStore: ScheduledTaskStore | undefined;

async function loadStore(): Promise<ScheduledTaskStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await readDataTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<ScheduledTaskStore>;
    cachedStore = { tasks: parsed.tasks ?? [] };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { tasks: [] };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: ScheduledTaskStore): Promise<void> {
  await writeDataTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

function parseArgs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments === "string") {
    return JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  }

  return rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
}

function normalizeTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error("time must use 24-hour HH:mm format.");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeTimezone(value: unknown): string {
  const timezone = String(value ?? "").trim() || DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }

  return timezone;
}

function normalizePrompt(value: unknown): string {
  const prompt = String(value ?? "").trim().slice(0, MAX_PROMPT_LENGTH);

  if (!prompt) {
    throw new Error("prompt is required.");
  }

  return prompt;
}

function localParts(date: Date, timezone: string): {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    month: value("month"),
    year: value("year"),
  };
}

function localSerialMinutes(parts: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 60_000) +
    parts.hour * 60 + parts.minute;
}

function localDatePlusDays(parts: {
  day: number;
  month: number;
  year: number;
}, days: number): { day: number; month: number; year: number } {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

export function nextDailyRunAt(
  time: string,
  timezone: string,
  from = new Date(),
): string {
  const [hour, minute] = normalizeTime(time).split(":").map(Number);
  const nowLocal = localParts(from, timezone);
  const targetDate = hour * 60 + minute <= nowLocal.hour * 60 + nowLocal.minute
    ? localDatePlusDays(nowLocal, 1)
    : nowLocal;
  const target = {
    ...targetDate,
    hour,
    minute,
  };
  let guess = new Date(
    Date.UTC(target.year, target.month - 1, target.day, hour, minute),
  );

  for (let index = 0; index < 4; index++) {
    const diffMinutes = localSerialMinutes(target) -
      localSerialMinutes(localParts(guess, timezone));
    guess = new Date(guess.getTime() + diffMinutes * 60_000);
  }

  return guess.toISOString();
}

function taskBelongsToPayload(
  task: ScheduledTask,
  payload: MistralMessagePayload,
): boolean {
  return task.ownerUserId === payload.discord.userId &&
    (task.guildId ?? "") === (payload.discord.guildId ?? "");
}

export async function addScheduledTask(
  payload: MistralMessagePayload,
  input: {
    delivery?: ScheduledTaskDelivery;
    prompt: string;
    time: string;
    timezone: string;
  },
): Promise<ScheduledTask> {
  const time = normalizeTime(input.time);
  const timezone = normalizeTimezone(input.timezone);
  const delivery = input.delivery ?? "dm";
  const prompt = normalizePrompt(input.prompt);

  if (delivery === "channel" && !payload.discord.channelId) {
    throw new Error("Channel delivery requires a Discord channel.");
  }

  const store = await loadStore();
  const now = new Date();
  const task: ScheduledTask = {
    ...(delivery === "channel" ? { channelId: payload.discord.channelId } : {}),
    createdAt: now.toISOString(),
    delivery,
    enabled: true,
    ...(payload.discord.guildId ? { guildId: payload.discord.guildId } : {}),
    id: crypto.randomUUID().slice(0, 8),
    nextRunAt: nextDailyRunAt(time, timezone, now),
    ownerUserId: payload.discord.userId,
    ownerUsername: payload.discord.username,
    prompt,
    time,
    timezone,
    updatedAt: now.toISOString(),
  };
  const userTasks = store.tasks.filter((stored) =>
    stored.ownerUserId === payload.discord.userId
  );
  const remainingUserTasks = userTasks.length >= MAX_TASKS_PER_USER
    ? userTasks.slice(1)
    : userTasks;

  store.tasks = [
    ...store.tasks.filter((stored) =>
      stored.ownerUserId !== payload.discord.userId
    ),
    ...remainingUserTasks,
    task,
  ];
  await saveStore(store);
  return task;
}

export async function listScheduledTasks(
  payload: MistralMessagePayload,
): Promise<ScheduledTask[]> {
  const store = await loadStore();
  return store.tasks.filter((task) => taskBelongsToPayload(task, payload));
}

export async function deleteScheduledTask(
  payload: MistralMessagePayload,
  id: string,
): Promise<boolean> {
  const store = await loadStore();
  const task = store.tasks.find((stored) =>
    stored.id === id.trim() && taskBelongsToPayload(stored, payload)
  );

  if (!task) {
    return false;
  }

  store.tasks = store.tasks.filter((stored) => stored.id !== task.id);
  await saveStore(store);
  return true;
}

export async function dueScheduledTasks(
  now = new Date(),
): Promise<ScheduledTask[]> {
  const store = await loadStore();
  const nowMs = now.getTime();

  return store.tasks.filter((task) =>
    task.enabled && Date.parse(task.nextRunAt) <= nowMs
  );
}

export async function recordScheduledTaskRun(
  task: ScheduledTask,
  result: { error?: string; now?: Date },
): Promise<void> {
  const store = await loadStore();
  const index = store.tasks.findIndex((stored) => stored.id === task.id);

  if (index < 0) {
    return;
  }

  const now = result.now ?? new Date();
  store.tasks[index] = {
    ...store.tasks[index],
    lastError: result.error,
    lastRunAt: now.toISOString(),
    nextRunAt: nextDailyRunAt(task.time, task.timezone, now),
    updatedAt: now.toISOString(),
  };
  await saveStore(store);
}

export function buildScheduledTaskPrompt(task: ScheduledTask): string {
  return [
    "A scheduled Missy task is due now.",
    `Task id: ${task.id}`,
    `Scheduled local time: ${task.time} (${task.timezone})`,
    "",
    "Run this task now and produce only the message that should be sent to the user:",
    task.prompt,
  ].join("\n");
}

export const scheduledTaskTools: MistralToolDefinition[] = [
  {
    type: "function",
    function: {
      name: SCHEDULED_TASK_TOOL_NAMES.schedule,
      description:
        "Create a daily scheduled task that will run a prompt later and send the result to the user by DM or to the current channel.",
      parameters: {
        type: "object",
        properties: {
          delivery: {
            type: "string",
            enum: ["dm", "channel"],
            description: "Where to send the result. Defaults to dm.",
          },
          prompt: {
            type: "string",
            description:
              "The full task Missy should run at the scheduled time, including lookup criteria, desired output, and constraints.",
          },
          time: {
            type: "string",
            description: "Daily local time in 24-hour HH:mm format.",
          },
          timezone: {
            type: "string",
            description:
              "IANA timezone such as Australia/Sydney. Defaults to Australia/Sydney.",
          },
        },
        required: ["prompt", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SCHEDULED_TASK_TOOL_NAMES.list,
      description: "List this user's scheduled Missy tasks for this context.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: SCHEDULED_TASK_TOOL_NAMES.delete,
      description: "Delete one of this user's scheduled Missy tasks.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Scheduled task id." },
        },
        required: ["id"],
      },
    },
  },
];

export function hasSchedulingIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return /\b(schedule|scheduled|automation|automate|remind|message me|dm me|send me|notify me|every day|daily|tomorrow|at \d{1,2}(?::\d{2})?\s*(am|pm)?)\b/
    .test(normalized);
}

export function isScheduledTaskTool(toolName: string): boolean {
  return Object.values(SCHEDULED_TASK_TOOL_NAMES).includes(
    toolName as typeof SCHEDULED_TASK_TOOL_NAMES[
      keyof typeof SCHEDULED_TASK_TOOL_NAMES
    ],
  );
}

export async function callScheduledTaskTool(
  toolName: string,
  rawArguments: unknown,
  payload: MistralMessagePayload,
): Promise<string> {
  const args = parseArgs(rawArguments);

  if (toolName === SCHEDULED_TASK_TOOL_NAMES.schedule) {
    const delivery = args.delivery === "channel" ? "channel" : "dm";
    return JSON.stringify(
      await addScheduledTask(payload, {
        delivery,
        prompt: String(args.prompt ?? ""),
        time: String(args.time ?? ""),
        timezone: String(args.timezone ?? DEFAULT_TIMEZONE),
      }),
    );
  }

  if (toolName === SCHEDULED_TASK_TOOL_NAMES.list) {
    return JSON.stringify(await listScheduledTasks(payload));
  }

  if (toolName === SCHEDULED_TASK_TOOL_NAMES.delete) {
    return JSON.stringify({
      deleted: await deleteScheduledTask(payload, String(args.id ?? "")),
    });
  }

  throw new Error(`Unknown scheduled task tool: ${toolName}`);
}
