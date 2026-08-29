export type PptIntentStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
};

export type PptConversationBookContext = {
  id: string;
  title: string;
  author?: string;
  source?: "local" | "weread";
  sourceLabel?: string;
  coverUrl?: string;
  coverVariant?: number;
};

export type PptConversationIntent = {
  version: 2;
  conversationId: string;
  bookId: string;
  bookTitle: string;
  author?: string;
  source?: "local" | "weread";
  sourceLabel?: string;
  coverUrl?: string;
  coverVariant?: number;
  draft: string;
  phase: "draft" | "awaiting-confirmation" | "requirements-ready";
};

export type PptConversationHandoff = PptConversationIntent;

export const PPT_DRAFT_TEXT = "帮我制作这本书PPT";

const intentKey = "selfalone.miniapp.development.ppt-intent.v2";
const developmentConversationId = "development-current";

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isIntent(value: unknown): value is PptConversationIntent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PptConversationIntent>;
  return candidate.version === 2
    && candidate.conversationId === developmentConversationId
    && typeof candidate.bookId === "string"
    && candidate.bookId.length > 0
    && typeof candidate.bookTitle === "string"
    && candidate.bookTitle.length > 0
    && isOptionalString(candidate.author)
    && (candidate.source === undefined || candidate.source === "local" || candidate.source === "weread")
    && isOptionalString(candidate.sourceLabel)
    && isOptionalString(candidate.coverUrl)
    && (candidate.coverVariant === undefined
      || (typeof candidate.coverVariant === "number" && Number.isFinite(candidate.coverVariant)))
    && typeof candidate.draft === "string"
    && (candidate.phase === "draft"
      || candidate.phase === "awaiting-confirmation"
      || candidate.phase === "requirements-ready")
    && !("taskId" in candidate);
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

  const write = (next: PptConversationIntent | null) => {
    if (next) storage.set(intentKey, next);
    return next;
  };

  return {
    restore,
    selectBook(book: PptConversationBookContext): PptConversationIntent | null {
      if (!options.developmentAdapter || !book.id.trim() || !book.title.trim()) return null;
      const current = restore();
      const next: PptConversationIntent = {
        version: 2,
        conversationId: current?.conversationId ?? developmentConversationId,
        bookId: book.id,
        bookTitle: book.title,
        ...(book.author ? { author: book.author } : {}),
        ...(book.source ? { source: book.source } : {}),
        ...(book.sourceLabel ? { sourceLabel: book.sourceLabel } : {}),
        ...(book.coverUrl ? { coverUrl: book.coverUrl } : {}),
        ...(book.coverVariant !== undefined ? { coverVariant: book.coverVariant } : {}),
        draft: PPT_DRAFT_TEXT,
        phase: "draft",
      };
      return write(next);
    },
    updateDraft(draft: string): PptConversationIntent | null {
      const current = restore();
      if (!current) return null;
      return write({ ...current, draft: typeof draft === "string" ? draft : "" });
    },
    activate(): PptConversationIntent | null {
      const current = restore();
      if (!current) return null;
      if (current.phase !== "draft") return current;
      return write({ ...current, phase: "awaiting-confirmation" });
    },
    confirm(): PptConversationIntent | null {
      const current = restore();
      if (!current || current.phase === "draft") return null;
      if (current.phase === "requirements-ready") return current;
      return write({ ...current, phase: "requirements-ready" });
    },
    workspaceUrl(): string | null {
      const current = restore();
      if (!current || current.phase !== "requirements-ready") return null;
      return `/pages/ppt/index?bookId=${encodeURIComponent(current.bookId)}`;
    },
    clear() {
      if (options.developmentAdapter) storage.remove(intentKey);
    },
  };
}
