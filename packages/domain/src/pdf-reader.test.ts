import { describe, expect, it } from "vitest";
import {
  PDF_READER_LIMITS,
  PdfReaderDomainError,
  assertCurrentFileVersion,
  buildPdfPageCacheKey,
  createPdfLocator,
  summarizePdfPages,
  validatePdfRenderRequest,
} from "./pdf-reader";

describe("PDF reader domain boundary", () => {
  it("rejects files, page counts and render dimensions outside the frozen safety envelope", () => {
    expect(() =>
      validatePdfRenderRequest({
        fileBytes: PDF_READER_LIMITS.maxFileBytes + 1,
        pageCount: 1,
        pageNumber: 1,
        width: 100,
        height: 100,
      }),
    ).toThrowError(new PdfReaderDomainError("PDF_FILE_TOO_LARGE"));
    expect(() =>
      validatePdfRenderRequest({
        fileBytes: 1024,
        pageCount: PDF_READER_LIMITS.maxPageCount + 1,
        pageNumber: 1,
        width: 100,
        height: 100,
      }),
    ).toThrowError(new PdfReaderDomainError("PDF_PAGE_COUNT_LIMIT"));
    expect(() =>
      validatePdfRenderRequest({
        fileBytes: 1024,
        pageCount: 3,
        pageNumber: 4,
        width: 100,
        height: 100,
      }),
    ).toThrowError(new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE"));
    expect(() =>
      validatePdfRenderRequest({
        fileBytes: 1024,
        pageCount: 1,
        pageNumber: 1,
        width: PDF_READER_LIMITS.maxDimensionPx + 1,
        height: 100,
      }),
    ).toThrowError(new PdfReaderDomainError("PDF_RENDER_DIMENSION_LIMIT"));
    expect(() =>
      validatePdfRenderRequest({
        fileBytes: 1024,
        pageCount: 1,
        pageNumber: 1,
        width: 4096,
        height: 4096,
      }),
    ).toThrowError(new PdfReaderDomainError("PDF_RENDER_PIXEL_LIMIT"));
  });

  it("names cache entries by owner, book, file version, page, renderer and exact size", () => {
    expect(
      buildPdfPageCacheKey({
        accountId: "account/a",
        bookId: "book 1",
        fileVersion: 7,
        pageNumber: 3,
        rendererVersion: "pdf.js@5.7.284",
        width: 1200,
        height: 1698,
      }),
    ).toBe(
      "account%2Fa/book%201/pdf/v7/page-3/pdf.js%405.7.284/1200x1698.png",
    );
  });

  it("keeps PDF anchors page-based and rejects zero-based or stale locators", () => {
    expect(createPdfLocator({ fileVersion: 4, pageNumber: 2 })).toEqual({
      kind: "pdf",
      fileVersion: 4,
      pageNumber: 2,
    });
    expect(() => createPdfLocator({ fileVersion: 4, pageNumber: 0 })).toThrowError(
      new PdfReaderDomainError("PDF_PAGE_OUT_OF_RANGE"),
    );
    expect(() => assertCurrentFileVersion(3, 4)).toThrowError(
      new PdfReaderDomainError("STALE_VERSION"),
    );
  });

  it("keeps a file partially readable after one page fails and fails only when every page fails", () => {
    expect(
      summarizePdfPages([
        { pageNumber: 1, state: "ready_text" },
        { pageNumber: 2, state: "failed", errorCode: "PDF_PAGE_RENDER_FAILED", retryable: true },
        { pageNumber: 3, state: "ready_image" },
      ]),
    ).toEqual({ state: "ready_partial", readyPageCount: 2, failedPageCount: 1, retryablePages: [2] });

    expect(
      summarizePdfPages([
        { pageNumber: 1, state: "failed", errorCode: "PDF_PAGE_RENDER_FAILED", retryable: true },
        { pageNumber: 2, state: "failed", errorCode: "PDF_PAGE_UNSUPPORTED", retryable: false },
      ]),
    ).toEqual({ state: "failed", readyPageCount: 0, failedPageCount: 2, retryablePages: [1] });
  });
});
