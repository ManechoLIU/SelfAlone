import type { ConversationChatSession } from "./conversation-chat-state";

export type TextReaderChatHandoff = {
  quote: string;
  bookId: string;
  bookTitle: string;
  author: string | null;
};

export type TextReaderChatHandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const TEXT_READER_CHAT_HANDOFF_STORAGE_KEY = "selfalone:m1:text-reader-chat-handoff";

export type TextReaderChatHandoffDraft = {
  conversationId: string;
  draft: string;
};

type PersistedHandoff =
  | {
    status: "pending" | "consumed";
    handoff: TextReaderChatHandoff;
  }
  | {
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

function isPersistedHandoff(value: unknown): value is PersistedHandoff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedHandoff>;
  if (!isHandoff(candidate.handoff)) return false;
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
  storage: TextReaderChatHandoffStorage | null = defaultStorage(),
) {
  let memory: PersistedHandoff | null = null;

  const read = () => {
    if (!storage) return memory;
    try {
      const raw = storage.getItem(TEXT_READER_CHAT_HANDOFF_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return isPersistedHandoff(parsed) ? parsed : null;
    } catch {
      return memory;
    }
  };

  const write = (record: PersistedHandoff | null) => {
    memory = record;
    if (!storage) return;
    try {
      if (record) storage.setItem(TEXT_READER_CHAT_HANDOFF_STORAGE_KEY, JSON.stringify(record));
      else storage.removeItem(TEXT_READER_CHAT_HANDOFF_STORAGE_KEY);
    } catch {
      // Session storage is optional; memory still carries the current route handoff.
    }
  };

  return {
    publish(handoff: TextReaderChatHandoff) {
      if (!isHandoff(handoff)) return false;
      write({ status: "pending", handoff: { ...handoff, author: handoff.author?.trim() || null } });
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
        status: "claimed" as const,
        handoff: record.handoff,
        conversationId: normalizedConversationId,
        draft,
      };
      write(claimed);
      return { conversationId: normalizedConversationId, draft };
    },

    active(): TextReaderChatHandoffDraft | null {
      const record = read();
      return record?.status === "claimed"
        ? { conversationId: record.conversationId, draft: record.draft }
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

export const textReaderChatHandoffStore = createTextReaderChatHandoffStore();
