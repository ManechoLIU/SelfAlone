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
  it("loads text reading and sections into the Mini reader shape", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          bookId: "book-1",
          title: "雨后山亭",
          author: "林野",
          contentMode: "text",
          fileVersion: 2,
          position: {
            locator: { kind: "text", fileVersion: 2, sectionId: "epub:two", offset: 3 },
            background: "dark",
            version: 4,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          fileVersion: 2,
          sections: [
            { sectionId: "epub:one", title: "雨停以后", order: 0, text: "第一段。" },
            { sectionId: "epub:two", title: "山路尽头", order: 1, text: "亭中有一盏茶。" },
          ],
        },
      });
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test/",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request }),
    });

    await expect(client.getBook("book-1")).resolves.toMatchObject({
      book: {
        id: "book-1",
        title: "雨后山亭",
        author: "林野",
        source: "local",
        sourceLabel: "本地",
        format: "epub",
        progress: expect.any(Number),
        sectionCount: 2,
        parseStatus: "ready_text",
      },
      introduction: "",
      sections: [
        { id: "epub:one", index: 0, title: "雨停以后", body: "第一段。", locator: "epub:one" },
        { id: "epub:two", index: 1, title: "山路尽头", body: "亭中有一盏茶。", locator: "epub:two" },
      ],
      position: {
        sectionId: "epub:two",
        offset: 3,
        background: "dark",
        version: 4,
        progress: expect.any(Number),
      },
      highlights: [],
      notes: [],
      works: [],
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      method: "GET",
      url: "https://api.example.test/api/v1/books/book-1/reading",
      headers: {
        Authorization: "Bearer opaque-reader-token-1234567890",
        accept: "application/json",
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "GET",
      url: "https://api.example.test/api/v1/books/book-1/content/sections",
      headers: {
        Authorization: "Bearer opaque-reader-token-1234567890",
        accept: "application/json",
      },
    });
  });

  it("saves a Mini reading position with the loaded file version and maps the nested response", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          bookId: "book-1",
          title: "雨后山亭",
          author: "林野",
          contentMode: "text",
          fileVersion: 2,
          position: null,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          fileVersion: 2,
          sections: [{ sectionId: "txt:one", title: "第一章", order: 0, text: "一段正文。" }],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 3 },
          background: "dark",
          version: 1,
        },
      });
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request }),
    });

    await client.getBook("book-1");
    await expect(client.savePosition("book-1", {
      sectionId: "txt:one",
      offset: 3,
      progress: 0.5,
      background: "dark",
      expectedVersion: 0,
    })).resolves.toMatchObject({
      sectionId: "txt:one",
      offset: 3,
      background: "dark",
      version: 1,
      progress: expect.any(Number),
    });
    expect(request).toHaveBeenNthCalledWith(3, {
      method: "PUT",
      url: "https://api.example.test/api/v1/books/book-1/position",
      headers: {
        Authorization: "Bearer opaque-reader-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 3 },
        background: "dark",
      },
    });
  });

  it("round-trips UTF-16 code-unit offsets between source text and trimmed display text", async () => {
    // Server locators are UTF-16 code-unit offsets into the source section.text,
    // while the Mini reader builds blocks from body.trim() starting at offset 0.
    const sourceText = "\n\n😀正文\n";
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          bookId: "book-1",
          title: "雨后山亭",
          author: null,
          contentMode: "text",
          fileVersion: 2,
          position: {
            locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 4 },
            background: "light",
            version: 4,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          fileVersion: 2,
          sections: [{ sectionId: "txt:one", title: "第一章", order: 0, text: sourceText }],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 2 },
          background: "light",
          version: 5,
        },
      });
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request }),
    });

    // Source offset 4 (two newlines + one non-BMP emoji = 4 UTF-16 code units)
    // must hydrate to display offset 2 in trimmed text "😀正文", not 4 and not 1.
    const detail = await client.getBook("book-1");
    expect(detail.position).toMatchObject({ sectionId: "txt:one", offset: 2 });

    // Saving from the first visible character (display offset 0) must map back
    // to source offset 2 in UTF-16 code units.
    await expect(client.savePosition("book-1", {
      sectionId: "txt:one",
      offset: 0,
      progress: 0,
      background: "light",
      expectedVersion: 4,
    })).resolves.toMatchObject({ sectionId: "txt:one", offset: 0, version: 5 });
    expect(request).toHaveBeenNthCalledWith(3, {
      method: "PUT",
      url: "https://api.example.test/api/v1/books/book-1/position",
      headers: {
        Authorization: "Bearer opaque-reader-token-1234567890",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: {
        expectedVersion: 4,
        locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 2 },
        background: "light",
      },
    });
  });

  it("clamps hydrated offsets that land inside trimmed whitespace", async () => {
    const sourceText = "  😀正文  ";
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          bookId: "book-1",
          title: "雨后山亭",
          author: null,
          contentMode: "text",
          fileVersion: 2,
          position: {
            locator: { kind: "text", fileVersion: 2, sectionId: "txt:one", offset: 8 },
            background: "light",
            version: 1,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          fileVersion: 2,
          sections: [{ sectionId: "txt:one", title: "第一章", order: 0, text: sourceText }],
        },
      });
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request }),
    });

    // Source offset 8 lands in the trailing whitespace; the trimmed display
    // text "😀正文" is 4 code units, so the hydrated offset clamps to 4.
    const detail = await client.getBook("book-1");
    expect(detail.position).toMatchObject({ sectionId: "txt:one", offset: 4 });
  });

  it("reads the current authenticated session before every reader request", async () => {
    const sessions = [
      { kind: "authenticated" as const, token: "opaque-first-reader-token-1234567890", expiresAt: Date.now() + 60_000 },
      { kind: "authenticated" as const, token: "opaque-second-reader-token-1234567890", expiresAt: Date.now() + 60_000 },
      { kind: "authenticated" as const, token: "opaque-third-reader-token-1234567890", expiresAt: Date.now() + 60_000 },
    ];
    const request = vi.fn(async (input) => input.method === "PUT"
      ? {
          status: 200,
          data: {
            locator: { kind: "text", fileVersion: 1, sectionId: "txt:one", offset: 1 },
            background: "light",
            version: 1,
          },
        }
      : input.url.endsWith("/reading")
        ? {
            status: 200,
            data: { bookId: "book-1", title: "正文", author: null, contentMode: "text", fileVersion: 1, position: null },
          }
        : {
            status: 200,
            data: { fileVersion: 1, sections: [{ sectionId: "txt:one", title: "第一章", order: 0, text: "正文。" }] },
          });
    const authProvider = vi.fn(() => sessions.shift());
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider,
      transport: transport({ request }),
    });

    await client.getBook("book-1");
    await client.savePosition("book-1", {
      sectionId: "txt:one",
      offset: 1,
      progress: 0.5,
      background: "light",
      expectedVersion: 0,
    });

    expect(authProvider).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([input]) => input.headers.Authorization)).toEqual([
      "Bearer opaque-first-reader-token-1234567890",
      "Bearer opaque-second-reader-token-1234567890",
      "Bearer opaque-third-reader-token-1234567890",
    ]);
  });

  it("fails closed for malformed or stale reader responses", async () => {
    const malformed = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({
        request: vi.fn(async (input) => input.url.endsWith("/reading")
          ? { status: 200, data: { bookId: "book-1", title: "缺版本", author: null, contentMode: "text", position: null } }
          : { status: 200, data: { fileVersion: 1, sections: [] } }),
      }),
    });
    await expect(malformed.getBook("book-1")).rejects.toMatchObject({ code: "INVALID_LIBRARY_RESPONSE" });

    const stale = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request: vi.fn(async () => ({ status: 409, data: { code: "STALE_VERSION" } })) }),
    });
    await expect(stale.getBook("book-1")).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });
  });

  it("preserves the 401 boundary and unauthorized callback for reader requests", async () => {
    const request = vi.fn(async () => ({ status: 401, data: { code: "AUTH_REQUIRED" } }));
    const onUnauthorized = vi.fn();
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      onUnauthorized,
      transport: transport({ request }),
    });

    await expect(client.getBook("book-1")).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });
    expect(onUnauthorized).toHaveBeenCalledWith(401);
  });

  it("maps transport failures to the existing retryable library boundary", async () => {
    const client = createLibraryHttpClient({
      baseUrl: "https://api.example.test",
      authProvider: () => ({ kind: "authenticated", token: "opaque-reader-token-1234567890", expiresAt: Date.now() + 60_000 }),
      transport: transport({ request: vi.fn(async () => { throw new Error("network down"); }) }),
    });

    await expect(client.getBook("book-1")).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });
  });

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
