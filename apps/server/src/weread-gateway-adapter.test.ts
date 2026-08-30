import { describe, expect, it, vi } from "vitest";
import { WeReadAdapterError, WeReadSyncPausedError } from "./weread-adapter";
import {
  WEREAD_GATEWAY_API_NAMES,
  WEREAD_GATEWAY_URL,
  WEREAD_SKILL_VERSION,
  createWeReadGatewayAdapter,
} from "./weread-gateway-adapter";

const API_KEY = "wrk-unit-gateway-secret";
const PREVIOUS_BOOK = {
  externalId: "book-previous",
  title: "上次成功",
  author: "作者",
  coverUrl: "https://cdn.example.test/book-previous.jpg",
  progressPercent: 43,
  lastReadAt: "2024-01-02T03:04:05.000Z",
};
const PREVIOUS_ANNOTATION = {
  externalId: "annotation-old",
  bookExternalId: "book-a",
  quote: "旧划线",
  thought: "旧想法",
  location: "第一章",
  createdAt: "2024-01-02T03:04:05.000Z",
  updatedAt: "2024-01-02T03:04:05.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createAdapter(
  fetcher: typeof fetch,
  overrides: Parameters<typeof createWeReadGatewayAdapter>[0] = {},
) {
  return createWeReadGatewayAdapter({
    fetcher,
    skillVersion: WEREAD_SKILL_VERSION,
    sleep: async () => undefined,
    resolveConnection: () => ({
      apiKey: API_KEY,
      accountExternalId: "weread-a",
      lastSuccessfulBooks: [PREVIOUS_BOOK],
      lastSuccessfulAnnotations: [PREVIOUS_ANNOTATION],
    }),
    ...overrides,
  });
}

function requestBody(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) {
  return JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body)) as Record<string, unknown>;
}

describe("official WeRead Agent Gateway adapter", () => {
  it("posts allowlisted gateway skill_version with Bearer and fails closed on upgrade_info", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(jsonResponse({
      errcode: 0,
      userVid: "weread-a",
      books: [],
    }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.validate(API_KEY)).resolves.toEqual({
      externalId: "weread-a",
      displayName: null,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      WEREAD_GATEWAY_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        }),
      }),
    );
    expect(requestBody(fetcher)).toEqual({
      api_name: WEREAD_GATEWAY_API_NAMES.validate,
      skill_version: WEREAD_SKILL_VERSION,
    });
    expect(WEREAD_GATEWAY_URL).toBe("https://i.weread.qq.com/api/agent/gateway");
    expect(WEREAD_GATEWAY_API_NAMES).toEqual({
      validate: "/shelf/sync",
      syncBooks: "/shelf/sync",
      syncAnnotations: "/book/bookmarklist",
    });

    fetcher.mockResolvedValueOnce(jsonResponse({
      errcode: 0,
      upgrade_info: { message: "please upgrade" },
      books: [{ bookId: "book-new", title: "这次同步" }],
    }));

    const paused = await adapter.syncBooks("connection-a");
    expect(paused).toMatchObject({
      status: "paused",
      snapshot: "last_success",
      connectionId: "connection-a",
      accountExternalId: "weread-a",
      cursor: null,
      nextCursor: null,
      books: [PREVIOUS_BOOK],
      pause: {
        reason: "upgrade_required",
        errcode: 0,
        upgradeInfo: "please upgrade",
      },
    });
    expect(paused).not.toMatchObject({ status: "success", snapshot: "fresh" });
    expect(JSON.stringify(paused)).not.toContain("book-new");
    expect(JSON.stringify(paused)).not.toContain(API_KEY);
    expect(requestBody(fetcher, 1)).toEqual({
      api_name: WEREAD_GATEWAY_API_NAMES.syncBooks,
      skill_version: WEREAD_SKILL_VERSION,
    });
  });

  it("rejects invalid keys before any network call and maps provider auth failures", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createAdapter(fetcher);

    await expect(adapter.validate("")).rejects.toMatchObject({ code: "WEREAD_INVALID_API_KEY" });
    await expect(adapter.validate("not-a-weread-key")).rejects.toMatchObject({ code: "WEREAD_INVALID_API_KEY" });
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(jsonResponse({ errcode: -2010, errmsg: API_KEY }, 401));
    const invalid = await adapter.validate(API_KEY).catch((reason: unknown) => reason);
    expect(invalid).toMatchObject({ code: "WEREAD_INVALID_API_KEY", errcode: -2010 });
    expect(JSON.stringify(invalid)).not.toContain(API_KEY);
  });

  it("maps shelf books without fabricating albums, cursors, or progress", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      errcode: 0,
      books: [{
        bookId: "book-a",
        title: "A 书",
        author: "作者",
        cover: "https://cdn.example.test/book-a.jpg",
        readUpdateTime: 1_704_164_645,
        progress: 43,
      }],
      albums: [{
        albumInfo: { albumId: "album-1", name: "有声书不应被编成书" },
      }],
    }));
    const adapter = createAdapter(fetcher);

    const page = await adapter.syncBooks("connection-a");
    expect(page).toMatchObject({
      status: "success",
      snapshot: "fresh",
      cursor: null,
      nextCursor: null,
      books: [{
        externalId: "book-a",
        title: "A 书",
        author: "作者",
        coverUrl: "https://cdn.example.test/book-a.jpg",
        progressPercent: 43,
        lastReadAt: "2024-01-02T03:04:05.000Z",
      }],
    });
    expect(page.books).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("album-1");
    expect(JSON.stringify(page)).not.toContain(API_KEY);
    await expect(adapter.syncBooks("connection-a", "opaque-next"))
      .rejects.toMatchObject({ code: "WEREAD_CURSOR_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps bookmarklist annotations and fails closed on annotation upgrade_info", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(jsonResponse({
      errcode: 0,
      updated: [{
        bookmarkId: "annotation-a",
        bookId: "book-a",
        markText: "重要的一句",
        chapterUid: 108,
        createTime: 1_704_164_645,
      }],
      chapters: [{ chapterUid: 108, title: "第一章" }],
    }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.syncAnnotations("connection-a", "book-a")).resolves.toEqual([{
      externalId: "annotation-a",
      bookExternalId: "book-a",
      quote: "重要的一句",
      thought: null,
      location: "第一章",
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-01-02T03:04:05.000Z",
    }]);
    expect(requestBody(fetcher)).toEqual({
      api_name: WEREAD_GATEWAY_API_NAMES.syncAnnotations,
      skill_version: WEREAD_SKILL_VERSION,
      bookId: "book-a",
    });
    expect(requestBody(fetcher)).not.toHaveProperty("params");

    fetcher.mockResolvedValueOnce(jsonResponse({
      errcode: 426,
      upgrade_info: "please upgrade",
      updated: [{ bookmarkId: "annotation-new", markText: "不应采用" }],
    }));
    const paused = await adapter.syncAnnotations("connection-a", "book-a").catch((reason: unknown) => reason);
    expect(paused).toBeInstanceOf(WeReadSyncPausedError);
    expect(paused).toMatchObject({
      code: "WEREAD_SYNC_PAUSED",
      kind: "annotations",
      snapshot: [PREVIOUS_ANNOTATION],
      pause: {
        reason: "upgrade_required",
        errcode: 426,
        upgradeInfo: "please upgrade",
      },
    });
    expect(JSON.stringify(paused)).not.toContain("annotation-new");
    expect(JSON.stringify(paused)).not.toContain(API_KEY);
  });

  it("keeps provider errors fail-closed without treating them as fresh data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      errcode: 503,
      books: [{ bookId: "book-new", title: "这次同步" }],
    }));
    const adapter = createAdapter(fetcher, { maxRetries: 0 });
    const error = await adapter.syncBooks("connection-a").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WeReadAdapterError);
    expect(error).toMatchObject({ code: "WEREAD_PROVIDER_ERROR", errcode: 503, retryable: true });
    expect(JSON.stringify(error)).not.toContain("book-new");
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });
});
