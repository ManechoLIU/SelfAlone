import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PdfReaderService,
  type PdfReaderFileRecord,
  type PdfReaderPageRecord,
  type PdfReaderRepository,
} from "./pdf-reader-runtime";

const domainModulePath = "../../../packages/domain/src/" + "pdf-reader.ts";
const {
  PDF_READER_LIMITS,
  buildPdfPageCacheKey,
  summarizePdfPages,
  validatePdfRenderRequest,
} = await import(domainModulePath);

const fixtureRoot = resolve("redesign-v2/output/acceptance/m1-f2-c/fixtures");

function key(input: { accountId: string; bookId: string }) {
  return `${input.accountId}\u0000${input.bookId}`;
}

class FakePdfReaderRepository implements PdfReaderRepository {
  readonly files = new Map<string, PdfReaderFileRecord>();
  readonly pages = new Map<string, PdfReaderPageRecord>();
  readonly cacheArtifacts = new Map<string, Uint8Array>();
  readonly positions = new Map<string, { version: number; locator: { kind: "pdf"; fileVersion: number; pageNumber: number } }>();
  readonly notes: Array<{ accountId: string; bookId: string; body: string; locator: { kind: "pdf"; fileVersion: number; pageNumber: number } }> = [];
  failNextNoteSave = false;
  private leaseSequence = 0;
  private readonly leaseResumeStates = new Map<string, PdfReaderFileRecord["status"]>();

  addFile(file: Omit<PdfReaderFileRecord, "status" | "pageCount" | "lease"> & Partial<Pick<PdfReaderFileRecord, "status" | "pageCount" | "lease">>) {
    this.files.set(key(file), {
      ...file,
      status: file.status ?? "pending",
      pageCount: file.pageCount ?? null,
      lease: file.lease ?? null,
    });
  }

  async getFile(accountId: string, bookId: string) {
    return this.files.get(key({ accountId, bookId })) ?? null;
  }

  async acquireLease(input: { accountId: string; bookId: string; expectedFileVersion: number; workerId: string; now: number; leaseMs: number }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.expectedFileVersion) return "stale" as const;
    if (file.lease && file.lease.expiresAt > input.now) return null;
    const lease = { token: `lease-${++this.leaseSequence}`, owner: input.workerId, expiresAt: input.now + input.leaseMs };
    this.leaseResumeStates.set(lease.token, file.status === "processing" ? "pending" : file.status);
    file.status = "processing";
    file.lease = lease;
    return { file: { ...file, lease }, lease };
  }

  async releaseLease(input: { accountId: string; bookId: string; fileVersion: number; leaseToken: string }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.fileVersion) return "stale" as const;
    if (file.lease?.token !== input.leaseToken) return "lease_lost" as const;
    file.status = this.leaseResumeStates.get(input.leaseToken) ?? "pending";
    file.lease = null;
    this.leaseResumeStates.delete(input.leaseToken);
    return "stored" as const;
  }

  async storePage(input: { accountId: string; bookId: string; fileVersion: number; leaseToken: string; page: PdfReaderPageRecord; imageBytes: Uint8Array | null }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.fileVersion) return "stale" as const;
    if (file.lease?.token !== input.leaseToken) return "lease_lost" as const;
    this.pages.set(`${key(input)}\u0000${input.fileVersion}\u0000${input.page.pageNumber}`, input.page);
    if (input.page.cacheKey && input.imageBytes) this.cacheArtifacts.set(input.page.cacheKey, input.imageBytes);
    return "stored" as const;
  }

  async listPages(accountId: string, bookId: string, fileVersion: number) {
    const prefix = `${key({ accountId, bookId })}\u0000${fileVersion}\u0000`;
    return [...this.pages.entries()].filter(([pageKey]) => pageKey.startsWith(prefix)).map(([, page]) => page).sort((a, b) => a.pageNumber - b.pageNumber);
  }

  async finalize(input: { accountId: string; bookId: string; fileVersion: number; leaseToken: string; pageCount: number; state: "ready" | "ready_partial" | "failed" }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.fileVersion) return "stale" as const;
    if (file.lease?.token !== input.leaseToken) return "lease_lost" as const;
    file.pageCount = input.pageCount;
    file.status = input.state;
    file.lease = null;
    return "stored" as const;
  }

  async failFile(input: { accountId: string; bookId: string; fileVersion: number; leaseToken: string; errorCode: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | "PDF_LIMIT_EXCEEDED" }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.fileVersion) return "stale" as const;
    if (file.lease?.token !== input.leaseToken) return "lease_lost" as const;
    file.status = "failed";
    file.pageCount = null;
    file.lease = null;
    (file as PdfReaderFileRecord & { errorCode: string }).errorCode = input.errorCode;
    return "stored" as const;
  }

  async listRecoverable(now: number) {
    return [...this.files.values()].filter((file) => file.status === "pending" || (file.status === "processing" && (!file.lease || file.lease.expiresAt <= now)));
  }

  async savePosition(input: { accountId: string; bookId: string; expectedVersion: number; locator: { kind: "pdf"; fileVersion: number; pageNumber: number } }) {
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.locator.fileVersion) return "stale" as const;
    const positionKey = key(input);
    const current = this.positions.get(positionKey);
    if ((current?.version ?? 0) !== input.expectedVersion) return "stale" as const;
    const saved = { version: input.expectedVersion + 1, locator: input.locator };
    this.positions.set(positionKey, saved);
    return saved;
  }

  async saveNote(input: { accountId: string; bookId: string; body: string; locator: { kind: "pdf"; fileVersion: number; pageNumber: number } }) {
    if (this.failNextNoteSave) {
      this.failNextNoteSave = false;
      throw new Error("database unavailable");
    }
    const file = this.files.get(key(input));
    if (!file || file.fileVersion !== input.locator.fileVersion) return "stale" as const;
    const note = { ...input };
    this.notes.push(note);
    return note;
  }

  replaceFileVersion(accountId: string, bookId: string, fileVersion: number) {
    const file = this.files.get(key({ accountId, bookId }));
    if (!file) throw new Error("missing file");
    file.fileVersion = fileVersion;
    file.status = "pending";
    file.pageCount = null;
    file.lease = null;
  }
}

class ExplicitFakePdfReaderAdapter {
  readonly rendererVersion = "explicit-fake@1";
  failPages = new Set<number>();
  pageCount = 3;
  beforeFirstPage: (() => Promise<void>) | null = null;
  inspectError: "PDF_ENCRYPTED" | "PDF_INVALID" | "PDF_UNSUPPORTED" | null = null;
  inspectFailure: Error | null = null;
  inspectCalls = 0;

  async inspect() {
    this.inspectCalls += 1;
    if (this.inspectFailure) throw this.inspectFailure;
    if (this.inspectError) throw Object.assign(new Error(this.inspectError), { code: this.inspectError });
    return { pageCount: this.pageCount };
  }

  async renderPage(input: { pageNumber: number }) {
    if (input.pageNumber === 1 && this.beforeFirstPage) await this.beforeFirstPage();
    if (this.failPages.has(input.pageNumber)) {
      throw Object.assign(new Error("fake page failure"), { code: "PDF_PAGE_RENDER_FAILED", retryable: true });
    }
    return input.pageNumber === 1
      ? { state: "ready_text" as const, textLayer: `fixture text page ${input.pageNumber}`, imageBytes: new Uint8Array([input.pageNumber]) }
      : { state: "ready_image" as const, imageBytes: new Uint8Array([input.pageNumber]) };
  }
}

function service(
  repository: FakePdfReaderRepository,
  adapter: ExplicitFakePdfReaderAdapter,
  validateRenderRequest = validatePdfRenderRequest,
) {
  return new PdfReaderService(repository, adapter, {
    limits: PDF_READER_LIMITS,
    buildCacheKey: buildPdfPageCacheKey,
    validateRenderRequest,
    summarizePages: summarizePdfPages,
  });
}

async function addFixtureFile(repository: FakePdfReaderRepository, accountId: string, bookId: string) {
  const objectKey = resolve(fixtureRoot, "multi-page-text.pdf");
  const bytes = await readFile(objectKey);
  repository.addFile({ accountId, bookId, fileVersion: 1, objectKey, byteSize: bytes.length });
}

describe("PDF reader service with explicit fake adapter", () => {
  it("isolates accounts and cache keys, keeps one failed page readable, then retries only that page", async () => {
    const repository = new FakePdfReaderRepository();
    await addFixtureFile(repository, "account-a", "shared-book-id");
    await addFixtureFile(repository, "account-b", "shared-book-id");
    const adapter = new ExplicitFakePdfReaderAdapter();
    adapter.failPages.add(2);
    const runtime = service(repository, adapter);

    const partial = await runtime.processFile({ accountId: "account-a", bookId: "shared-book-id", expectedFileVersion: 1, workerId: "worker-a", width: 1200, height: 1600, now: 1_000 });
    expect(partial).toMatchObject({ state: "ready_partial", readyPageCount: 2, failedPageCount: 1, retryablePages: [2] });
    expect(repository.files.get(key({ accountId: "account-a", bookId: "shared-book-id" }))).toMatchObject({ status: "ready_partial", lease: null });

    const failedRetry = await runtime.retryPage({ accountId: "account-a", bookId: "shared-book-id", expectedFileVersion: 1, pageNumber: 2, workerId: "worker-retry-failure", width: 1200, height: 1600, now: 1_500 });
    expect(failedRetry).toMatchObject({ state: "ready_partial", failedPageCount: 1, retryablePages: [2] });
    expect(repository.files.get(key({ accountId: "account-a", bookId: "shared-book-id" }))).toMatchObject({ status: "ready_partial", lease: null });

    adapter.failPages.clear();
    const other = await runtime.processFile({ accountId: "account-b", bookId: "shared-book-id", expectedFileVersion: 1, workerId: "worker-b", width: 1200, height: 1600, now: 2_000 });
    expect(other.state).toBe("ready");
    const accountAPage = (await repository.listPages("account-a", "shared-book-id", 1))[0];
    const accountBPage = (await repository.listPages("account-b", "shared-book-id", 1))[0];
    expect(accountAPage?.cacheKey).not.toBe(accountBPage?.cacheKey);
    expect(repository.cacheArtifacts.get(accountAPage?.cacheKey ?? "")).toEqual(new Uint8Array([1]));
    expect(repository.cacheArtifacts.get(accountBPage?.cacheKey ?? "")).toEqual(new Uint8Array([1]));

    const retried = await runtime.retryPage({ accountId: "account-a", bookId: "shared-book-id", expectedFileVersion: 1, pageNumber: 2, workerId: "worker-retry", width: 1200, height: 1600, now: 3_000 });
    expect(retried).toMatchObject({ state: "ready", readyPageCount: 3, failedPageCount: 0 });
    expect(repository.files.get(key({ accountId: "account-a", bookId: "shared-book-id" }))).toMatchObject({ status: "ready", lease: null });
  });

  it("releases a retry lease and rethrows the original inspect error", async () => {
    const repository = new FakePdfReaderRepository();
    const objectKey = resolve(fixtureRoot, "multi-page-text.pdf");
    repository.addFile({
      accountId: "account-a",
      bookId: "inspect-retry",
      fileVersion: 1,
      objectKey,
      byteSize: (await readFile(objectKey)).length,
      status: "ready_partial",
      pageCount: null,
    });
    const adapter = new ExplicitFakePdfReaderAdapter();
    const originalError = new Error("inspect exploded");
    adapter.inspectFailure = originalError;
    const runtime = service(repository, adapter);

    await expect(runtime.retryPage({ accountId: "account-a", bookId: "inspect-retry", expectedFileVersion: 1, pageNumber: 1, workerId: "retry-worker", width: 1200, height: 1600, now: 1_000 })).rejects.toBe(originalError);
    expect(repository.files.get(key({ accountId: "account-a", bookId: "inspect-retry" }))).toMatchObject({ status: "ready_partial", lease: null });

    adapter.inspectFailure = null;
    adapter.pageCount = 1;
    await expect(runtime.retryPage({ accountId: "account-a", bookId: "inspect-retry", expectedFileVersion: 1, pageNumber: 1, workerId: "next-worker", width: 1200, height: 1600, now: 1_001 })).resolves.toMatchObject({ state: "ready" });
  });

  it("releases a retry lease after page or render precondition validation errors", async () => {
    const repository = new FakePdfReaderRepository();
    const objectKey = resolve(fixtureRoot, "multi-page-text.pdf");
    repository.addFile({
      accountId: "account-a",
      bookId: "validation-retry",
      fileVersion: 1,
      objectKey,
      byteSize: (await readFile(objectKey)).length,
      status: "ready_partial",
      pageCount: 3,
    });
    const adapter = new ExplicitFakePdfReaderAdapter();
    const runtime = service(repository, adapter);

    await expect(runtime.retryPage({ accountId: "account-a", bookId: "validation-retry", expectedFileVersion: 1, pageNumber: 4, workerId: "page-worker", width: 1200, height: 1600, now: 2_000 })).rejects.toMatchObject({ code: "PDF_PAGE_OUT_OF_RANGE" });
    expect(repository.files.get(key({ accountId: "account-a", bookId: "validation-retry" }))).toMatchObject({ status: "ready_partial", lease: null });

    const renderPreconditionError = new Error("render precondition exploded");
    const preconditionRuntime = service(repository, adapter, (input: {
      fileBytes: number;
      pageCount: number;
      pageNumber: number;
      width: number;
      height: number;
    }) => {
      validatePdfRenderRequest(input);
      if (input.fileBytes > 1 && input.pageNumber === 2) throw renderPreconditionError;
    });
    await expect(preconditionRuntime.retryPage({ accountId: "account-a", bookId: "validation-retry", expectedFileVersion: 1, pageNumber: 2, workerId: "precondition-worker", width: 1200, height: 1600, now: 2_001 })).rejects.toBe(renderPreconditionError);
    expect(repository.files.get(key({ accountId: "account-a", bookId: "validation-retry" }))).toMatchObject({ status: "ready_partial", lease: null });
  });

  it("recovers an expired persisted lease after a service restart but leaves a live lease alone", async () => {
    const repository = new FakePdfReaderRepository();
    await addFixtureFile(repository, "account-a", "expired");
    await addFixtureFile(repository, "account-a", "live");
    repository.files.get(key({ accountId: "account-a", bookId: "expired" }))!.status = "processing";
    repository.files.get(key({ accountId: "account-a", bookId: "expired" }))!.lease = { token: "old", owner: "dead-worker", expiresAt: 999 };
    repository.files.get(key({ accountId: "account-a", bookId: "live" }))!.status = "processing";
    repository.files.get(key({ accountId: "account-a", bookId: "live" }))!.lease = { token: "live", owner: "live-worker", expiresAt: 9_999 };

    const restarted = service(repository, new ExplicitFakePdfReaderAdapter());
    expect(await restarted.recoverExpiredLeases({ workerId: "restarted-worker", now: 1_000, width: 1000, height: 1400 })).toEqual([
      { accountId: "account-a", bookId: "expired", fileVersion: 1, state: "ready" },
    ]);
    expect(repository.files.get(key({ accountId: "account-a", bookId: "live" }))?.lease?.token).toBe("live");
  });

  it("fails closed for encrypted or damaged files and marks a file failed when every page is unrenderable", async () => {
    const repository = new FakePdfReaderRepository();
    const encryptedPath = resolve(fixtureRoot, "encrypted-password-protected.pdf");
    const encryptedBytes = await readFile(encryptedPath);
    repository.addFile({ accountId: "account-a", bookId: "encrypted", fileVersion: 1, objectKey: encryptedPath, byteSize: encryptedBytes.length });
    const encryptedAdapter = new ExplicitFakePdfReaderAdapter();
    encryptedAdapter.inspectError = "PDF_ENCRYPTED";
    await expect(service(repository, encryptedAdapter).processFile({ accountId: "account-a", bookId: "encrypted", expectedFileVersion: 1, workerId: "worker", width: 1200, height: 1600, now: 1_000 })).resolves.toEqual({ state: "failed", readyPageCount: 0, failedPageCount: 0, retryablePages: [], fileErrorCode: "PDF_ENCRYPTED" });
    expect(repository.files.get(key({ accountId: "account-a", bookId: "encrypted" }))).toMatchObject({ status: "failed", lease: null, errorCode: "PDF_ENCRYPTED" });

    await addFixtureFile(repository, "account-a", "all-pages-fail");
    const pageFailureAdapter = new ExplicitFakePdfReaderAdapter();
    pageFailureAdapter.failPages = new Set([1, 2, 3]);
    await expect(service(repository, pageFailureAdapter).processFile({ accountId: "account-a", bookId: "all-pages-fail", expectedFileVersion: 1, workerId: "worker", width: 1200, height: 1600, now: 2_000 })).resolves.toMatchObject({ state: "failed", readyPageCount: 0, failedPageCount: 3, retryablePages: [1, 2, 3] });
  });

  it("rejects unsafe file and page-count limits before rendering and releases the lease", async () => {
    const repository = new FakePdfReaderRepository();
    repository.addFile({ accountId: "account-a", bookId: "too-large", fileVersion: 1, objectKey: "unused", byteSize: PDF_READER_LIMITS.maxFileBytes + 1 });
    const fileAdapter = new ExplicitFakePdfReaderAdapter();
    await expect(service(repository, fileAdapter).processFile({ accountId: "account-a", bookId: "too-large", expectedFileVersion: 1, workerId: "worker", width: 1200, height: 1600, now: 1_000 })).resolves.toMatchObject({ state: "failed", fileErrorCode: "PDF_LIMIT_EXCEEDED" });
    expect(fileAdapter.inspectCalls).toBe(0);
    expect(repository.files.get(key({ accountId: "account-a", bookId: "too-large" }))).toMatchObject({ status: "failed", lease: null, errorCode: "PDF_LIMIT_EXCEEDED" });

    repository.addFile({ accountId: "account-a", bookId: "too-many-pages", fileVersion: 1, objectKey: "unused", byteSize: 1024 });
    const pageAdapter = new ExplicitFakePdfReaderAdapter();
    pageAdapter.pageCount = PDF_READER_LIMITS.maxPageCount + 1;
    await expect(service(repository, pageAdapter).processFile({ accountId: "account-a", bookId: "too-many-pages", expectedFileVersion: 1, workerId: "worker", width: 1200, height: 1600, now: 2_000 })).resolves.toMatchObject({ state: "failed", fileErrorCode: "PDF_LIMIT_EXCEEDED" });
    expect(repository.pages.size).toBe(0);
  });

  it("rejects a late page result after book_files.version changes", async () => {
    const repository = new FakePdfReaderRepository();
    await addFixtureFile(repository, "account-a", "versioned");
    const adapter = new ExplicitFakePdfReaderAdapter();
    let release!: () => void;
    adapter.beforeFirstPage = () => new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const processing = service(repository, adapter).processFile({ accountId: "account-a", bookId: "versioned", expectedFileVersion: 1, workerId: "old-worker", width: 1200, height: 1600, now: 1_000 });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    repository.replaceFileVersion("account-a", "versioned", 2);
    release();

    await expect(processing).rejects.toThrow("STALE_VERSION");
    expect(await repository.listPages("account-a", "versioned", 2)).toEqual([]);
  });

  it("uses page anchors for positions and retains a note draft when persistence fails", async () => {
    const repository = new FakePdfReaderRepository();
    await addFixtureFile(repository, "account-a", "notes");
    await addFixtureFile(repository, "account-b", "notes");
    const runtime = service(repository, new ExplicitFakePdfReaderAdapter());

    await expect(runtime.savePosition({ accountId: "account-a", bookId: "notes", expectedVersion: 0, locator: { kind: "pdf", fileVersion: 1, pageNumber: 2 } })).resolves.toEqual({ version: 1, locator: { kind: "pdf", fileVersion: 1, pageNumber: 2 } });
    await expect(runtime.savePosition({ accountId: "account-b", bookId: "notes", expectedVersion: 0, locator: { kind: "pdf", fileVersion: 1, pageNumber: 3 } })).resolves.toMatchObject({ version: 1 });
    await expect(runtime.savePosition({ accountId: "account-a", bookId: "notes", expectedVersion: 0, locator: { kind: "pdf", fileVersion: 1, pageNumber: 1 } })).rejects.toThrow("STALE_VERSION");

    repository.failNextNoteSave = true;
    await expect(runtime.saveNote({ accountId: "account-a", bookId: "notes", body: "未保存但不能丢失", locator: { kind: "pdf", fileVersion: 1, pageNumber: 2 } })).resolves.toEqual({ status: "failed", errorCode: "NOTE_SAVE_FAILED", retainedDraft: "未保存但不能丢失", locator: { kind: "pdf", fileVersion: 1, pageNumber: 2 } });
    await expect(runtime.saveNote({ accountId: "account-a", bookId: "notes", body: "保存成功", locator: { kind: "pdf", fileVersion: 1, pageNumber: 3 } })).resolves.toMatchObject({ status: "saved", note: { body: "保存成功", locator: { kind: "pdf", fileVersion: 1, pageNumber: 3 } } });
  });
});
