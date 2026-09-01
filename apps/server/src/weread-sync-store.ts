import { createHash, randomUUID } from "node:crypto";
import type {
  WeReadAnnotation,
  WeReadAnnotationsSnapshotRequest,
  WeReadAnnotationsSnapshotResponse,
  WeReadAnnotationsSyncResult,
  WeReadApiError,
  WeReadBook,
  WeReadBookProjection,
  WeReadBooksSnapshotRequest,
  WeReadBooksSnapshotResponse,
  WeReadSyncPage,
  WeReadSyncPause,
  WeReadSyncRunProjection,
} from "@selfalone/contracts";
import type { Sql, TransactionSql } from "postgres";

export type WeReadSyncStoreOptions = {
  now?: () => Date;
  runIdFactory?: () => string;
  bookIdFactory?: () => string;
};

export class WeReadSyncStore {
  readonly #sql: Sql;
  readonly #now: () => Date;
  readonly #runIdFactory: () => string;
  readonly #bookIdFactory: () => string;

  constructor(sql: Sql, options: WeReadSyncStoreOptions = {}) {
    this.#sql = sql;
    this.#now = options.now ?? (() => new Date());
    this.#runIdFactory = options.runIdFactory ?? randomUUID;
    this.#bookIdFactory = options.bookIdFactory ?? randomUUID;
  }

  async enqueueBooks(
    accountIdInput: string,
    input: { requestId: string; cursor?: string | null },
  ): Promise<WeReadSyncRunProjection> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const requestId = required(input.requestId, "WEREAD_REQUEST_REQUIRED");
    const cursor = optionalCursor(input.cursor);
    return this.#enqueue(accountId, {
      requestId,
      requestFingerprint: fingerprint(["books", cursor]),
      operation: "books",
      cursor,
    });
  }

  async enqueueAnnotations(
    accountIdInput: string,
    input: { requestId: string; bookId: string },
  ): Promise<WeReadSyncRunProjection> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const requestId = required(input.requestId, "WEREAD_REQUEST_REQUIRED");
    const bookId = required(input.bookId, "WEREAD_BOOK_NOT_FOUND");
    return this.#enqueue(accountId, {
      requestId,
      requestFingerprint: fingerprint(["annotations", bookId]),
      operation: "annotations",
      cursor: null,
      bookId,
    });
  }

  async #enqueue(
    accountId: string,
    input: {
      requestId: string;
      requestFingerprint: string;
      operation: "books" | "annotations";
      cursor: string | null;
      bookId?: string;
    },
  ) {
    return this.#sql.begin(async (transaction) => {
      await lockAccount(transaction, accountId);
      const existing = await findRunByRequest(transaction, accountId, input.requestId);
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint) throw new Error("CONFLICT");
        return toRunProjection(existing);
      }

      const connection = await findActiveConnection(transaction, accountId);
      if (!connection) throw new Error("WEREAD_CONNECTION_NOT_FOUND");
      let bookExternalId: string | null = null;
      if (input.operation === "annotations") {
        const book = await findVisibleBook(transaction, accountId, input.bookId!);
        if (!book || book.connectionId !== connection.connectionId) {
          throw new Error("WEREAD_BOOK_NOT_FOUND");
        }
        bookExternalId = book.externalId;
      }

      const runId = required(this.#runIdFactory(), "WEREAD_RUN_ID_REQUIRED");
      const now = validDate(this.#now(), "WEREAD_CLOCK_INVALID");
      const [stored] = await transaction<RunRow[]>`
        INSERT INTO weread_sync_runs (
          run_id, account_id, request_id, request_fingerprint, operation,
          connection_id, account_external_id, book_id, book_external_id,
          cursor, next_cursor, status, snapshot, retry_count,
          created_at, updated_at
        ) VALUES (
          ${runId}, ${accountId}, ${input.requestId}, ${input.requestFingerprint},
          ${input.operation}, ${connection.connectionId}, ${connection.accountExternalId},
          ${input.bookId ?? null}, ${bookExternalId}, ${input.cursor}, NULL,
          'queued', 'none', 0, ${now}, ${now}
        )
        RETURNING ${transaction.unsafe(runColumns)}
      `;
      if (!stored) throw new Error("WEREAD_RUN_NOT_FOUND");
      return toRunProjection(stored);
    });
  }

  async start(accountIdInput: string, runIdInput: string) {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const runId = required(runIdInput, "WEREAD_RUN_NOT_FOUND");
    return this.#sql.begin(async (transaction) => {
      const run = await findRun(transaction, accountId, runId);
      if (!run) throw new Error("WEREAD_RUN_NOT_FOUND");
      if (run.status === "running") return toRunProjection(run);
      if (run.status !== "queued") throw new Error("CONFLICT");
      const [updated] = await transaction<RunRow[]>`
        UPDATE weread_sync_runs
        SET status = 'running', updated_at = ${validDate(this.#now(), "WEREAD_CLOCK_INVALID")}
        WHERE account_id = ${accountId} AND run_id = ${runId}
        RETURNING ${transaction.unsafe(runColumns)}
      `;
      if (!updated) throw new Error("WEREAD_RUN_NOT_FOUND");
      return toRunProjection(updated);
    });
  }

  async claimNext(): Promise<{ accountId: string; run: WeReadSyncRunProjection } | null> {
    return this.#sql.begin(async (transaction) => {
      const [candidate] = await transaction<Array<{ accountId: string; runId: string }>>`
        SELECT account_id AS "accountId", run_id AS "runId"
        FROM weread_sync_runs
        WHERE status = 'queued'
        ORDER BY created_at, run_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!candidate) return null;
      const [updated] = await transaction<RunRow[]>`
        UPDATE weread_sync_runs
        SET status = 'running', updated_at = ${validDate(this.#now(), "WEREAD_CLOCK_INVALID")}
        WHERE account_id = ${candidate.accountId} AND run_id = ${candidate.runId}
        RETURNING ${transaction.unsafe(runColumns)}
      `;
      if (!updated) throw new Error("WEREAD_RUN_NOT_FOUND");
      return { accountId: candidate.accountId, run: toRunProjection(updated) };
    });
  }

  async recoverInterrupted(staleBeforeInput: Date) {
    const staleBefore = validDate(staleBeforeInput, "WEREAD_CLOCK_INVALID");
    const recovered = await this.#sql<Array<{ count: number }>>`
      WITH recovered AS (
        UPDATE weread_sync_runs
        SET status = 'queued', retry_count = retry_count + 1,
            updated_at = ${validDate(this.#now(), "WEREAD_CLOCK_INVALID")}
        WHERE status = 'running' AND updated_at < ${staleBefore}
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM recovered
    `;
    return recovered[0]?.count ?? 0;
  }

  async getRun(accountIdInput: string, runIdInput: string) {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const runId = required(runIdInput, "WEREAD_RUN_NOT_FOUND");
    const [row] = await this.#sql<RunRow[]>`
      SELECT ${this.#sql.unsafe(runColumns)}
      FROM weread_sync_runs
      WHERE account_id = ${accountId} AND run_id = ${runId}
    `;
    if (!row) throw new Error("WEREAD_RUN_NOT_FOUND");
    return toRunProjection(row);
  }

  async completeBooks(accountIdInput: string, runIdInput: string, page: WeReadSyncPage) {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const runId = required(runIdInput, "WEREAD_RUN_NOT_FOUND");
    const terminalFingerprint = fingerprintBooksResult(page);
    return this.#sql.begin(async (transaction) => {
      await lockAccount(transaction, accountId);
      const run = await findRun(transaction, accountId, runId);
      const replay = terminalReplay(run, terminalFingerprint);
      if (replay) return replay;
      assertRunning(run, "books");
      await assertCurrentConnection(transaction, accountId, run.connectionId);
      assertBooksResult(run, page);
      const completedAt = validDate(this.#now(), "WEREAD_CLOCK_INVALID");

      if (page.status === "success") {
        await replaceBooksSnapshot(
          transaction,
          run,
          page.books,
          completedAt,
          this.#bookIdFactory,
        );
        await writeBooksSnapshotState(transaction, run, {
          status: "success",
          pause: null,
          error: null,
          lastSuccessRunId: run.runId,
          updatedAt: completedAt,
        });
        return finishRun(transaction, run, {
          status: "completed",
          snapshot: "fresh",
          pause: null,
          error: null,
          terminalFingerprint,
          completedAt,
        });
      }

      await writeBooksSnapshotState(transaction, run, {
        status: "paused",
        pause: page.pause,
        error: null,
        lastSuccessRunId: undefined,
        updatedAt: completedAt,
      });
      return finishRun(transaction, run, {
        status: "paused",
        snapshot: "last_success",
        pause: page.pause,
        error: null,
        terminalFingerprint,
        completedAt,
      });
    });
  }

  async completeAnnotations(
    accountIdInput: string,
    runIdInput: string,
    result: WeReadAnnotationsSyncResult,
  ) {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const runId = required(runIdInput, "WEREAD_RUN_NOT_FOUND");
    const terminalFingerprint = fingerprintAnnotationsResult(result);
    return this.#sql.begin(async (transaction) => {
      await lockAccount(transaction, accountId);
      const run = await findRun(transaction, accountId, runId);
      const replay = terminalReplay(run, terminalFingerprint);
      if (replay) return replay;
      assertRunning(run, "annotations");
      await assertCurrentConnection(transaction, accountId, run.connectionId);
      assertAnnotationsResult(run, result);
      const completedAt = validDate(this.#now(), "WEREAD_CLOCK_INVALID");

      if (result.status === "success") {
        await replaceAnnotationsSnapshot(transaction, run, result.annotations, completedAt);
        await writeAnnotationsSnapshotState(transaction, run, {
          status: "success",
          pause: null,
          error: null,
          lastSuccessRunId: run.runId,
          updatedAt: completedAt,
        });
        return finishRun(transaction, run, {
          status: "completed",
          snapshot: "fresh",
          pause: null,
          error: null,
          terminalFingerprint,
          completedAt,
        });
      }

      await writeAnnotationsSnapshotState(transaction, run, {
        status: "paused",
        pause: result.pause,
        error: null,
        lastSuccessRunId: undefined,
        updatedAt: completedAt,
      });
      return finishRun(transaction, run, {
        status: "paused",
        snapshot: "last_success",
        pause: result.pause,
        error: null,
        terminalFingerprint,
        completedAt,
      });
    });
  }

  async fail(accountIdInput: string, runIdInput: string, errorInput: WeReadApiError) {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const runId = required(runIdInput, "WEREAD_RUN_NOT_FOUND");
    const error = validApiError(errorInput);
    const terminalFingerprint = fingerprintFailure(error);
    return this.#sql.begin(async (transaction) => {
      await lockAccount(transaction, accountId);
      const run = await findRun(transaction, accountId, runId);
      const replay = terminalReplay(run, terminalFingerprint);
      if (replay) return replay;
      if (!run || (run.status !== "queued" && run.status !== "running")) {
        throw new Error(run ? "CONFLICT" : "WEREAD_RUN_NOT_FOUND");
      }
      const completedAt = validDate(this.#now(), "WEREAD_CLOCK_INVALID");
      const currentConnection = await findActiveConnection(transaction, accountId);
      if (currentConnection?.connectionId === run.connectionId) {
        if (run.operation === "books") {
          await writeBooksSnapshotState(transaction, run, {
            status: "failed",
            pause: null,
            error,
            lastSuccessRunId: undefined,
            updatedAt: completedAt,
          });
        } else {
          await writeAnnotationsSnapshotState(transaction, run, {
            status: "failed",
            pause: null,
            error,
            lastSuccessRunId: undefined,
            updatedAt: completedAt,
          });
        }
      }
      return finishRun(transaction, run, {
        status: "failed",
        snapshot: "last_success",
        pause: null,
        error,
        terminalFingerprint,
        completedAt,
      });
    });
  }

  async getBooksSnapshot(
    accountIdInput: string,
    input: WeReadBooksSnapshotRequest,
  ): Promise<WeReadBooksSnapshotResponse> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const cursor = optionalCursor(input.cursor);
    const [state] = await this.#sql<BookSnapshotStateRow[]>`
      SELECT connection_id AS "connectionId", account_external_id AS "accountExternalId",
        cursor, next_cursor AS "nextCursor", status, pause, error
      FROM weread_book_snapshot_state WHERE account_id = ${accountId}
    `;
    if (!state || state.cursor !== cursor) throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
    const rows = await this.#sql<BookRow[]>`
      SELECT book_id AS "bookId", external_id AS "externalId", title, author,
        cover_url AS "coverUrl", progress_percent AS "progressPercent",
        last_read_at AS "lastReadAt"
      FROM weread_books
      WHERE account_id = ${accountId}
        AND connection_id = ${state.connectionId}
        AND visible = true
      ORDER BY sort_order, book_id
    `;
    const base = {
      connectionId: state.connectionId,
      accountExternalId: state.accountExternalId,
      cursor: state.cursor,
      nextCursor: state.nextCursor,
      books: rows.map(toBookProjection),
      snapshot: "last_success" as const,
    };
    if (state.status === "success") return { ...base, status: "success" };
    if (state.status === "paused" && state.pause) {
      return { ...base, status: "paused", nextCursor: null, pause: state.pause };
    }
    if (state.status === "failed" && state.error) {
      return { ...base, status: "failed", nextCursor: null, error: state.error };
    }
    throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
  }

  async getAnnotationsSnapshot(
    accountIdInput: string,
    input: WeReadAnnotationsSnapshotRequest,
  ): Promise<WeReadAnnotationsSnapshotResponse> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const bookId = required(input.bookId, "WEREAD_BOOK_NOT_FOUND");
    const [state] = await this.#sql<AnnotationSnapshotStateRow[]>`
      SELECT connection_id AS "connectionId", account_external_id AS "accountExternalId",
        book_external_id AS "bookExternalId", status, pause, error
      FROM weread_annotation_snapshot_state
      WHERE account_id = ${accountId} AND book_id = ${bookId}
    `;
    if (!state) throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
    const rows = await this.#sql<AnnotationRow[]>`
      SELECT external_id AS "externalId",
        weread_annotations.book_external_id AS "bookExternalId",
        quote, thought, location, provider_created_at AS "createdAt",
        provider_updated_at AS "updatedAt"
      FROM weread_annotations
      JOIN weread_sync_runs
        ON weread_sync_runs.run_id = weread_annotations.snapshot_run_id
        AND weread_sync_runs.account_id = weread_annotations.account_id
      WHERE weread_annotations.account_id = ${accountId}
        AND weread_annotations.book_id = ${bookId}
        AND weread_annotations.visible = true
        AND weread_sync_runs.connection_id = ${state.connectionId}
      ORDER BY weread_annotations.sort_order, weread_annotations.external_id
    `;
    const base = {
      connectionId: state.connectionId,
      accountExternalId: state.accountExternalId,
      bookId,
      bookExternalId: state.bookExternalId,
      annotations: rows.map(toAnnotation),
      snapshot: "last_success" as const,
    };
    if (state.status === "success") return { ...base, status: "success" };
    if (state.status === "paused" && state.pause) {
      return { ...base, status: "paused", pause: state.pause };
    }
    if (state.status === "failed" && state.error) {
      return { ...base, status: "failed", error: state.error };
    }
    throw new Error("WEREAD_SNAPSHOT_NOT_FOUND");
  }
}

type RunRow = {
  runId: string;
  accountId: string;
  requestId: string;
  requestFingerprint: string;
  operation: "books" | "annotations";
  connectionId: string;
  accountExternalId: string;
  bookId: string | null;
  bookExternalId: string | null;
  cursor: string | null;
  nextCursor: string | null;
  status: "queued" | "running" | "completed" | "paused" | "failed";
  snapshot: "none" | "fresh" | "last_success";
  retryCount: number;
  pause: WeReadSyncPause | null;
  error: WeReadApiError | null;
  terminalFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type ConnectionRow = { connectionId: string; accountExternalId: string };
type BookIdentityRow = { connectionId: string; externalId: string };
type BookRow = WeReadBookProjection & { lastReadAt: Date | null };
type BookSnapshotStateRow = {
  connectionId: string;
  accountExternalId: string;
  cursor: string | null;
  nextCursor: string | null;
  status: "success" | "paused" | "failed";
  pause: WeReadSyncPause | null;
  error: WeReadApiError | null;
};
type AnnotationRow = Omit<WeReadAnnotation, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};
type AnnotationSnapshotStateRow = {
  connectionId: string;
  accountExternalId: string;
  bookExternalId: string;
  status: "success" | "paused" | "failed";
  pause: WeReadSyncPause | null;
  error: WeReadApiError | null;
};

const runColumns = `
  run_id AS "runId", account_id AS "accountId", request_id AS "requestId",
  request_fingerprint AS "requestFingerprint", operation,
  connection_id AS "connectionId", account_external_id AS "accountExternalId",
  book_id AS "bookId", book_external_id AS "bookExternalId",
  cursor, next_cursor AS "nextCursor", status, snapshot,
  retry_count AS "retryCount", pause, error,
  terminal_fingerprint AS "terminalFingerprint",
  created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
`;

async function lockAccount(transaction: TransactionSql, accountId: string) {
  const [account] = await transaction<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE
  `;
  if (!account) throw new Error("ACCOUNT_REQUIRED");
}

async function findActiveConnection(transaction: TransactionSql, accountId: string) {
  const [connection] = await transaction<ConnectionRow[]>`
    SELECT connection_id AS "connectionId", account_external_id AS "accountExternalId"
    FROM weread_connections
    WHERE account_id = ${accountId} AND status IN ('verified', 'paused')
  `;
  return connection;
}

async function assertCurrentConnection(
  transaction: TransactionSql,
  accountId: string,
  connectionId: string,
) {
  const current = await findActiveConnection(transaction, accountId);
  if (current?.connectionId !== connectionId) throw new Error("STALE_VERSION");
}

async function findVisibleBook(transaction: TransactionSql, accountId: string, bookId: string) {
  const [book] = await transaction<BookIdentityRow[]>`
    SELECT connection_id AS "connectionId", external_id AS "externalId"
    FROM weread_books
    WHERE account_id = ${accountId} AND book_id = ${bookId} AND visible = true
  `;
  return book;
}

async function findRunByRequest(
  transaction: TransactionSql,
  accountId: string,
  requestId: string,
) {
  const [row] = await transaction<RunRow[]>`
    SELECT ${transaction.unsafe(runColumns)}
    FROM weread_sync_runs
    WHERE account_id = ${accountId} AND request_id = ${requestId}
    FOR UPDATE
  `;
  return row;
}

async function findRun(transaction: TransactionSql, accountId: string, runId: string) {
  const [row] = await transaction<RunRow[]>`
    SELECT ${transaction.unsafe(runColumns)}
    FROM weread_sync_runs
    WHERE account_id = ${accountId} AND run_id = ${runId}
    FOR UPDATE
  `;
  return row;
}

function terminalReplay(run: RunRow | undefined, terminalFingerprint: string) {
  if (!run) throw new Error("WEREAD_RUN_NOT_FOUND");
  if (run.status === "queued" || run.status === "running") return null;
  if (run.terminalFingerprint !== terminalFingerprint) throw new Error("CONFLICT");
  return toRunProjection(run);
}

function assertRunning(run: RunRow | undefined, operation: RunRow["operation"]): asserts run is RunRow {
  if (!run) throw new Error("WEREAD_RUN_NOT_FOUND");
  if (run.status !== "running" || run.operation !== operation) throw new Error("CONFLICT");
}

function assertBooksResult(run: RunRow, page: WeReadSyncPage) {
  if (
    page.connectionId !== run.connectionId
    || page.accountExternalId !== run.accountExternalId
    || page.cursor !== run.cursor
    || page.nextCursor !== null
  ) {
    throw new Error("CONFLICT");
  }
  const externalIds = new Set<string>();
  for (const book of page.books) {
    validBook(book);
    if (externalIds.has(book.externalId)) throw new Error("CONFLICT");
    externalIds.add(book.externalId);
  }
}

function assertAnnotationsResult(run: RunRow, result: WeReadAnnotationsSyncResult) {
  if (
    result.connectionId !== run.connectionId
    || result.accountExternalId !== run.accountExternalId
    || result.bookExternalId !== run.bookExternalId
  ) {
    throw new Error("CONFLICT");
  }
  const externalIds = new Set<string>();
  for (const annotation of result.annotations) {
    validAnnotation(annotation, run.bookExternalId!);
    if (externalIds.has(annotation.externalId)) throw new Error("CONFLICT");
    externalIds.add(annotation.externalId);
  }
}

async function replaceBooksSnapshot(
  transaction: TransactionSql,
  run: RunRow,
  books: readonly WeReadBook[],
  now: Date,
  bookIdFactory: () => string,
) {
  await transaction`
    UPDATE weread_books SET visible = false, updated_at = ${now}
    WHERE account_id = ${run.accountId}
  `;
  for (const [index, book] of books.entries()) {
    const [existing] = await transaction<Array<{ bookId: string }>>`
      SELECT book_id AS "bookId" FROM weread_books
      WHERE account_id = ${run.accountId} AND external_id = ${book.externalId}
    `;
    const bookId = existing?.bookId
      ?? required(bookIdFactory(), "WEREAD_BOOK_ID_REQUIRED");
    await transaction`
      INSERT INTO weread_books (
        account_id, book_id, connection_id, account_external_id, external_id,
        title, author, cover_url, progress_percent, last_read_at,
        visible, sort_order, snapshot_run_id, created_at, updated_at
      ) VALUES (
        ${run.accountId}, ${bookId}, ${run.connectionId}, ${run.accountExternalId},
        ${book.externalId}, ${book.title}, ${book.author}, ${book.coverUrl},
        ${book.progressPercent}, ${dateOrNull(book.lastReadAt)}, true, ${index},
        ${run.runId}, ${now}, ${now}
      )
      ON CONFLICT (account_id, external_id) DO UPDATE
      SET connection_id = EXCLUDED.connection_id,
          account_external_id = EXCLUDED.account_external_id,
          title = EXCLUDED.title,
          author = EXCLUDED.author,
          cover_url = EXCLUDED.cover_url,
          progress_percent = EXCLUDED.progress_percent,
          last_read_at = EXCLUDED.last_read_at,
          visible = true,
          sort_order = EXCLUDED.sort_order,
          snapshot_run_id = EXCLUDED.snapshot_run_id,
          updated_at = EXCLUDED.updated_at
    `;
  }
}

async function replaceAnnotationsSnapshot(
  transaction: TransactionSql,
  run: RunRow,
  annotations: readonly WeReadAnnotation[],
  now: Date,
) {
  await transaction`
    UPDATE weread_annotations SET visible = false, updated_at = ${now}
    WHERE account_id = ${run.accountId} AND book_id = ${run.bookId}
  `;
  for (const [index, annotation] of annotations.entries()) {
    await transaction`
      INSERT INTO weread_annotations (
        account_id, book_id, external_id, book_external_id, quote, thought,
        location, provider_created_at, provider_updated_at, visible, sort_order,
        snapshot_run_id, created_at, updated_at
      ) VALUES (
        ${run.accountId}, ${run.bookId}, ${annotation.externalId},
        ${annotation.bookExternalId}, ${annotation.quote}, ${annotation.thought},
        ${annotation.location}, ${validDate(new Date(annotation.createdAt), "CONFLICT")},
        ${validDate(new Date(annotation.updatedAt), "CONFLICT")}, true, ${index},
        ${run.runId}, ${now}, ${now}
      )
      ON CONFLICT (account_id, book_id, external_id) DO UPDATE
      SET book_external_id = EXCLUDED.book_external_id,
          quote = EXCLUDED.quote,
          thought = EXCLUDED.thought,
          location = EXCLUDED.location,
          provider_created_at = EXCLUDED.provider_created_at,
          provider_updated_at = EXCLUDED.provider_updated_at,
          visible = true,
          sort_order = EXCLUDED.sort_order,
          snapshot_run_id = EXCLUDED.snapshot_run_id,
          updated_at = EXCLUDED.updated_at
    `;
  }
}

async function writeBooksSnapshotState(
  transaction: TransactionSql,
  run: RunRow,
  input: SnapshotStateInput,
) {
  await transaction`
    INSERT INTO weread_book_snapshot_state (
      account_id, connection_id, account_external_id, cursor, next_cursor,
      status, pause, error, last_success_run_id, updated_at
    ) VALUES (
      ${run.accountId}, ${run.connectionId}, ${run.accountExternalId}, ${run.cursor}, NULL,
      ${input.status}, ${input.pause ? transaction.json(input.pause) : null},
      ${input.error ? transaction.json(input.error) : null},
      ${input.lastSuccessRunId ?? null}, ${input.updatedAt}
    )
    ON CONFLICT (account_id) DO UPDATE
    SET connection_id = EXCLUDED.connection_id,
        account_external_id = EXCLUDED.account_external_id,
        cursor = EXCLUDED.cursor,
        next_cursor = EXCLUDED.next_cursor,
        status = EXCLUDED.status,
        pause = EXCLUDED.pause,
        error = EXCLUDED.error,
        last_success_run_id = COALESCE(
          EXCLUDED.last_success_run_id,
          weread_book_snapshot_state.last_success_run_id
        ),
        updated_at = EXCLUDED.updated_at
  `;
}

async function writeAnnotationsSnapshotState(
  transaction: TransactionSql,
  run: RunRow,
  input: SnapshotStateInput,
) {
  await transaction`
    INSERT INTO weread_annotation_snapshot_state (
      account_id, book_id, connection_id, account_external_id, book_external_id,
      status, pause, error, last_success_run_id, updated_at
    ) VALUES (
      ${run.accountId}, ${run.bookId}, ${run.connectionId}, ${run.accountExternalId},
      ${run.bookExternalId}, ${input.status},
      ${input.pause ? transaction.json(input.pause) : null},
      ${input.error ? transaction.json(input.error) : null},
      ${input.lastSuccessRunId ?? null}, ${input.updatedAt}
    )
    ON CONFLICT (account_id, book_id) DO UPDATE
    SET connection_id = EXCLUDED.connection_id,
        account_external_id = EXCLUDED.account_external_id,
        book_external_id = EXCLUDED.book_external_id,
        status = EXCLUDED.status,
        pause = EXCLUDED.pause,
        error = EXCLUDED.error,
        last_success_run_id = COALESCE(
          EXCLUDED.last_success_run_id,
          weread_annotation_snapshot_state.last_success_run_id
        ),
        updated_at = EXCLUDED.updated_at
  `;
}

type SnapshotStateInput = {
  status: "success" | "paused" | "failed";
  pause: WeReadSyncPause | null;
  error: WeReadApiError | null;
  lastSuccessRunId: string | undefined;
  updatedAt: Date;
};

async function finishRun(
  transaction: TransactionSql,
  run: RunRow,
  input: {
    status: "completed" | "paused" | "failed";
    snapshot: "fresh" | "last_success";
    pause: WeReadSyncPause | null;
    error: WeReadApiError | null;
    terminalFingerprint: string;
    completedAt: Date;
  },
) {
  const [updated] = await transaction<RunRow[]>`
    UPDATE weread_sync_runs
    SET status = ${input.status}, snapshot = ${input.snapshot}, next_cursor = NULL,
        pause = ${input.pause ? transaction.json(input.pause) : null},
        error = ${input.error ? transaction.json(input.error) : null},
        terminal_fingerprint = ${input.terminalFingerprint},
        updated_at = ${input.completedAt}, completed_at = ${input.completedAt}
    WHERE account_id = ${run.accountId} AND run_id = ${run.runId}
    RETURNING ${transaction.unsafe(runColumns)}
  `;
  if (!updated) throw new Error("WEREAD_RUN_NOT_FOUND");
  return toRunProjection(updated);
}

function toRunProjection(row: RunRow): WeReadSyncRunProjection {
  const base = {
    runId: row.runId,
    requestId: row.requestId,
    operation: row.operation,
    connectionId: row.connectionId,
    accountExternalId: row.accountExternalId,
    status: row.status,
    snapshot: row.snapshot,
    cursor: row.cursor,
    nextCursor: row.nextCursor,
    retryCount: row.retryCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.operation === "annotations"
      ? { bookId: row.bookId!, bookExternalId: row.bookExternalId! }
      : {}),
    ...(row.status === "paused" ? { pause: row.pause! } : {}),
    ...(row.status === "failed" ? { error: row.error! } : {}),
  };
  return base as WeReadSyncRunProjection;
}

function toBookProjection(row: BookRow): WeReadBookProjection {
  return {
    bookId: row.bookId,
    externalId: row.externalId,
    title: row.title,
    author: row.author,
    coverUrl: row.coverUrl,
    progressPercent: row.progressPercent,
    lastReadAt: row.lastReadAt?.toISOString() ?? null,
  };
}

function toAnnotation(row: AnnotationRow): WeReadAnnotation {
  return {
    externalId: row.externalId,
    bookExternalId: row.bookExternalId,
    quote: row.quote,
    thought: row.thought,
    location: row.location,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validBook(book: WeReadBook) {
  required(book.externalId, "CONFLICT");
  required(book.title, "CONFLICT");
  if (
    book.progressPercent !== null
    && (!Number.isInteger(book.progressPercent)
      || book.progressPercent < 0
      || book.progressPercent > 100)
  ) {
    throw new Error("CONFLICT");
  }
  dateOrNull(book.lastReadAt);
}

function validAnnotation(annotation: WeReadAnnotation, bookExternalId: string) {
  required(annotation.externalId, "CONFLICT");
  required(annotation.quote, "CONFLICT");
  if (annotation.bookExternalId !== bookExternalId) throw new Error("CONFLICT");
  validDate(new Date(annotation.createdAt), "CONFLICT");
  validDate(new Date(annotation.updatedAt), "CONFLICT");
}

function validApiError(error: WeReadApiError): WeReadApiError {
  if (!error || typeof error !== "object") throw new Error("CONFLICT");
  required(error.code, "CONFLICT");
  required(error.message, "CONFLICT");
  if (typeof error.retryable !== "boolean") throw new Error("CONFLICT");
  return structuredClone(error);
}

function required(value: string, code: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) throw new Error(code);
  return value.trim();
}

function optionalCursor(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    throw new Error("CONFLICT");
  }
  return value;
}

function validDate(value: Date, code: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(code);
  return value;
}

function dateOrNull(value: string | null) {
  return value === null ? null : validDate(new Date(value), "CONFLICT");
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fingerprintFailure(error: WeReadApiError) {
  const fieldErrors = error.fieldErrors;
  return fingerprint([
    "failed",
    error.code,
    error.message,
    error.retryable,
    fieldErrors
      ? Object.keys(fieldErrors).sort().map((field) => [field, fieldErrors[field]])
      : null,
  ]);
}

function fingerprintBooksResult(page: WeReadSyncPage) {
  return fingerprint([
    page.status,
    page.connectionId,
    page.accountExternalId,
    page.cursor,
    page.nextCursor,
    page.books.map((book) => [
      book.externalId,
      book.title,
      book.author,
      book.coverUrl,
      book.progressPercent,
      book.lastReadAt,
    ]),
    page.status === "paused" ? page.pause : null,
  ]);
}

function fingerprintAnnotationsResult(result: WeReadAnnotationsSyncResult) {
  return fingerprint([
    result.status,
    result.connectionId,
    result.accountExternalId,
    result.bookExternalId,
    result.annotations.map((annotation) => [
      annotation.externalId,
      annotation.bookExternalId,
      annotation.quote,
      annotation.thought,
      annotation.location,
      annotation.createdAt,
      annotation.updatedAt,
    ]),
    result.status === "paused" ? result.pause : null,
  ]);
}
