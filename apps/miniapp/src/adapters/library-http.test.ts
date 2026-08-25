import { describe, expect, it, vi } from "vitest";
import { createLibraryHttpClient, type LibraryHttpTransport } from "./library-http";

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
