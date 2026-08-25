export type TextReaderPptIntent = {
  bookId: string;
  bookTitle: string;
};

export type TextReaderPptIntentBlockReason =
  | "BOOK_ID_MISSING"
  | "BOOK_ID_EMPTY"
  | "BOOK_ID_AMBIGUOUS"
  | "BOOK_TITLE_MISSING"
  | "BOOK_TITLE_EMPTY"
  | "BOOK_TITLE_AMBIGUOUS";

export type TextReaderPptWorkspaceBlockReason =
  | TextReaderPptIntentBlockReason
  | "WORKSPACE_MISSING"
  | "WORKSPACE_BOOK_MISSING"
  | "WORKSPACE_BOOK_ID_MISSING"
  | "WORKSPACE_BOOK_TITLE_MISSING"
  | "BOOK_ID_MISMATCH"
  | "BOOK_TITLE_MISMATCH";

export type TextReaderPptBlockedDisplay = {
  kind: "intent-invalid" | "workspace-unavailable" | "book-mismatch";
  requestedBook: TextReaderPptIntent | null;
  heading: "当前书籍暂时不能打开 PPT 工作区";
  message:
    | "工作区与当前书籍不一致，已停止展示旧工作区。"
    | "工作区暂时不可用，未展示其他书籍内容。"
    | "当前书籍制作意图不完整，未打开 PPT 工作区。";
};

export type TextReaderPptIntentResult =
  | { status: "none" }
  | { status: "ready"; intent: TextReaderPptIntent }
  | { status: "blocked"; reason: TextReaderPptIntentBlockReason };

export type TextReaderPptHandoffResult<T> =
  | { status: "none" }
  | { status: "ready"; intent: TextReaderPptIntent; workspace: T }
  | {
      status: "blocked";
      reason: TextReaderPptWorkspaceBlockReason;
      intent?: TextReaderPptIntent;
      display: TextReaderPptBlockedDisplay;
    };

export type TextReaderPptConversationScrollPolicy =
  | { action: "reset"; targetScrollTop: 0; reason: "new-book-intent" | "changed-book-intent" }
  | { action: "preserve"; targetScrollTop: number; reason: "same-book-intent" | "no-book-intent" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function routeAndQuery(hash: string) {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const separator = normalized.indexOf("?");
  return separator < 0
    ? { route: normalized, query: "" }
    : { route: normalized.slice(0, separator), query: normalized.slice(separator + 1) };
}

function singleQueryValue(values: string[], missing: TextReaderPptIntentBlockReason, empty: TextReaderPptIntentBlockReason, ambiguous: TextReaderPptIntentBlockReason) {
  if (values.length === 0) return { status: "blocked" as const, reason: missing };
  if (values.length > 1) return { status: "blocked" as const, reason: ambiguous };
  const value = values[0]?.trim() ?? "";
  return value ? { status: "value" as const, value } : { status: "blocked" as const, reason: empty };
}

function blockedDisplay(
  kind: TextReaderPptBlockedDisplay["kind"],
  requestedBook: TextReaderPptIntent | null,
): TextReaderPptBlockedDisplay {
  return kind === "book-mismatch"
    ? {
        kind,
        requestedBook,
        heading: "当前书籍暂时不能打开 PPT 工作区",
        message: "工作区与当前书籍不一致，已停止展示旧工作区。",
      }
    : kind === "workspace-unavailable"
      ? {
          kind,
          requestedBook,
          heading: "当前书籍暂时不能打开 PPT 工作区",
          message: "工作区暂时不可用，未展示其他书籍内容。",
        }
      : {
          kind,
          requestedBook,
          heading: "当前书籍暂时不能打开 PPT 工作区",
          message: "当前书籍制作意图不完整，未打开 PPT 工作区。",
        };
}

function blockedHandoff<T>(
  reason: TextReaderPptWorkspaceBlockReason,
  intent: TextReaderPptIntent | undefined,
  kind: TextReaderPptBlockedDisplay["kind"],
): TextReaderPptHandoffResult<T> {
  return {
    status: "blocked",
    reason,
    ...(intent ? { intent } : {}),
    display: blockedDisplay(kind, intent ?? null),
  };
}

export function parseTextReaderPptIntent(hash: string): TextReaderPptIntentResult {
  const { route, query } = routeAndQuery(hash);
  if (route !== "/conversation") return { status: "none" };

  const parameters = new URLSearchParams(query);
  const bookValues = parameters.getAll("book");
  const titleValues = parameters.getAll("bookTitle");
  if (bookValues.length === 0 && titleValues.length === 0) return { status: "none" };

  const book = singleQueryValue(bookValues, "BOOK_ID_MISSING", "BOOK_ID_EMPTY", "BOOK_ID_AMBIGUOUS");
  if (book.status === "blocked") return book;
  const title = singleQueryValue(titleValues, "BOOK_TITLE_MISSING", "BOOK_TITLE_EMPTY", "BOOK_TITLE_AMBIGUOUS");
  if (title.status === "blocked") return title;
  return {
    status: "ready",
    intent: { bookId: book.value, bookTitle: title.value },
  };
}

export function resolveTextReaderPptHandoff<T>(hash: string, workspace: T | null | undefined): TextReaderPptHandoffResult<T> {
  const parsed = parseTextReaderPptIntent(hash);
  if (parsed.status === "none") return parsed;
  if (parsed.status === "blocked") return blockedHandoff(parsed.reason, undefined, "intent-invalid");
  const { intent } = parsed;

  if (workspace === null || workspace === undefined) {
    return blockedHandoff("WORKSPACE_MISSING", intent, "workspace-unavailable");
  }
  if (!isRecord(workspace) || !isRecord(workspace.book)) {
    return blockedHandoff("WORKSPACE_BOOK_MISSING", intent, "workspace-unavailable");
  }

  const workspaceBookId = workspace.book.id;
  if (typeof workspaceBookId !== "string" || !workspaceBookId.trim()) {
    return blockedHandoff("WORKSPACE_BOOK_ID_MISSING", intent, "workspace-unavailable");
  }
  const workspaceBookTitle = workspace.book.title;
  if (typeof workspaceBookTitle !== "string" || !workspaceBookTitle.trim()) {
    return blockedHandoff("WORKSPACE_BOOK_TITLE_MISSING", intent, "workspace-unavailable");
  }
  if (workspaceBookId !== intent.bookId) {
    return blockedHandoff("BOOK_ID_MISMATCH", intent, "book-mismatch");
  }
  if (workspaceBookTitle !== intent.bookTitle) {
    return blockedHandoff("BOOK_TITLE_MISMATCH", intent, "book-mismatch");
  }
  return { status: "ready", intent, workspace };
}

export function textReaderPptConversationScrollPolicy(
  previousIntent: TextReaderPptIntent | null | undefined,
  nextIntent: TextReaderPptIntent | null | undefined,
  currentScrollTop: number,
): TextReaderPptConversationScrollPolicy {
  if (!nextIntent) {
    return { action: "preserve", targetScrollTop: currentScrollTop, reason: "no-book-intent" };
  }
  if (!previousIntent) {
    return { action: "reset", targetScrollTop: 0, reason: "new-book-intent" };
  }
  if (previousIntent.bookId !== nextIntent.bookId || previousIntent.bookTitle !== nextIntent.bookTitle) {
    return { action: "reset", targetScrollTop: 0, reason: "changed-book-intent" };
  }
  return { action: "preserve", targetScrollTop: currentScrollTop, reason: "same-book-intent" };
}
