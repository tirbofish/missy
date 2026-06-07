export type ApiKeySource = "dm" | "slash";

type StoredApiKey = {
  apiKey: string;
  source: ApiKeySource;
  updatedAt: string;
};

type ApiKeyStore = {
  users: Record<string, StoredApiKey>;
};

const dataDir = new URL("../data/", import.meta.url);
const storeFile = new URL("api-keys.json", dataDir);

let cachedStore: ApiKeyStore | undefined;

async function loadStore(): Promise<ApiKeyStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await Deno.readTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<ApiKeyStore>;
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

async function saveStore(store: ApiKeyStore): Promise<void> {
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

export async function getApiKey(userId: string): Promise<string | undefined> {
  const store = await loadStore();
  return store.users[userId]?.apiKey;
}

export async function hasApiKey(userId: string): Promise<boolean> {
  return Boolean(await getApiKey(userId));
}

export async function setApiKey(
  userId: string,
  apiKey: string,
  source: ApiKeySource,
): Promise<void> {
  const store = await loadStore();
  store.users[userId] = {
    apiKey,
    source,
    updatedAt: new Date().toISOString(),
  };
  await saveStore(store);
}

export async function removeApiKey(userId: string): Promise<boolean> {
  const store = await loadStore();
  if (!store.users[userId]) {
    return false;
  }

  delete store.users[userId];
  await saveStore(store);
  return true;
}

export function parseApiKeyCandidate(content: string): string | undefined {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length < 8 || /\s/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
