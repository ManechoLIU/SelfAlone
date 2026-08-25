export type PptIntentStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
};

export type PptConversationIntent = {
  version: 1;
  conversationId: string;
  taskId: string;
  bookId: string;
  bookTitle: string;
  phase: "awaiting-confirmation" | "requirements-ready";
};

const intentKey = "selfalone.miniapp.development.ppt-intent.v1";
const developmentConversationId = "development-current";

function isIntent(value: unknown): value is PptConversationIntent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PptConversationIntent>;
  return candidate.version === 1
    && candidate.conversationId === developmentConversationId
    && typeof candidate.taskId === "string"
    && candidate.taskId.length > 0
    && typeof candidate.bookId === "string"
    && candidate.bookId.length > 0
    && typeof candidate.bookTitle === "string"
    && candidate.bookTitle.length > 0
    && (candidate.phase === "awaiting-confirmation" || candidate.phase === "requirements-ready");
}

export function createPptIntentStore(
  storage: PptIntentStorage,
  options: { developmentAdapter: boolean },
) {
  const restore = (): PptConversationIntent | null => {
    if (!options.developmentAdapter) return null;
    const saved = storage.get(intentKey);
    return isIntent(saved) ? saved : null;
  };

  return {
    restore,
    selectBook(book: { id: string; title: string }): PptConversationIntent | null {
      if (!options.developmentAdapter || !book.id.trim() || !book.title.trim()) return null;
      const current = restore();
      const next: PptConversationIntent = {
        version: 1,
        conversationId: current?.conversationId ?? developmentConversationId,
        taskId: `development-ppt-${book.id}`,
        bookId: book.id,
        bookTitle: book.title,
        phase: "awaiting-confirmation",
      };
      storage.set(intentKey, next);
      return next;
    },
    confirm(): PptConversationIntent | null {
      const current = restore();
      if (!current) return null;
      const confirmed: PptConversationIntent = { ...current, phase: "requirements-ready" };
      storage.set(intentKey, confirmed);
      return confirmed;
    },
    workspaceUrl(): string | null {
      const current = restore();
      if (!current || current.phase !== "requirements-ready") return null;
      return `/pages/ppt/index?bookId=${encodeURIComponent(current.bookId)}&intentId=${encodeURIComponent(current.taskId)}`;
    },
    clear() {
      if (options.developmentAdapter) storage.remove(intentKey);
    },
  };
}
