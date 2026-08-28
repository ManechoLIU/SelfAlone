import type { ConversationChatSession } from "./conversation-chat-state";

export type TextReaderChatHandoff = {
  quote: string;
  bookId: string;
  bookTitle: string;
  author: string | null;
};

export type TextReaderChatHandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const TEXT_READER_CHAT_HANDOFF_STORAGE_KEY = "selfalone:m1:text-reader-chat-handoff";

export function textReaderChatHandoffStorageKey(accountId: string) {
  return `${TEXT_READER_CHAT_HANDOFF_STORAGE_KEY}:${encodeURIComponent(accountId.trim())}`;
}

export type TextReaderChatHandoffDraft = {
  handoff: TextReaderChatHandoff;
  conversationId: string;
  draft: string;
};

type PersistedHandoff =
  | {
    accountId: string;
    status: "pending" | "consumed";
    handoff: TextReaderChatHandoff;
  }
  | {
    accountId: string;
    status: "claimed";
    handoff: TextReaderChatHandoff;
    conversationId: string;
    draft: string;
  };

function defaultStorage(): TextReaderChatHandoffStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isHandoff(value: unknown): value is TextReaderChatHandoff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TextReaderChatHandoff>;
  return typeof candidate.quote === "string"
    && candidate.quote.trim().length > 0
    && typeof candidate.bookId === "string"
    && candidate.bookId.trim().length > 0
    && typeof candidate.bookTitle === "string"
    && candidate.bookTitle.trim().length > 0
    && (candidate.author === null || typeof candidate.author === "string");
}

function isPersistedHandoff(value: unknown, accountId: string): value is PersistedHandoff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedHandoff>;
  if (candidate.accountId !== accountId || !isHandoff(candidate.handoff)) return false;
  if (candidate.status === "pending" || candidate.status === "consumed") return true;
  return candidate.status === "claimed"
    && typeof candidate.conversationId === "string"
    && candidate.conversationId.trim().length > 0
    && typeof candidate.draft === "string";
}

export function formatTextReaderChatDraft(handoff: TextReaderChatHandoff) {
  const author = handoff.author?.trim();
  const book = author ? `《${handoff.bookTitle}》（${author}）` : `《${handoff.bookTitle}》`;
  return `来自${book}的原文（书籍 ID：${handoff.bookId}）：\n“${handoff.quote}”\n\n`;
}

export function chooseConversationForTextReaderHandoff(
  sessions: readonly ConversationChatSession[],
  currentConversationId: string | null,
  preferredConversationId: string | null = null,
) {
  if (preferredConversationId) {
    const preferred = sessions.find((session) => session.id === preferredConversationId);
    if (preferred) return preferred;
  }
  if (currentConversationId) {
    const current = sessions.find((session) => session.id === currentConversationId);
    if (current) return current;
  }
  return sessions[0] ?? null;
}

export function createTextReaderChatHandoffStore(
  accountId: string,
  storage: TextReaderChatHandoffStorage | null = defaultStorage(),
) {
  const normalizedAccountId = accountId.trim();
  const storageKey = textReaderChatHandoffStorageKey(normalizedAccountId);
  let memory: PersistedHandoff | null = null;

  const read = () => {
    if (!normalizedAccountId) return null;
    if (!storage) return memory;
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return isPersistedHandoff(parsed, normalizedAccountId) ? parsed : null;
    } catch {
      return memory;
    }
  };

  const write = (record: PersistedHandoff | null) => {
    memory = record;
    if (!storage || !normalizedAccountId) return;
    try {
      if (record) storage.setItem(storageKey, JSON.stringify(record));
      else storage.removeItem(storageKey);
    } catch {
      // Session storage is optional; memory still carries the current route handoff.
    }
  };

  return {
    publish(handoff: TextReaderChatHandoff) {
      if (!normalizedAccountId || !isHandoff(handoff)) return false;
      write({
        accountId: normalizedAccountId,
        status: "pending",
        handoff: { ...handoff, author: handoff.author?.trim() || null },
      });
      return true;
    },

    peek() {
      const record = read();
      return record?.status === "pending" ? record.handoff : null;
    },

    claim(conversationId: string, draft: string): TextReaderChatHandoffDraft | null {
      const normalizedConversationId = conversationId.trim();
      if (!normalizedConversationId || typeof draft !== "string") return null;
      const record = read();
      if (!record || record.status !== "pending") return null;
      const claimed = {
        accountId: normalizedAccountId,
        status: "claimed" as const,
        handoff: record.handoff,
        conversationId: normalizedConversationId,
        draft,
      };
      write(claimed);
      return { handoff: record.handoff, conversationId: normalizedConversationId, draft };
    },

    active(): TextReaderChatHandoffDraft | null {
      const record = read();
      return record?.status === "claimed"
        ? { handoff: record.handoff, conversationId: record.conversationId, draft: record.draft }
        : null;
    },

    draftFor(conversationId: string) {
      const record = read();
      return record?.status === "claimed" && record.conversationId === conversationId
        ? record.draft
        : null;
    },

    updateDraft(conversationId: string, draft: string) {
      const record = read();
      if (!record || record.status !== "claimed" || record.conversationId !== conversationId) return false;
      write({ ...record, draft });
      return true;
    },

    complete(conversationId: string) {
      const record = read();
      if (!record || record.status !== "claimed" || record.conversationId !== conversationId) return false;
      write(null);
      return true;
    },

    consume() {
      const record = read();
      if (!record || record.status !== "pending") return null;
      write({ ...record, status: "consumed" });
      return record.handoff;
    },

    clear() {
      write(null);
    },
  };
}

type TextReaderChatHandoffStore = ReturnType<typeof createTextReaderChatHandoffStore>;
const accountStores = new Map<string, TextReaderChatHandoffStore>();

export function getTextReaderChatHandoffStore(accountId: string | null | undefined) {
  const normalizedAccountId = accountId?.trim() ?? "";
  if (!normalizedAccountId) return null;
  const existing = accountStores.get(normalizedAccountId);
  if (existing) return existing;
  const store = createTextReaderChatHandoffStore(normalizedAccountId);
  accountStores.set(normalizedAccountId, store);
  return store;
}
