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
      const text = await Deno.readTextFile(this.path);
      const payload = JSON.parse(text);
      if (isRecord(payload)) {
        this.#data = payload;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
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
      .then(() => this.#writeToDisk())
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

  async #writeToDisk(): Promise<void> {
    await Deno.mkdir(dirname(this.path), { recursive: true });
    await Deno.writeTextFile(
      this.path,
      `${JSON.stringify(this.#data, null, 2)}\n`,
    );
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
