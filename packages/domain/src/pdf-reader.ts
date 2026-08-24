export const PDF_READER_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPageCount: 2_000,
  maxDimensionPx: 4_096,
  maxPagePixels: 12_000_000,
  leaseMs: 30_000,
} as const;

export type PdfReaderErrorCode =
  | "PDF_FILE_TOO_LARGE"
  | "PDF_PAGE_COUNT_LIMIT"
  | "PDF_PAGE_OUT_OF_RANGE"
  | "PDF_RENDER_DIMENSION_LIMIT"
  | "PDF_RENDER_PIXEL_LIMIT"
  | "STALE_VERSION";

export type PdfReaderFileState = "pending" | "processing" | "ready" | "ready_partial" | "failed";
export type PdfReaderPageState = "pending" | "processing" | "ready_text" | "ready_image" | "failed";
export type PdfReaderFileFailureCode =
  | "PDF_ENCRYPTED"
  | "PDF_INVALID"
  | "PDF_UNSUPPORTED"
  | "PDF_LIMIT_EXCEEDED";

export class PdfReaderDomainError extends Error {
  constructor(readonly code: PdfReaderErrorCode) {
    super(code);
    this.name = "PdfReaderDomainError";
  }
}

export function validatePdfRenderRequest(_input: {
  fileBytes: number;
  pageCount: number;
  pageNumber: number;
  width: number;
  height: number;
}) {
  const input = _input;
  if (!Number.isSafeInteger(input.fileBytes) || input.fileBytes < 1) {
    throw new PdfReaderDomainError("PDF_FILE_TOO_LARGE");
  }
  if (input.fileBytes > PDF_READER_LIMITS.maxFileBytes) {
    throw new PdfReaderDomainError("PDF_FILE_TOO_LARGE");
  }
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount < 1) {
    throw new PdfReaderDomainError("PDF_PAGE_COUNT_LIMIT");
  }
  if (input.pageCount > PDF_READER_LIMITS.maxPageCount) {
    throw new PdfReaderDomainError("PDF_PAGE_COUNT_LIMIT");
  }
  if (
    !Number.isSafeInteger(input.pageNumber)
    || input.pageNumber < 1
    || input.pageNumber > input.pageCount
  ) {
    throw new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE");
  }
  if (
    !Number.isSafeInteger(input.width)
    || !Number.isSafeInteger(input.height)
    || input.width < 1
    || input.height < 1
    || input.width > PDF_READER_LIMITS.maxDimensionPx
    || input.height > PDF_READER_LIMITS.maxDimensionPx
  ) {
    throw new PdfReaderDomainError("PDF_RENDER_DIMENSION_LIMIT");
  }
  if (input.width * input.height > PDF_READER_LIMITS.maxPagePixels) {
    throw new PdfReaderDomainError("PDF_RENDER_PIXEL_LIMIT");
  }
}

export function buildPdfPageCacheKey(_input: {
  accountId: string;
  bookId: string;
  fileVersion: number;
  pageNumber: number;
  rendererVersion: string;
  width: number;
  height: number;
}) {
  const input = _input;
  if (!input.accountId || !input.bookId || !input.rendererVersion) {
    throw new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE");
  }
  if (
    !Number.isSafeInteger(input.fileVersion)
    || input.fileVersion < 1
    || !Number.isSafeInteger(input.pageNumber)
    || input.pageNumber < 1
  ) {
    throw new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE");
  }
  return [
    encodeURIComponent(input.accountId),
    encodeURIComponent(input.bookId),
    "pdf",
    `v${input.fileVersion}`,
    `page-${input.pageNumber}`,
    encodeURIComponent(input.rendererVersion),
    `${input.width}x${input.height}.png`,
  ].join("/");
}

export function createPdfLocator(input: { fileVersion: number; pageNumber: number }) {
  if (
    !Number.isSafeInteger(input.fileVersion)
    || input.fileVersion < 1
    || !Number.isSafeInteger(input.pageNumber)
    || input.pageNumber < 1
  ) {
    throw new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE");
  }
  return { kind: "pdf" as const, ...input };
}

export function assertCurrentFileVersion(expectedVersion: number, currentVersion: number) {
  if (expectedVersion !== currentVersion) throw new PdfReaderDomainError("STALE_VERSION");
}

export type PdfPageOutcome =
  | { pageNumber: number; state: "ready_text" | "ready_image" }
  | {
      pageNumber: number;
      state: "failed";
      errorCode: "PDF_PAGE_RENDER_FAILED" | "PDF_PAGE_UNSUPPORTED";
      retryable: boolean;
    };

export type PdfReaderAdapter = {
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

export function summarizePdfPages(_pages: PdfPageOutcome[]) {
  const readyPageCount = _pages.filter((page) => page.state !== "failed").length;
  const failedPages = _pages.filter(
    (page): page is Extract<PdfPageOutcome, { state: "failed" }> => page.state === "failed",
  );
  return {
    state: readyPageCount === 0 ? "failed" as const : failedPages.length > 0 ? "ready_partial" as const : "ready" as const,
    readyPageCount,
    failedPageCount: failedPages.length,
    retryablePages: failedPages.filter((page) => page.retryable).map((page) => page.pageNumber),
  };
}
