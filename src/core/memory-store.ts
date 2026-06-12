import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface MemoryRecord {
  key: string;
  value: string;
  updatedAt: string;
  sourceMessageId?: string;
}

export interface MemoryUpdate {
  key: string;
  value: string;
}

export class MemoryStore {
  #records = new Map<string, Map<string, MemoryRecord>>();
  #loaded = false;
  #saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly enabled: boolean,
  ) {}

  async load(): Promise<void> {
    if (this.#loaded || !this.enabled) {
      this.#loaded = true;
      return;
    }

    try {
      const text = readFileSync(this.path, "utf-8");
      const payload = JSON.parse(text);
      if (isRecord(payload) && isRecord(payload.users)) {
        for (const [userId, records] of Object.entries(payload.users)) {
          if (!isRecord(records)) {
            continue;
          }

          const userMemory = new Map<string, MemoryRecord>();
          for (const [key, record] of Object.entries(records)) {
            if (!isRecord(record) || typeof record.value !== "string") {
              continue;
            }

            userMemory.set(key, {
              key,
              value: record.value,
              updatedAt: typeof record.updatedAt === "string"
                ? record.updatedAt
                : new Date(0).toISOString(),
              sourceMessageId: typeof record.sourceMessageId === "string"
                ? record.sourceMessageId
                : undefined,
            });
          }

          this.#records.set(userId, userMemory);
        }
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    this.#loaded = true;
  }

  getUserMemory(userId: string): MemoryRecord[] {
    const records = this.#records.get(userId);
    if (!records) {
      return [];
    }

    return [...records.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  getAllMemory(): Record<string, MemoryRecord[]> {
    const users: Record<string, MemoryRecord[]> = {};
    for (const [userId, records] of this.#records) {
      users[userId] = [...records.values()].sort((a, b) =>
        a.key.localeCompare(b.key)
      );
    }

    return users;
  }

  async applyUserUpdates(
    userId: string,
    updates: MemoryUpdate[],
    sourceMessageId?: string,
  ): Promise<void> {
    if (!this.enabled || updates.length === 0) {
      return;
    }

    const userMemory = this.#records.get(userId) ??
      new Map<string, MemoryRecord>();
    const updatedAt = new Date().toISOString();

    for (const update of updates) {
      const key = update.key.trim();
      const value = update.value.trim();
      if (!key || !value) {
        continue;
      }

      userMemory.set(key, {
        key,
        value,
        updatedAt,
        sourceMessageId,
      });
    }

    this.#records.set(userId, userMemory);
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.#saveQueue = this.#saveQueue.then(() => { this.#writeToDisk(); }).catch(() => {});
    await this.#saveQueue;
  }

  #writeToDisk(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify(this.toJSON(), null, 2)}\n`,
    );
  }

  toJSON(): unknown {
    const users: Record<string, Record<string, MemoryRecord>> = {};
    for (const [userId, records] of this.#records) {
      users[userId] = Object.fromEntries(records);
    }

    return { users };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}
