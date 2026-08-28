import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); },
  };
}

describe("miniapp runtime composition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the notes QA adapter only for the explicit development runtime", async () => {
    vi.stubGlobal("App", vi.fn());
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    const { createMiniappGlobalData } = await import("./app");
    const bookId = "dev-local-ink";

    const development = createMiniappGlobalData({ environment: "develop", storage: memoryStorage() });
    expect(development.developmentAdapter).toBe(true);
    await expect(development.annotationsClient.getAnnotations(bookId)).resolves.toMatchObject({
      notes: expect.arrayContaining([
        expect.objectContaining({ id: "dev-note-dev-local-ink-primary" }),
        expect.objectContaining({ id: "dev-note-dev-local-ink-follow-up" }),
      ]),
    });

    const release = createMiniappGlobalData({ environment: "release", storage: memoryStorage() });
    expect(release.developmentAdapter).toBe(false);
    await expect(release.annotationsClient.getAnnotations(bookId)).rejects.toMatchObject({
      code: "ANNOTATIONS_API_UNAVAILABLE",
    });
  });

  it("composes the release library client with a fresh Bearer and clears session after 401", async () => {
    const requests: Array<{ url: string; method?: string; header?: Record<string, string> }> = [];
    const responses = [
      { statusCode: 200, data: { books: [] } },
      { statusCode: 401, data: { code: "AUTH_REQUIRED" } },
    ];
    vi.stubGlobal("wx", {
      request: vi.fn((input: {
        url: string;
        method?: string;
        header?: Record<string, string>;
        success?: (response: { statusCode: number; data: unknown }) => void;
      }) => {
        requests.push({ url: input.url, method: input.method, header: input.header });
        input.success?.(responses.shift()!);
      }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    const { createMiniappGlobalData } = await import("./app");
    const globalData = createMiniappGlobalData({
      environment: "release",
      apiBaseUrl: "https://api.example.test",
      storage: memoryStorage(),
    });
    const firstToken = "opaque-first-session-token-1234567890";
    const secondToken = "opaque-second-session-token-1234567890";
    globalData.session = globalData.sessionStore.saveAuthenticatedSession(firstToken, Date.now() + 60_000);
    await expect(globalData.client.listBooks()).resolves.toEqual([]);

    globalData.session = globalData.sessionStore.saveAuthenticatedSession(secondToken, Date.now() + 60_000);
    await expect(globalData.client.listBooks()).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });
    expect(requests.map((request) => request.header?.Authorization)).toEqual([
      `Bearer ${firstToken}`,
      `Bearer ${secondToken}`,
    ]);
    expect(globalData.session).toEqual({ kind: "signed-out" });
  });
});
