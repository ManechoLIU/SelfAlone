import type { WeReadPort } from "./weread";
import {
  wereadBookId,
  type WeReadAnnotation,
  type WeReadAnnotationsSyncRunProjection,
  type WeReadApiErrorCode,
  type WeReadBook,
  type WeReadBooksSyncRunProjection,
  type WeReadConnectionProjection,
  type WeReadConnectionPutResponse,
  type WeReadSyncOperation,
  type WeReadSyncRunProjection,
} from "../core/weread-state";

/**
 * Deterministic in-memory WeRead port for the develop runtime only.
 * It never touches wx.request, fetch, credentials, or persistent storage;
 * all state lives in the closure of one port instance.
 */

class DevelopmentWeReadError extends Error {
  constructor(
    readonly code: WeReadApiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DevelopmentWeReadError";
  }
}

type DevelopmentBookFixture = {
  externalId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  progressPercent: number | null;
  lastReadAt: string | null;
  annotations: WeReadAnnotation[];
};

type DevelopmentAccountFixture = {
  accountExternalId: string;
  books: DevelopmentBookFixture[];
};

function seedAnnotation(
  externalId: string,
  bookExternalId: string,
  quote: string,
  thought: string | null,
  location: string,
  day: string,
): WeReadAnnotation {
  return {
    externalId,
    bookExternalId,
    quote,
    thought,
    location,
    createdAt: `2030-01-${day}T08:00:00.000Z`,
    updatedAt: `2030-01-${day}T08:00:00.000Z`,
  };
}

const DEVELOPMENT_ACCOUNTS: Record<string, DevelopmentAccountFixture> = {
  "wrk-dev-a": {
    accountExternalId: "weread-dev-account-a",
    books: [
      {
        externalId: "wr-dev-book-a-quiet",
        title: "安静的河岸",
        author: "李澈",
        coverUrl: null,
        progressPercent: 42,
        lastReadAt: "2030-01-10T21:30:00.000Z",
        annotations: [
          seedAnnotation("wr-dev-ann-a-quiet-01", "wr-dev-book-a-quiet", "水面安静下来，声音反而更清晰。", "留给自己回读。", "第 3 章", "11"),
          seedAnnotation("wr-dev-ann-a-quiet-02", "wr-dev-book-a-quiet", "慢不是停，是把注意力还给自己。", null, "第 5 章", "12"),
        ],
      },
      {
        externalId: "wr-dev-book-a-tide",
        title: "潮汐笔记",
        author: null,
        coverUrl: null,
        progressPercent: null,
        lastReadAt: null,
        annotations: [
          seedAnnotation("wr-dev-ann-a-tide-01", "wr-dev-book-a-tide", "潮水退去之后，才知道什么留在岸上。", null, "第 1 章", "13"),
        ],
      },
    ],
  },
  "wrk-dev-b": {
    accountExternalId: "weread-dev-account-b",
    books: [
      {
        externalId: "wr-dev-book-b-ember",
        title: "余烬叙事",
        author: "周燃",
        coverUrl: null,
        progressPercent: 77,
        lastReadAt: "2030-02-01T22:10:00.000Z",
        annotations: [
          seedAnnotation("wr-dev-ann-b-ember-01", "wr-dev-book-b-ember", "火熄灭以后，温度还留在石头里。", "对照 quiet 的意象。", "第 2 章", "14"),
          seedAnnotation("wr-dev-ann-b-ember-02", "wr-dev-book-b-ember", "叙事是把灰烬重新排队。", null, "第 4 章", "15"),
        ],
      },
      {
        externalId: "wr-dev-book-b-north",
        title: "北境手稿",
        author: null,
        coverUrl: null,
        progressPercent: null,
        lastReadAt: null,
        annotations: [
          seedAnnotation("wr-dev-ann-b-north-01", "wr-dev-book-b-north", "北方来信只写了半页，剩下的是沉默。", null, "第 1 章", "16"),
        ],
      },
    ],
  },
};

function toWeReadBook(fixture: DevelopmentBookFixture): WeReadBook {
  return {
    bookId: wereadBookId(fixture.externalId),
    externalId: fixture.externalId,
    title: fixture.title,
    author: fixture.author,
    coverUrl: fixture.coverUrl,
    progressPercent: fixture.progressPercent,
    lastReadAt: fixture.lastReadAt,
  };
}

const conflict = (message: string) => new DevelopmentWeReadError("CONFLICT", message, false);
const authRequired = (message: string) => new DevelopmentWeReadError("EXTERNAL_AUTH_REQUIRED", message, false);
const validationFailed = (message: string) => new DevelopmentWeReadError("VALIDATION_FAILED", message, false);

export function createDevelopmentWeReadPort(): WeReadPort {
  let connection: WeReadConnectionProjection | null = null;
  let activeAccount: DevelopmentAccountFixture | null = null;
  let connectionCounter = 0;
  let revisionCounter = 0;
  let runCounter = 0;
  let tick = 0;
  const connectAttempts = new Map<string, { response?: WeReadConnectionPutResponse }>();
  const syncRunsByRequestId = new Map<string, WeReadSyncRunProjection>();
  const syncRunsById = new Map<string, WeReadSyncRunProjection>();

  const now = () => new Date(Date.UTC(2030, 0, 1, 0, 0, (tick += 1))).toISOString();

  const requireAccount = (): DevelopmentAccountFixture => {
    if (!connection || !activeAccount) {
      throw authRequired("微信读书尚未连接");
    }
    return activeAccount;
  };

  const registerRun = <TRun extends WeReadSyncRunProjection>(run: TRun): TRun => {
    syncRunsByRequestId.set(run.requestId, run);
    syncRunsById.set(run.runId, run);
    return run;
  };

  // A stored run may be replayed only while it still belongs to the live
  // connection and matches the requested operation (and book). Anything else
  // fails closed instead of returning a semantically wrong or stale run.
  const assertSyncReplay = (
    run: WeReadSyncRunProjection,
    operation: WeReadSyncOperation,
    bookId?: string,
  ): void => {
    if (!connection || run.connectionId !== connection.connectionId) {
      throw conflict("同步任务已失效，请重新发起同步");
    }
    if (run.operation !== operation) {
      throw conflict("同一 requestId 不能重放为不同的同步操作");
    }
    if (operation === "annotations" && run.bookId !== bookId) {
      throw conflict("同一 requestId 不能重放为不同的书籍");
    }
  };

  const completedBooksRun = (requestId: string, cursor: string | null): WeReadBooksSyncRunProjection => {
    const active = requireAccount();
    const at = now();
    return registerRun({
      runId: `dev-wr-run-${(runCounter += 1)}`,
      requestId,
      operation: "books",
      connectionId: connection!.connectionId,
      accountExternalId: active.accountExternalId,
      status: "completed",
      snapshot: "fresh",
      cursor,
      nextCursor: null,
      retryCount: 0,
      createdAt: at,
      updatedAt: at,
      completedAt: at,
    });
  };

  const findBook = (bookId: string): DevelopmentBookFixture => {
    const active = requireAccount();
    const book = active.books.find((candidate) => wereadBookId(candidate.externalId) === bookId);
    if (!book) {
      throw validationFailed("当前账号下不存在这本书");
    }
    return book;
  };

  return {
    getConnection: async () => ({ connection }),

    putConnection: async (input) => {
      const prior = connectAttempts.get(input.requestId);
      // Idempotent replay only while the stored success is still the live
      // connection for the same account. After disconnect or replacement the
      // old requestId fails closed and never resurrects stale state.
      if (prior?.response) {
        const stored = prior.response.connection;
        const account = DEVELOPMENT_ACCOUNTS[input.apiKey];
        if (
          connection &&
          connection.connectionId === stored.connectionId &&
          connection.revision === stored.revision &&
          account?.accountExternalId === stored.accountExternalId
        ) {
          return prior.response;
        }
        throw conflict("微信读书连接状态已变化，该请求不能重放");
      }
      const expectedRevision = connection ? connection.revision : null;
      if (input.expectedRevision !== expectedRevision) {
        throw conflict("微信读书连接版本已变化，请刷新后重试");
      }
      const account = DEVELOPMENT_ACCOUNTS[input.apiKey];
      if (!account) {
        throw authRequired("微信读书凭证无效");
      }
      // Deterministic QA path: the first attempt for a fresh requestId fails
      // retryable; a retry with the same requestId succeeds.
      if (!prior) {
        connectAttempts.set(input.requestId, {});
        throw new DevelopmentWeReadError("EXTERNAL_SERVICE_FAILED", "微信读书服务暂时不可用，请重试", true);
      }
      connectionCounter += 1;
      revisionCounter += 1;
      connection = {
        connectionId: `dev-wr-conn-${connectionCounter}`,
        accountExternalId: account.accountExternalId,
        apiKeyHint: `wrk-***-${input.apiKey.slice(-1)}`,
        status: "verified",
        verifiedAt: now(),
        revision: String(revisionCounter),
      };
      activeAccount = account;
      const response: WeReadConnectionPutResponse = {
        connection,
        sync: { run: completedBooksRun(input.requestId, null) },
      };
      connectAttempts.set(input.requestId, { response });
      return response;
    },

    deleteConnection: async (input) => {
      if (!connection || input.expectedRevision !== connection.revision) {
        throw conflict("微信读书连接版本已变化，请刷新后重试");
      }
      connection = null;
      activeAccount = null;
      return { status: "disconnected" };
    },

    getBooks: async (input) => {
      const active = requireAccount();
      return {
        status: "success",
        snapshot: "last_success",
        connectionId: connection!.connectionId,
        accountExternalId: active.accountExternalId,
        cursor: input?.cursor ?? null,
        nextCursor: null,
        books: active.books.map(toWeReadBook),
      };
    },

    syncBooks: async (input) => {
      requireAccount();
      const existing = syncRunsByRequestId.get(input.requestId);
      if (existing) {
        assertSyncReplay(existing, "books");
        return { run: existing as WeReadBooksSyncRunProjection };
      }
      return { run: completedBooksRun(input.requestId, input.cursor ?? null) };
    },

    getAnnotations: async (input) => {
      const active = requireAccount();
      const book = findBook(input.bookId);
      return {
        status: "success",
        snapshot: "last_success",
        connectionId: connection!.connectionId,
        accountExternalId: active.accountExternalId,
        bookId: input.bookId,
        bookExternalId: book.externalId,
        annotations: book.annotations,
      };
    },

    syncAnnotations: async (input) => {
      const active = requireAccount();
      const book = findBook(input.bookId);
      const existing = syncRunsByRequestId.get(input.requestId);
      if (existing) {
        assertSyncReplay(existing, "annotations", input.bookId);
        return { run: existing as WeReadAnnotationsSyncRunProjection };
      }
      const at = now();
      const run: WeReadAnnotationsSyncRunProjection = registerRun({
        runId: `dev-wr-run-${(runCounter += 1)}`,
        requestId: input.requestId,
        operation: "annotations",
        connectionId: connection!.connectionId,
        accountExternalId: active.accountExternalId,
        status: "completed",
        snapshot: "fresh",
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: at,
        updatedAt: at,
        completedAt: at,
        bookId: input.bookId,
        bookExternalId: book.externalId,
      });
      return { run };
    },

    getSyncStatus: async (runId) => {
      const run = syncRunsById.get(runId);
      if (!run) {
        throw validationFailed("同步任务不存在");
      }
      // Stale lifecycle: runs from a disconnected or replaced connection
      // fail closed instead of exposing obsolete state.
      requireAccount();
      if (run.connectionId !== connection!.connectionId) {
        throw conflict("同步任务已失效，请重新发起同步");
      }
      return { run };
    },
  };
}
