import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PluginKeystore } from "./types.ts";

type JsonObject = Record<string, unknown>;

export class FileKeystore implements PluginKeystore {
  #data: JsonObject = {};
  #loaded = false;
  #saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly enabled = true,
    private readonly prefix: string[] = [],
    private readonly root?: FileKeystore,
  ) {}

  async load(): Promise<void> {
    const root = this.#root();
    if (root !== this) {
      await root.load();
      return;
    }

    if (this.#loaded || !this.enabled) {
      this.#loaded = true;
      return;
    }

    try {
      const text = readFileSync(this.path, "utf-8");
      const payload = JSON.parse(text);
      if (isRecord(payload)) {
        this.#data = payload;
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    this.#loaded = true;
  }

  get<T = unknown>(key: string): T | undefined {
    const container = this.#container(false);
    return container ? container[key] as T | undefined : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const container = this.#container(true);
    container[key] = value;
    await this.#root().save();
  }

  async delete(key: string): Promise<boolean> {
    const container = this.#container(false);
    if (!container || !(key in container)) {
      return false;
    }

    delete container[key];
    await this.#root().save();
    return true;
  }

  entries(): Record<string, unknown> {
    return { ...(this.#container(false) ?? {}) };
  }

  namespace(name: string): PluginKeystore {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error("Keystore namespace name cannot be empty.");
    }

    const root = this.#root();
    return new FileKeystore(
      root.path,
      root.enabled,
      [...this.prefix, cleanName],
      root,
    );
  }

  async save(): Promise<void> {
    const root = this.#root();
    if (root !== this) {
      await root.save();
      return;
    }

    if (!this.enabled) {
      return;
    }

    this.#saveQueue = this.#saveQueue
      .then(() => { this.#writeToDisk(); })
      .catch(() => {});
    await this.#saveQueue;
  }

  toJSON(): unknown {
    return this.#container(false) ?? {};
  }

  #root(): FileKeystore {
    return this.root ?? this;
  }

  #container(create: true): JsonObject;
  #container(create: false): JsonObject | undefined;
  #container(create: boolean): JsonObject | undefined {
    const root = this.#root();
    let current = root.#data;
    for (const part of this.prefix) {
      const existing = current[part];
      if (!isRecord(existing)) {
        if (!create) {
          return undefined;
        }
        current[part] = {};
      }
      current = current[part] as JsonObject;
    }
    return current;
  }

  #writeToDisk(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify(this.#data, null, 2)}\n`,
    );
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}
