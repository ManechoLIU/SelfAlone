type PdfPageOutcome =
  | { pageNumber: number; state: "ready_text" | "ready_image" }
  | {
      pageNumber: number;
      state: "failed";
      errorCode: "PDF_PAGE_RENDER_FAILED" | "PDF_PAGE_UNSUPPORTED";
      retryable: boolean;
    };

type PdfReaderAdapterPort = {
  readonly rendererVersion: string;
  inspect(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    objectKey: string;
    byteSize: number;
  }): Promise<{ pageCount: number }>;
  renderPage(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    objectKey: string;
    pageNumber: number;
    width: number;
    height: number;
  }): Promise<
    | { state: "ready_text"; textLayer: string; imageBytes?: Uint8Array }
    | { state: "ready_image"; imageBytes: Uint8Array }
  >;
};

export type PdfLocator = {
  kind: "pdf";
  fileVersion: number;
  pageNumber: number;
};

export type PdfReaderLease = {
  token: string;
  owner: string;
  expiresAt: number;
};

export type PdfReaderFileRecord = {
  accountId: string;
  bookId: string;
  fileVersion: number;
  objectKey: string;
  byteSize: number;
  status: "pending" | "processing" | "ready" | "ready_partial" | "failed";
  pageCount: number | null;
  lease: PdfReaderLease | null;
  errorCode?: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | "PDF_LIMIT_EXCEEDED" | null;
};

export type PdfReaderPageRecord = PdfPageOutcome & {
  cacheKey: string | null;
  rendererVersion: string;
  width: number;
  height: number;
  textLayer: string | null;
};

export type PdfReaderRepository = {
  getFile(accountId: string, bookId: string): Promise<PdfReaderFileRecord | null>;
  acquireLease(input: {
    accountId: string;
    bookId: string;
    expectedFileVersion: number;
    workerId: string;
    now: number;
    leaseMs: number;
  }): Promise<{ file: PdfReaderFileRecord; lease: PdfReaderLease } | "stale" | null>;
  storePage(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    leaseToken: string;
    page: PdfReaderPageRecord;
    imageBytes: Uint8Array | null;
  }): Promise<"stored" | "stale" | "lease_lost">;
  listPages(accountId: string, bookId: string, fileVersion: number): Promise<PdfReaderPageRecord[]>;
  finalize(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    leaseToken: string;
    pageCount: number;
    state: "ready" | "ready_partial" | "failed";
  }): Promise<"stored" | "stale" | "lease_lost">;
  failFile(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    leaseToken: string;
    errorCode: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | "PDF_LIMIT_EXCEEDED";
  }): Promise<"stored" | "stale" | "lease_lost">;
  listRecoverable(now: number): Promise<PdfReaderFileRecord[]>;
  savePosition(input: {
    accountId: string;
    bookId: string;
    expectedVersion: number;
    locator: PdfLocator;
  }): Promise<{ version: number; locator: PdfLocator } | "stale">;
  saveNote(input: {
    accountId: string;
    bookId: string;
    body: string;
    locator: PdfLocator;
  }): Promise<{ accountId: string; bookId: string; body: string; locator: PdfLocator } | "stale">;
};

type PdfReaderPolicy = {
  limits: { maxFileBytes: number; maxPageCount: number; maxDimensionPx: number; maxPagePixels: number; leaseMs: number };
  buildCacheKey(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    pageNumber: number;
    rendererVersion: string;
    width: number;
    height: number;
  }): string;
  validateRenderRequest(input: { fileBytes: number; pageCount: number; pageNumber: number; width: number; height: number }): void;
  summarizePages(pages: PdfPageOutcome[]): { state: "ready" | "ready_partial" | "failed"; readyPageCount: number; failedPageCount: number; retryablePages: number[] };
};

type PdfReaderSummary = ReturnType<PdfReaderPolicy["summarizePages"]> & {
  fileErrorCode?: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | "PDF_LIMIT_EXCEEDED";
};

export class PdfReaderService {
  constructor(
    private readonly repository: PdfReaderRepository,
    private readonly adapter: PdfReaderAdapterPort,
    private readonly policy: PdfReaderPolicy,
  ) {}

  async processFile(input: {
    accountId: string;
    bookId: string;
    expectedFileVersion: number;
    workerId: string;
    width: number;
    height: number;
    now: number;
  }): Promise<PdfReaderSummary> {
    this.validateRequestedSize(input.width, input.height);
    const acquired = await this.acquire(input);
    if (acquired.file.byteSize < 1 || acquired.file.byteSize > this.policy.limits.maxFileBytes) {
      return this.failClosed({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        leaseToken: acquired.lease.token,
        error: new Error("PDF_LIMIT_EXCEEDED"),
        errorCode: "PDF_LIMIT_EXCEEDED",
      });
    }
    let inspection: { pageCount: number };
    try {
      inspection = await this.adapter.inspect({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        objectKey: acquired.file.objectKey,
        byteSize: acquired.file.byteSize,
      });
    } catch (error) {
      return this.failClosed({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        leaseToken: acquired.lease.token,
        error,
      });
    }
    if (!Number.isSafeInteger(inspection.pageCount) || inspection.pageCount < 1) {
      return this.failClosed({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        leaseToken: acquired.lease.token,
        error: new Error("PDF_LIMIT_EXCEEDED"),
        errorCode: "PDF_LIMIT_EXCEEDED",
      });
    }
    try {
      this.policy.validateRenderRequest({
        fileBytes: acquired.file.byteSize,
        pageCount: inspection.pageCount,
        pageNumber: 1,
        width: input.width,
        height: input.height,
      });
    } catch (error) {
      return this.failClosed({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        leaseToken: acquired.lease.token,
        error,
        errorCode: "PDF_LIMIT_EXCEEDED",
      });
    }
    for (let pageNumber = 1; pageNumber <= inspection.pageCount; pageNumber += 1) {
      await this.renderAndStore({
        ...input,
        pageNumber,
        pageCount: inspection.pageCount,
        file: acquired.file,
        leaseToken: acquired.lease.token,
      });
    }
    return this.finish({
      accountId: input.accountId,
      bookId: input.bookId,
      fileVersion: input.expectedFileVersion,
      pageCount: inspection.pageCount,
      leaseToken: acquired.lease.token,
    });
  }

  async retryPage(input: {
    accountId: string;
    bookId: string;
    expectedFileVersion: number;
    pageNumber: number;
    workerId: string;
    width: number;
    height: number;
    now: number;
  }): Promise<ReturnType<PdfReaderPolicy["summarizePages"]>> {
    this.validateRequestedSize(input.width, input.height);
    const acquired = await this.acquire(input);
    const inspection = acquired.file.pageCount
      ? { pageCount: acquired.file.pageCount }
      : await this.adapter.inspect({
          accountId: input.accountId,
          bookId: input.bookId,
          fileVersion: input.expectedFileVersion,
          objectKey: acquired.file.objectKey,
          byteSize: acquired.file.byteSize,
        });
    await this.renderAndStore({
      ...input,
      pageCount: inspection.pageCount,
      file: acquired.file,
      leaseToken: acquired.lease.token,
    });
    return this.finish({
      accountId: input.accountId,
      bookId: input.bookId,
      fileVersion: input.expectedFileVersion,
      pageCount: inspection.pageCount,
      leaseToken: acquired.lease.token,
    });
  }

  async recoverExpiredLeases(input: { workerId: string; now: number; width: number; height: number }) {
    const recoverable = await this.repository.listRecoverable(input.now);
    const recovered = [];
    for (const file of recoverable) {
      const summary = await this.processFile({
        accountId: file.accountId,
        bookId: file.bookId,
        expectedFileVersion: file.fileVersion,
        workerId: input.workerId,
        width: input.width,
        height: input.height,
        now: input.now,
      });
      recovered.push({
        accountId: file.accountId,
        bookId: file.bookId,
        fileVersion: file.fileVersion,
        state: summary.state,
      });
    }
    return recovered;
  }

  async savePosition(input: { accountId: string; bookId: string; expectedVersion: number; locator: PdfLocator }) {
    const saved = await this.repository.savePosition(input);
    if (saved === "stale") throw new Error("STALE_VERSION");
    return saved;
  }

  async saveNote(input: { accountId: string; bookId: string; body: string; locator: PdfLocator }) {
    try {
      const saved = await this.repository.saveNote(input);
      if (saved === "stale") throw new Error("STALE_VERSION");
      return { status: "saved" as const, note: saved };
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_VERSION") throw error;
      return {
        status: "failed" as const,
        errorCode: "NOTE_SAVE_FAILED" as const,
        retainedDraft: input.body,
        locator: input.locator,
      };
    }
  }

  private async acquire(input: {
    accountId: string;
    bookId: string;
    expectedFileVersion: number;
    workerId: string;
    now: number;
  }) {
    const acquired = await this.repository.acquireLease({
      ...input,
      leaseMs: this.policy.limits.leaseMs,
    });
    if (acquired === "stale") throw new Error("STALE_VERSION");
    if (!acquired) throw new Error("PDF_READER_LEASE_BUSY");
    return acquired;
  }

  private async renderAndStore(input: {
    accountId: string;
    bookId: string;
    expectedFileVersion: number;
    pageNumber: number;
    width: number;
    height: number;
    pageCount: number;
    file: PdfReaderFileRecord;
    leaseToken: string;
  }) {
    this.policy.validateRenderRequest({
      fileBytes: input.file.byteSize,
      pageCount: input.pageCount,
      pageNumber: input.pageNumber,
      width: input.width,
      height: input.height,
    });
    let page: PdfReaderPageRecord;
    let imageBytes: Uint8Array | null = null;
    try {
      const rendered = await this.adapter.renderPage({
        accountId: input.accountId,
        bookId: input.bookId,
        fileVersion: input.expectedFileVersion,
        objectKey: input.file.objectKey,
        pageNumber: input.pageNumber,
        width: input.width,
        height: input.height,
      });
      imageBytes = rendered.imageBytes ?? null;
      page = {
        pageNumber: input.pageNumber,
        state: rendered.state,
        cacheKey: rendered.imageBytes
          ? this.policy.buildCacheKey({
              accountId: input.accountId,
              bookId: input.bookId,
              fileVersion: input.expectedFileVersion,
              pageNumber: input.pageNumber,
              rendererVersion: this.adapter.rendererVersion,
              width: input.width,
              height: input.height,
            })
          : null,
        rendererVersion: this.adapter.rendererVersion,
        width: input.width,
        height: input.height,
        textLayer: rendered.state === "ready_text" ? rendered.textLayer : null,
      };
    } catch (error) {
      const failure = error as { code?: string; retryable?: boolean };
      page = {
        pageNumber: input.pageNumber,
        state: "failed",
        errorCode: failure.code === "PDF_PAGE_UNSUPPORTED" ? "PDF_PAGE_UNSUPPORTED" : "PDF_PAGE_RENDER_FAILED",
        retryable: failure.retryable === true,
        cacheKey: null,
        rendererVersion: this.adapter.rendererVersion,
        width: input.width,
        height: input.height,
        textLayer: null,
      };
    }
    const stored = await this.repository.storePage({
      accountId: input.accountId,
      bookId: input.bookId,
      fileVersion: input.expectedFileVersion,
      leaseToken: input.leaseToken,
      page,
      imageBytes,
    });
    if (stored === "stale") throw new Error("STALE_VERSION");
    if (stored === "lease_lost") throw new Error("PDF_READER_LEASE_LOST");
  }

  private async finish(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    pageCount: number;
    leaseToken: string;
  }) {
    const pages = await this.repository.listPages(input.accountId, input.bookId, input.fileVersion);
    const summary = this.policy.summarizePages(pages);
    const finalized = await this.repository.finalize({ ...input, state: summary.state });
    if (finalized === "stale") throw new Error("STALE_VERSION");
    if (finalized === "lease_lost") throw new Error("PDF_READER_LEASE_LOST");
    return summary;
  }

  private async failClosed(input: {
    accountId: string;
    bookId: string;
    fileVersion: number;
    leaseToken: string;
    error: unknown;
    errorCode?: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | "PDF_LIMIT_EXCEEDED";
  }): Promise<PdfReaderSummary> {
    const rawCode = (input.error as { code?: string }).code;
    const errorCode = input.errorCode ?? (rawCode === "PDF_ENCRYPTED"
      ? "PDF_ENCRYPTED" as const
      : rawCode === "PDF_INVALID"
        ? "PDF_INVALID" as const
        : "PDF_UNSUPPORTED" as const);
    const failed = await this.repository.failFile({ ...input, errorCode });
    if (failed === "stale") throw new Error("STALE_VERSION");
    if (failed === "lease_lost") throw new Error("PDF_READER_LEASE_LOST");
    return {
      state: "failed",
      readyPageCount: 0,
      failedPageCount: 0,
      retryablePages: [],
      fileErrorCode: errorCode,
    };
  }

  private validateRequestedSize(width: number, height: number) {
    this.policy.validateRenderRequest({
      fileBytes: 1,
      pageCount: 1,
      pageNumber: 1,
      width,
      height,
    });
  }
}
