export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationClearPoint = {
  createdAt: Date;
  messageId?: string;
};

type StoredConversation = {
  clearedAt?: string;
  clearMessageId?: string;
  messages: ConversationMessage[];
  updatedAt: string;
};

type ContextStore = {
  conversations: Record<string, StoredConversation>;
};

const dataDir = new URL("../data/", import.meta.url);
const storeFile = new URL("contexts.json", dataDir);
const MAX_CONTEXT_MESSAGES = 20;

let cachedStore: ContextStore | undefined;

async function loadStore(): Promise<ContextStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    const raw = await Deno.readTextFile(storeFile);
    const parsed = JSON.parse(raw) as Partial<ContextStore>;
    cachedStore = { conversations: parsed.conversations ?? {} };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      cachedStore = { conversations: {} };
    } else {
      throw error;
    }
  }

  return cachedStore;
}

async function saveStore(store: ContextStore): Promise<void> {
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(storeFile, `${JSON.stringify(store, null, 2)}\n`);
}

function trimContext(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

export async function getConversationContext(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const store = await loadStore();
  return store.conversations[conversationId]?.messages ?? [];
}

export async function getConversationClearPoint(
  conversationId: string,
): Promise<ConversationClearPoint | undefined> {
  const store = await loadStore();
  const conversation = store.conversations[conversationId];

  if (!conversation?.clearedAt) {
    return undefined;
  }

  return {
    createdAt: new Date(conversation.clearedAt),
    messageId: conversation.clearMessageId,
  };
}

export async function appendConversationTurn(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const store = await loadStore();
  const existingConversation = store.conversations[conversationId];
  const existing = existingConversation?.messages ?? [];

  store.conversations[conversationId] = {
    clearedAt: existingConversation?.clearedAt,
    clearMessageId: existingConversation?.clearMessageId,
    messages: trimContext([
      ...existing,
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage },
    ]),
    updatedAt: new Date().toISOString(),
  };

  await saveStore(store);
}

export async function clearConversationContext(
  conversationId: string,
  clearPoint?: ConversationClearPoint,
): Promise<boolean> {
  const store = await loadStore();
  const existingConversation = store.conversations[conversationId];
  const hadContext = Boolean(existingConversation?.messages.length);
  const now = new Date();

  store.conversations[conversationId] = {
    clearedAt: (clearPoint?.createdAt ?? now).toISOString(),
    clearMessageId: clearPoint?.messageId,
    messages: [],
    updatedAt: now.toISOString(),
  };
  await saveStore(store);
  return hadContext;
}
