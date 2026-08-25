import type { Sql } from "postgres";

export type BookPresentationTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type BookPresentationStatus = "generating" | "completed" | "failed";

export type BookPresentationBookRecord = {
  id: string;
  title: string;
  sourceLabel: string;
};

export type BookPresentationTaskRecord = {
  id: string;
  draftId: string;
  bookId: string;
  status: BookPresentationTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string | null;
  error?: string | null;
  stale?: boolean;
};

export type BookPresentationRepository = {
  findBook(accountId: string, bookId: string): Promise<BookPresentationBookRecord | null>;
  listTasks(accountId: string, bookId: string): Promise<readonly BookPresentationTaskRecord[]>;
};

type BookPresentationTaskRow = {
  id: string;
  draftId: string;
  bookId: string;
  status: string;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId: string | null;
  error: string | null;
  stale: boolean;
};

/** Read-only adapter over the persisted M0 presentation tables. */
export class PostgresBookPresentationRepository implements BookPresentationRepository {
  constructor(private readonly sql: Sql) {}

  async findBook(accountId: string, bookId: string) {
    const [book] = await this.sql<Array<BookPresentationBookRecord>>`
      SELECT id, title, source_label AS "sourceLabel"
      FROM books
      WHERE account_id = ${accountId} AND id = ${bookId}
    `;
    return book ?? null;
  }

  async listTasks(accountId: string, bookId: string) {
    const rows = await this.sql<BookPresentationTaskRow[]>`
      SELECT task.id, task.draft_id AS "draftId", book.id AS "bookId",
             task.status, task.completed_pages AS "completedPages",
             task.total_pages AS "totalPages", task.version,
             task.artifact_id AS "artifactId", task.error,
             (
               draft.stage <> 'submitted'
               OR task.version < MAX(task.version) OVER (PARTITION BY task.account_id, task.draft_id)
             ) AS stale
      FROM ppt_tasks AS task
      JOIN ppt_drafts AS draft
        ON draft.account_id = task.account_id AND draft.id = task.draft_id
      JOIN conversations AS conversation
        ON conversation.account_id = draft.account_id
       AND conversation.id = draft.conversation_id
      JOIN books AS book
        ON book.account_id = conversation.account_id
       AND book.id = conversation.book_id
      WHERE task.account_id = ${accountId} AND book.id = ${bookId}
      ORDER BY task.version DESC, task.id DESC
    `;
    return rows.map((row) => ({
      ...row,
      status: row.status as BookPresentationTaskStatus,
    }));
  }
}

export type BookPresentationWork = {
  id: string;
  draftId: string;
  bookId: string;
  title: string;
  status: BookPresentationStatus;
  taskStatus: BookPresentationTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  stale: boolean;
  artifactId?: string;
  error?: string;
};

export type BookPresentationSnapshot = {
  book: BookPresentationBookRecord;
  state: "normal" | "empty" | "failed";
  current: BookPresentationWork | null;
  history: BookPresentationWork[];
};

function isTaskStatus(value: unknown): value is BookPresentationTaskStatus {
  return value === "queued"
    || value === "running"
    || value === "completed"
    || value === "failed"
    || value === "stopped";
}

function workStatus(value: BookPresentationTaskStatus): BookPresentationStatus {
  if (value === "queued" || value === "running") return "generating";
  if (value === "completed") return "completed";
  return "failed";
}

function validPageCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function toWork(task: BookPresentationTaskRecord, bookTitle: string): BookPresentationWork {
  if (!isTaskStatus(task.status)) throw new Error("INVALID_PRESENTATION_STATUS");
  if (
    typeof task.id !== "string"
    || typeof task.draftId !== "string"
    || typeof task.bookId !== "string"
    || !task.id.trim()
    || !task.draftId.trim()
    || !task.bookId.trim()
    || !validPageCount(task.completedPages)
    || !validPageCount(task.totalPages)
    || task.completedPages > task.totalPages
    || !Number.isSafeInteger(task.version)
    || task.version < 1
    || (task.artifactId !== null && task.artifactId !== undefined && typeof task.artifactId !== "string")
    || (task.error !== null && task.error !== undefined && typeof task.error !== "string")
    || (task.stale !== undefined && typeof task.stale !== "boolean")
  ) {
    throw new Error("INVALID_PRESENTATION_RECORD");
  }

  const artifactId = typeof task.artifactId === "string" && task.artifactId.trim()
    ? task.artifactId.trim()
    : undefined;
  const error = typeof task.error === "string" && task.error.trim()
    ? task.error.trim()
    : undefined;

  return {
    id: task.id,
    draftId: task.draftId,
    bookId: task.bookId,
    title: `《${bookTitle}》读书分享`,
    status: workStatus(task.status),
    taskStatus: task.status,
    completedPages: task.completedPages,
    totalPages: task.totalPages,
    version: task.version,
    stale: task.stale === true,
    ...(artifactId && task.status === "completed" ? { artifactId } : {}),
    ...(error ? { error } : {}),
  };
}

export class BookPresentationService {
  constructor(private readonly repository: BookPresentationRepository) {}

  async getBookPresentation(accountId: string, bookId: string): Promise<BookPresentationSnapshot> {
    const requestedAccountId = accountId.trim();
    const requestedBookId = bookId.trim();
    if (!requestedAccountId) throw new Error("ACCOUNT_REQUIRED");
    if (!requestedBookId) throw new Error("BOOK_NOT_FOUND");

    const book = await this.repository.findBook(requestedAccountId, requestedBookId);
    if (
      !book
      || typeof book.id !== "string"
      || typeof book.title !== "string"
      || typeof book.sourceLabel !== "string"
      || book.id !== requestedBookId
      || !book.title.trim()
    ) {
      throw new Error("BOOK_NOT_FOUND");
    }

    const tasks = await this.repository.listTasks(requestedAccountId, requestedBookId);
    if (tasks.some((task) => task.bookId !== requestedBookId)) {
      throw new Error("BOOK_PRESENTATION_MISMATCH");
    }

    const works = tasks
      .slice()
      .sort((left, right) => right.version - left.version || right.id.localeCompare(left.id))
      .map((task) => toWork(task, book.title.trim()));
    const currentCandidates = works.filter((work) => !work.stale);
    if (currentCandidates.length > 1) {
      throw new Error("BOOK_PRESENTATION_AMBIGUOUS");
    }
    const current = currentCandidates[0] ?? null;
    const currentIndex = current ? works.indexOf(current) : -1;

    return {
      book,
      state: current?.status === "failed" ? "failed" : current ? "normal" : "empty",
      current: current ?? null,
      history: works.filter((_work, index) => index !== currentIndex),
    };
  }
}

export function createBookPresentationService(repository: BookPresentationRepository) {
  return new BookPresentationService(repository);
}
