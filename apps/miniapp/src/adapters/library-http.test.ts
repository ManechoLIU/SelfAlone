import { describe, expect, it, vi } from "vitest";
import {
  createLibraryHttpClient,
  createWxLibraryTransport,
  MAX_IMPORT_BYTES,
  type LibraryHttpTransport,
} from "./library-http";

function transport(overrides: Partial<LibraryHttpTransport> = {}): LibraryHttpTransport {
  return {
    request: vi.fn(),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    ...overrides,
  };
}

describe("authenticated library HTTP client", () => {
  it("queries the account-scoped server endpoint and maps its response to BookSummary", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: {
        books: [{
          id: "book-1",
          title: "夜航手记",
          author: null,
          format: "txt",
          sourceLabel: "本地",
          parseStatus: "ready_text",
          errorCode: null,
          sectionCount: 2,
          pageCount: null,
          progress: 0.25,
          createdAt: "2026-08-26T00:00:00.000Z",
        }],
      },
    }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test/",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request }),
    });

    await expect(client.listBooks({ query: "夜航" })).resolves.toEqual([{
      id: "book-1",
      title: "夜航手记",
      author: undefined,
      source: "local",
      sourceLabel: "本地",
      format: "txt",
      progress: 0.25,
      coverVariant: expect.any(Number),
      parseStatus: "ready_text",
      errorCode: undefined,
      sectionCount: 2,
      pageCount: undefined,
      createdAt: "2026-08-26T00:00:00.000Z",
    }]);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      url: "https://api.example.test/api/v1/books?query=%E5%A4%9C%E8%88%AA",
      headers: {
        accept: "application/json",
        authorization: "future-session-bound-header",
      },
    });
  });

  it.each([
    [0, 0],
    [67, 0.67],
    [100, 1],
  ])("maps server progressPercent %s to Mini progress %s", async (progressPercent, progress) => {
    const request = vi.fn(async () => ({
      status: 200,
      data: {
        books: [{ id: `book-${progressPercent}`, title: "进度书", format: "txt", progressPercent }],
      },
    }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request }),
    });

    await expect(client.listBooks()).resolves.toMatchObject([{ progress }]);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY, null])(
    "does not produce an invalid Mini progress value for progressPercent %s",
    async (progressPercent) => {
      const request = vi.fn(async () => ({
        status: 200,
        data: { books: [{ id: "book-invalid-progress", title: "进度书", format: "txt", progressPercent }] },
      }));
      const client = createLibraryHttpClient({
        baseUrl: "https://api.example.test",
        requestHeaders: () => ({ authorization: "future-session-bound-header" }),
        transport: transport({ request }),
      });

      await expect(client.listBooks()).resolves.toMatchObject([{ progress: 0 }]);
    },
  );

  it("maps multiple server records in one GET without a per-book request", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: {
        books: [
          { id: "book-zero", title: "零", format: "txt", progressPercent: 0 },
          { id: "book-middle", title: "中", format: "epub", progressPercent: 67 },
          { id: "book-end", title: "满", format: "pdf", progressPercent: 100 },
        ],
      },
    }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request }),
    });

    await expect(client.listBooks({ query: "" })).resolves.toMatchObject([
      { id: "book-zero", progress: 0 },
      { id: "book-middle", progress: 0.67 },
      { id: "book-end", progress: 1 },
    ]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("never accepts a caller-selected account id as an ownership boundary", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { books: [] } }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request }),
    });

    await client.listBooks({ query: "" });

    const calls = request.mock.calls as unknown as Array<[{ headers: Record<string, string> }]>;
    const input = calls[0]?.[0];
    expect(input.headers).not.toHaveProperty("x-selfalone-account");
    expect(input.headers.authorization).toBe("future-session-bound-header");
  });

  it("rejects account ownership headers instead of allowing a caller-selected account", async () => {
    const request = vi.fn(async () => ({ status: 200, data: { books: [] } }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ "X-SelfAlone-Account": "attacker-selected-account" }),
      transport: transport({ request }),
    });

    await expect(client.listBooks()).rejects.toMatchObject({ code: "CLIENT_ADAPTER_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
  });

  it("uploads raw file bytes with the server import contract and maps processing state", async () => {
    const request = vi.fn(async () => ({
      status: 202,
      data: {
        id: "book-processing",
        title: "山亭",
        author: "作者",
        format: "epub",
        sourceLabel: "本地",
        parseStatus: "processing",
        progressPercent: 67,
        errorCode: null,
        sectionCount: 0,
        pageCount: null,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    }));
    const readFile = vi.fn(async () => new Uint8Array([80, 75, 3, 4]).buffer);
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request, readFile }),
    });

    await expect(client.importBook({ path: "/tmp/山亭.epub", name: "山亭.epub" })).resolves.toMatchObject({
      id: "book-processing",
      title: "山亭",
      parseStatus: "processing",
      progress: 0.67,
      source: "local",
      format: "epub",
    });
    expect(readFile).toHaveBeenCalledWith("/tmp/山亭.epub");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      url: "https://api.example.test/api/v1/books/import",
      headers: {
        accept: "application/json",
        authorization: "future-session-bound-header",
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("山亭.epub"),
      },
      body: new Uint8Array([80, 75, 3, 4]).buffer,
    });
  });

  it("rejects an oversized local file before upload", async () => {
    const request = vi.fn(async () => ({ status: 202, data: {} }));
    const readFile = vi.fn(async () => new ArrayBuffer(MAX_IMPORT_BYTES + 1));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request, readFile }),
    });

    await expect(client.importBook({ path: "/tmp/too-large.epub", name: "too-large.epub" }))
      .rejects.toMatchObject({ code: "BOOK_FILE_TOO_LARGE" });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses wx.request for JSON and the filesystem manager for ArrayBuffer imports", async () => {
    const wxRequests: Array<{ url: string; method?: string; header?: Record<string, string>; data?: unknown }> = [];
    const fileBytes = new Uint8Array([9, 8, 7]).buffer;
    const wxRequest = vi.fn((input: {
      url: string;
      method?: string;
      header?: Record<string, string>;
      data?: unknown;
      success?: (response: { statusCode: number; data: unknown }) => void;
    }) => {
      wxRequests.push({
        url: input.url,
        method: input.method,
        header: input.header,
        ...(input.data === undefined ? {} : { data: input.data }),
      });
      input.success?.({ statusCode: 200, data: { books: [] } });
    });
    const readFile = vi.fn((input: {
      filePath: string;
      success?: (result: { data: ArrayBuffer }) => void;
      fail?: () => void;
    }) => input.success?.({ data: fileBytes }));
    vi.stubGlobal("wx", {
      request: wxRequest,
      getFileSystemManager: () => ({ readFile }),
    });

    try {
      const transport = createWxLibraryTransport();
      await expect(transport.request({
        method: "GET",
        url: "https://api.example.test/api/v1/books?query=",
        headers: { accept: "application/json", Authorization: "Bearer token" },
      })).resolves.toEqual({ status: 200, data: { books: [] } });
      await expect(transport.readFile("/tmp/book.epub")).resolves.toBe(fileBytes);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/tmp/book.epub" }));
    expect(wxRequests).toEqual([{
      url: "https://api.example.test/api/v1/books?query=",
      method: "GET",
      header: { accept: "application/json", Authorization: "Bearer token" },
    }]);
  });

  it("fails closed for non-success responses and malformed payloads", async () => {
    const request = vi.fn(async () => ({ status: 503, data: { code: "NOT_READY" } }));
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({ request }),
    });
    await expect(client.listBooks()).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });

    const malformed = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      requestHeaders: () => ({ authorization: "future-session-bound-header" }),
      transport: transport({
        request: vi.fn(async () => ({ status: 200, data: { books: [{ title: "missing id" }] } })),
      }),
    });
    await expect(malformed.listBooks()).rejects.toMatchObject({ code: "INVALID_LIBRARY_RESPONSE" });
  });
});
