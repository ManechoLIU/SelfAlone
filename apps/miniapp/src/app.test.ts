import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it.each(["trial", "release"])("fails closed before wx.login when %s has a non-HTTPS API origin", async (environment) => {
    vi.stubGlobal("App", vi.fn());
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: environment } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    const { createMiniappGlobalData } = await import("./app");
    const wxLogin = vi.fn(async () => ({ code: "wx-code-from-real-runtime" }));
    const authTransport = vi.fn(async () => ({
      status: 200,
      body: {
        account: { id: "account-1", email: null },
        sessionToken: "opaque-session-token-from-api-123456",
        expiresAt: "2026-09-13T01:00:00.000Z",
      },
    }));
    const globalData = createMiniappGlobalData({
      environment,
      apiBaseUrl: "http://api.example.test",
      storage: memoryStorage(),
      wxLogin,
      authTransport,
    });

    await expect(globalData.authClient.login()).rejects.toMatchObject({
      code: "AUTH_API_UNAVAILABLE",
      retryable: false,
    });
    expect(wxLogin).not.toHaveBeenCalled();
    expect(authTransport).not.toHaveBeenCalled();
  });

  it.each(["trial", "release"])("uses wx.login and an opaque API session when %s has a public HTTPS origin", async (environment) => {
    vi.stubGlobal("App", vi.fn());
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: environment } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    const { createMiniappGlobalData } = await import("./app");
    const authTransport = vi.fn(async () => ({
      status: 200,
      body: {
        account: { id: "account-1", email: null },
        sessionToken: "opaque-session-token-from-api-123456",
        expiresAt: "2026-09-13T01:00:00.000Z",
      },
    }));
    const globalData = createMiniappGlobalData({
      environment,
      apiBaseUrl: "https://api.example.test/",
      storage: memoryStorage(),
      wxLogin: async () => ({ code: "wx-code-from-real-runtime" }),
      authTransport,
    });

    await expect(globalData.authClient.login()).resolves.toMatchObject({
      sessionToken: "opaque-session-token-from-api-123456",
    });
    expect(authTransport).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://api.example.test/api/v1/auth/wechat/miniapp",
      body: { code: "wx-code-from-real-runtime" },
    }));
  });
});

describe("miniapp host runtime composition", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(["trial", "release"])("uses the host-provided public HTTPS origin in the registered %s App", async (environment) => {
    let registeredApp: { globalData: ReturnType<typeof import("./app")["createMiniappGlobalData"]> } | undefined;
    const requests: Array<{ url: string; data: unknown }> = [];
    vi.stubGlobal("App", (app: typeof registeredApp) => { registeredApp = app; });
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: environment } }),
      getExtConfigSync: () => ({ apiBaseUrl: "https://api.example.test/" }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      login: ({ success }: { success: (result: { code: string }) => void }) => {
        success({ code: "wx-code-from-release-host" });
      },
      request: ({ url, data, success }: {
        url: string;
        data: unknown;
        success: (result: { statusCode: number; data: unknown }) => void;
      }) => {
        requests.push({ url, data });
        success({
          statusCode: 200,
          data: {
            account: { id: "account-1", email: null },
            sessionToken: "opaque-session-token-from-api-123456",
            expiresAt: "2026-09-13T01:00:00.000Z",
          },
        });
      },
    });

    await import("./app");

    expect(registeredApp?.globalData.developmentAdapter).toBe(false);
    await expect(registeredApp?.globalData.authClient.login()).resolves.toMatchObject({
      sessionToken: "opaque-session-token-from-api-123456",
    });
    expect(requests).toEqual([{
      url: "https://api.example.test/api/v1/auth/wechat/miniapp",
      data: { code: "wx-code-from-release-host" },
    }]);
  });
});

describe("miniapp WeRead composition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubReleaseWx() {
    vi.stubGlobal("App", vi.fn());
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
  }

  it("injects the deterministic development WeRead port only for the develop runtime", async () => {
    stubReleaseWx();
    const { createMiniappGlobalData } = await import("./app");

    const development = createMiniappGlobalData({ environment: "develop", storage: memoryStorage() });
    const connectInput = { apiKey: "wrk-dev-a", requestId: "req-app-connect", expectedRevision: null };
    await expect(development.wereadClient.putConnection(connectInput))
      .rejects.toMatchObject({ code: "EXTERNAL_SERVICE_FAILED", retryable: true });
    const saved = await development.wereadClient.putConnection(connectInput);
    expect(saved.connection).toMatchObject({
      accountExternalId: "weread-dev-account-a",
      status: "verified",
    });
    await expect(development.wereadClient.getConnection()).resolves.toEqual({ connection: saved.connection });
    const books = await development.wereadClient.getBooks();
    expect(books.status).toBe("success");
    expect(books.books.length).toBeGreaterThan(0);

    for (const environment of ["release", "trial"]) {
      const nonDevelop = createMiniappGlobalData({ environment, storage: memoryStorage() });
      await expect(nonDevelop.wereadClient.getConnection()).resolves.toEqual({ connection: null });
      await expect(nonDevelop.wereadClient.putConnection({
        apiKey: "wrk-dev-a",
        requestId: `req-app-${environment}`,
        expectedRevision: null,
      })).rejects.toMatchObject({ code: "WEREAD_NO_CALL" });
      await expect(nonDevelop.wereadClient.getBooks())
        .rejects.toMatchObject({ code: "WEREAD_NO_CALL" });
    }
  });

  it("does not accept any runtime WeRead transport or client override", async () => {
    stubReleaseWx();
    const { createMiniappGlobalData } = await import("./app");
    const injected = {
      getConnection: vi.fn(async () => ({ connection: null })),
      putConnection: vi.fn(),
      getBooks: vi.fn(),
    };

    const releaseOptions = {
      environment: "release",
      storage: memoryStorage(),
      wereadClient: injected,
      wereadTransport: injected,
    };
    const release = createMiniappGlobalData(releaseOptions);
    await expect(release.wereadClient.putConnection({
      apiKey: "wrk-dev-a",
      requestId: "req-app-override-release",
      expectedRevision: null,
    })).rejects.toMatchObject({ code: "WEREAD_NO_CALL" });

    const developOptions = {
      environment: "develop",
      storage: memoryStorage(),
      wereadClient: injected,
      wereadTransport: injected,
    };
    const development = createMiniappGlobalData(developOptions);
    const connectInput = { apiKey: "wrk-dev-a", requestId: "req-app-override-develop", expectedRevision: null };
    await development.wereadClient.putConnection(connectInput).catch(() => undefined);
    await development.wereadClient.putConnection(connectInput);

    expect(injected.getConnection).not.toHaveBeenCalled();
    expect(injected.putConnection).not.toHaveBeenCalled();
    expect(injected.getBooks).not.toHaveBeenCalled();
  });
});
