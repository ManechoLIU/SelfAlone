import { describe, expect, it, vi } from "vitest";
import {
  RealPptPublicSourceAdapter,
  createOpenLibraryPublicSourceTransport,
  createRealPptPublicSourceAdapter,
  isBodySufficient,
  isCrediblePublicSourceUrl,
  type PublicSourceSearchTransport,
} from "./ppt-outline-public-source-adapter";

const baseQuery = {
  accountId: "account-a",
  draftId: "draft-a",
  title: "第一本书",
  author: "甲作者",
};

describe("RealPptPublicSourceAdapter", () => {
  it("skips networking and returns [] when body is sufficient", async () => {
    const search = vi.fn(async () => {
      throw new Error("transport should not run");
    });
    const transport: PublicSourceSearchTransport = { search };
    const adapter = createRealPptPublicSourceAdapter({
      transport,
      now: () => new Date("2026-09-16T10:00:00.000Z"),
    });

    const result = await adapter.search(
      { ...baseQuery, bodySufficient: true },
      new AbortController().signal,
    );

    expect(result).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("treats bodyCharCount at threshold as sufficient without transport", async () => {
    const search = vi.fn(async () => [{
      url: "https://openlibrary.org/works/OL1W",
      title: "should not appear",
      publishedAt: null,
    }]);
    const adapter = new RealPptPublicSourceAdapter({
      transport: { search },
      bodySufficientMinChars: 100,
    });

    const result = await adapter.search(
      { ...baseQuery, bodyCharCount: 100 },
      new AbortController().signal,
    );

    expect(result).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("returns mapped hits when body is insufficient and transport succeeds", async () => {
    const transport: PublicSourceSearchTransport = {
      async search() {
        return [
          {
            url: "https://openlibrary.org/works/OL123W",
            title: "出版社公开页",
            publishedAt: "2020-01-01T00:00:00.000Z",
          },
          {
            url: "https://publisher.example.invalid/catalog/book",
            title: "伪造出版社",
            publishedAt: null,
          },
        ];
      },
    };
    const adapter = createRealPptPublicSourceAdapter({
      transport,
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    });

    const result = await adapter.search(
      { ...baseQuery, bodySufficient: false },
      new AbortController().signal,
    );

    expect(result).toEqual([
      {
        url: "https://openlibrary.org/works/OL123W",
        title: "出版社公开页",
        publishedAt: "2020-01-01T00:00:00.000Z",
        fetchedAt: "2026-09-16T12:00:00.000Z",
        usageScope: "outline:draft-a",
      },
    ]);
    expect(result.every((item) => !item.url.includes("example.invalid"))).toBe(true);
  });

  it("returns [] on transport failure and never fabricates example.invalid URLs", async () => {
    const transport: PublicSourceSearchTransport = {
      async search() {
        throw new Error("ECONNREFUSED simulated");
      },
    };
    const adapter = createRealPptPublicSourceAdapter({ transport });

    const result = await adapter.search(
      { ...baseQuery, bodySufficient: false },
      new AbortController().signal,
    );

    expect(result).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("example.invalid");
    expect(JSON.stringify(result)).not.toContain("出版社公开目录");
    expect(JSON.stringify(result)).not.toContain("作者访谈");
  });

  it("returns [] when transport yields no usable hits", async () => {
    const adapter = createRealPptPublicSourceAdapter({
      transport: {
        async search() {
          return [
            { url: "https://author.example.invalid/interview", title: "作者访谈", publishedAt: null },
            { url: "not-a-url", title: "坏链接", publishedAt: null },
          ];
        },
      },
    });

    const result = await adapter.search(baseQuery, new AbortController().signal);
    expect(result).toEqual([]);
  });

  it("propagates abort without fabricating sources", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createRealPptPublicSourceAdapter({
      transport: {
        async search() {
          return [{ url: "https://openlibrary.org/works/OL1W", title: "x", publishedAt: null }];
        },
      },
    });
    await expect(adapter.search(baseQuery, controller.signal)).rejects.toThrow("PPT_OUTLINE_ABORTED");
  });
});

describe("body sufficiency helpers", () => {
  it("honors explicit bodySufficient over bodyCharCount", () => {
    expect(isBodySufficient({ bodySufficient: true, bodyCharCount: 0 })).toBe(true);
    expect(isBodySufficient({ bodySufficient: false, bodyCharCount: 99999 })).toBe(false);
  });
});

describe("isCrediblePublicSourceUrl", () => {
  it("rejects placeholder hosts used by Fake", () => {
    expect(isCrediblePublicSourceUrl("https://publisher.example.invalid/catalog/book")).toBe(false);
    expect(isCrediblePublicSourceUrl("https://author.example.invalid/interview")).toBe(false);
    expect(isCrediblePublicSourceUrl("https://openlibrary.org/works/OL1W")).toBe(true);
  });
});

describe("Open Library transport", () => {
  it("maps search.json docs and ignores non-OK responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      docs: [
        { key: "/works/OL9W", title: "可信书目", first_publish_year: 2019 },
        { key: "works/missing-title", first_publish_year: 2018 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const transport = createOpenLibraryPublicSourceTransport({ fetchImpl: fetchImpl as typeof fetch });
    const hits = await transport.search(
      { title: "第一本书", author: "甲作者" },
      new AbortController().signal,
    );

    expect(hits).toEqual([
      {
        url: "https://openlibrary.org/works/OL9W",
        title: "可信书目",
        publishedAt: "2019-01-01T00:00:00.000Z",
      },
    ]);
    const calledUrl = fetchImpl.mock.calls.at(0)?.at(0);
    expect(String(calledUrl)).toContain("openlibrary.org/search.json");

    const failing = createOpenLibraryPublicSourceTransport({
      fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch,
    });
    await expect(failing.search({ title: "x", author: null }, new AbortController().signal))
      .resolves.toEqual([]);
  });
});
