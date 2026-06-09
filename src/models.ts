import { readDataTextFile, writeDataTextFile } from "./dataDir.ts";

type StoredModel = {
  model: string;
  updatedAt: string;
};

type ModelStore = {
  users: Record<string, StoredModel>;
};

const storeFile = "models.json";
const DEFAULT_MODEL = "mistral-small-latest";
export const MISTRAL_ROUTER_MODEL = "router";
const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

let cachedStore: ModelStore | undefined;

async function loadStore(): Promise<ModelStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await readDataTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<ModelStore>;
    cachedStore = { users: parsed.users ?? {} };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { users: {} };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: ModelStore): Promise<void> {
  await writeDataTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

export function defaultMistralModel(): string {
  return Deno.env.get("MISSY_MODEL") ?? Deno.env.get("MISTRAL_MODEL") ??
    DEFAULT_MODEL;
}

export function isRouterModel(model: string): boolean {
  return model.trim().toLowerCase() === MISTRAL_ROUTER_MODEL;
}

export function parseModelCandidate(content: string): string | undefined {
  const model = content.trim();

  if (!MODEL_NAME_PATTERN.test(model)) {
    return undefined;
  }

  return model;
}

export async function getUserModel(
  userId: string,
): Promise<string | undefined> {
  const store = await loadStore();
  return store.users[userId]?.model;
}

export async function getEffectiveModel(userId: string): Promise<string> {
  return await getUserModel(userId) ?? defaultMistralModel();
}

export async function setUserModel(
  userId: string,
  model: string,
): Promise<void> {
  const store = await loadStore();
  store.users[userId] = {
    model,
    updatedAt: new Date().toISOString(),
  };
  await saveStore(store);
}

export async function clearUserModel(userId: string): Promise<boolean> {
  const store = await loadStore();

  if (!store.users[userId]) {
    return false;
  }

  delete store.users[userId];
  await saveStore(store);
  return true;
}
