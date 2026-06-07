export type ApiKeySource = "dm" | "slash" | "guild-slash";

export type ResolvedApiKey = {
  apiKey: string;
  id: string;
  scope: "guild" | "user";
};

type StoredApiKey = {
  apiKey: string;
  source: ApiKeySource;
  updatedAt: string;
};

type ApiKeyStore = {
  guilds: Record<string, StoredApiKey>;
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
    cachedStore = { guilds: parsed.guilds ?? {}, users: parsed.users ?? {} };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { guilds: {}, users: {} };
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

export async function getGuildApiKey(
  guildId: string,
): Promise<string | undefined> {
  const store = await loadStore();
  return store.guilds[guildId]?.apiKey;
}

export async function getEffectiveApiKey(
  userId: string,
  guildId?: string | null,
): Promise<ResolvedApiKey | undefined> {
  const store = await loadStore();
  const guildKey = guildId ? store.guilds[guildId]?.apiKey : undefined;

  if (guildKey && guildId) {
    return { apiKey: guildKey, id: guildId, scope: "guild" };
  }

  const userKey = store.users[userId]?.apiKey;
  return userKey ? { apiKey: userKey, id: userId, scope: "user" } : undefined;
}

export async function hasApiKey(userId: string): Promise<boolean> {
  return Boolean(await getApiKey(userId));
}

export async function hasGuildApiKey(guildId: string): Promise<boolean> {
  return Boolean(await getGuildApiKey(guildId));
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

export async function setGuildApiKey(
  guildId: string,
  apiKey: string,
): Promise<void> {
  const store = await loadStore();
  store.guilds[guildId] = {
    apiKey,
    source: "guild-slash",
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

export async function removeGuildApiKey(guildId: string): Promise<boolean> {
  const store = await loadStore();
  if (!store.guilds[guildId]) {
    return false;
  }

  delete store.guilds[guildId];
  await saveStore(store);
  return true;
}

export async function removeResolvedApiKey(
  resolved: ResolvedApiKey,
): Promise<boolean> {
  return resolved.scope === "guild"
    ? await removeGuildApiKey(resolved.id)
    : await removeApiKey(resolved.id);
}

export function parseApiKeyCandidate(content: string): string | undefined {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length < 8 || /\s/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
