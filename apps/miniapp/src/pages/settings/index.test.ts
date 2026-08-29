import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import template from "./index.wxml?raw";

type SettingsPageHarness = {
  data: Record<string, any>;
  setData(patch: Record<string, any>, callback?: () => void): void;
  showWeReadSettings(): void;
  deleteWeReadConnection(): Promise<void>;
  onWeReadApiKeyInput(event: MiniappEvent<{ value: string }>): void;
  saveWeReadConnection(): Promise<void>;
  [key: string]: any;
};

let pageDefinition: SettingsPageHarness;

function createPage(): SettingsPageHarness {
  return {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)) as Record<string, any>,
    setData(this: SettingsPageHarness, patch: Record<string, any>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  } as SettingsPageHarness;
}

beforeAll(async () => {
  vi.stubGlobal("Page", (definition: SettingsPageHarness) => { pageDefinition = definition; });
  vi.stubGlobal("getApp", () => ({ globalData: { session: { kind: "authenticated", token: "token" }, sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) } } }));
  vi.stubGlobal("wx", {});
  await import("./index");
});

afterAll(() => vi.unstubAllGlobals());

describe("settings page product copy", () => {
  it("does not expose development-only labels in the normal page", () => {
    expect(template).not.toMatch(/开发适配器|等待 F[123]/);
    expect(template).not.toContain("development-boundary");
  });

  it("uses user-understandable unavailable service states", () => {
    expect(template).toContain("暂不可用");
    expect(template).toContain("未配置");
    expect(template).toContain("未连接");
  });

  it("keeps WeRead as one overview row instead of embedding an unstyled editor", () => {
    expect(template).toContain('bindtap="showWeReadSettings"');
    expect(template).not.toContain("settings-service-editor");
    expect(template).not.toContain("settings-service-editor__input");
  });

  it("connects or updates WeRead through the injected contract port and reflects its sync run", async () => {
    const putConnection = vi.fn(async (input: { apiKey: string; requestId: string; expectedRevision: string | null }) => ({
      connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "4",
      },
      sync: { run: {
        runId: "run-a",
        requestId: input.requestId,
        operation: "books" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        status: "queued" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      } },
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-secret" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();

    expect(putConnection).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "wrk-secret",
      expectedRevision: null,
    }));
    expect(page.data.wereadConnection).toEqual(expect.objectContaining({ revision: "4" }));
    expect(page.data.wereadSyncStatus).toBe("queued");
    expect(page.data.wereadApiKey).toBe("");
  });

  it("retains the entered key and existing connection when an update fails", async () => {
    const putConnection = vi.fn(async () => { throw new Error("微信读书暂时不可用"); });
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.data.wereadConnection = { connectionId: "old", revision: "3" };
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-new" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();

    expect(page.data.wereadApiKey).toBe("wrk-new");
    expect(page.data.wereadConnection).toEqual({ connectionId: "old", revision: "3" });
    expect(page.data.wereadError).toBe("微信读书暂时不可用");
  });

  it("reuses the same request id when a failed save is retried", async () => {
    const putConnection = vi
      .fn()
      .mockRejectedValueOnce(new Error("首次验证失败"))
      .mockResolvedValueOnce({
        connection: {
          connectionId: "connection-a",
          accountExternalId: "weread-account-a",
          apiKeyHint: "wrk-••••••••",
          status: "verified" as const,
          verifiedAt: "2024-01-02T03:04:05.000Z",
          revision: "4",
        },
        sync: { run: {
          runId: "run-a",
          requestId: "request-a",
          operation: "books" as const,
          connectionId: "connection-a",
          accountExternalId: "weread-account-a",
          status: "queued" as const,
          snapshot: "none" as const,
          cursor: null,
          nextCursor: null,
          retryCount: 0,
          createdAt: "2024-01-02T03:04:05.000Z",
          updatedAt: "2024-01-02T03:04:05.000Z",
        } },
      });
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-retry" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();
    await page.saveWeReadConnection();

    expect(putConnection).toHaveBeenNthCalledWith(2, expect.objectContaining({
      apiKey: "wrk-retry",
      requestId: (putConnection.mock.calls[0]?.[0] as { requestId: string }).requestId,
    }));
    expect(page.data.wereadApiKey).toBe("");
  });

  it("does not let an older save response overwrite a newly opened connection session", async () => {
    const deferred: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
    const putConnection = vi.fn(() => new Promise((resolve, reject) => {
      deferred.push({ resolve, reject });
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-old" }, currentTarget: { dataset: {} } });
    const oldSave = page.saveWeReadConnection();

    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-new" }, currentTarget: { dataset: {} } });
    deferred[0]?.resolve({
      connection: {
        connectionId: "old-connection",
        accountExternalId: "old-account",
        apiKeyHint: "old",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "old",
      },
      sync: { run: {
        runId: "old-run",
        requestId: "old-request",
        operation: "books" as const,
        connectionId: "old-connection",
        accountExternalId: "old-account",
        status: "queued" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      } },
    });
    await oldSave;

    expect(page.data.wereadApiKey).toBe("wrk-new");
    expect(page.data.wereadConnection).toBeNull();
    expect(page.data.wereadEditorOpen).toBe(true);
    expect(putConnection).toHaveBeenCalledTimes(1);
  });

  it("does not let an old save response overwrite a newer account connection", async () => {
    let resolveSave: ((value: any) => void) | undefined;
    const putConnection = vi.fn(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-old",
      accountExternalId: "account-old",
      apiKeyHint: "old",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-old" }, currentTarget: { dataset: {} } });
    const oldSave = page.saveWeReadConnection();

    page.data.wereadConnection = {
      connectionId: "connection-new",
      accountExternalId: "account-new",
      apiKeyHint: "new",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "4",
    };
    resolveSave?.({
      connection: page.data.wereadConnection,
      sync: { run: {
        runId: "new-run",
        requestId: "old-request",
        operation: "books" as const,
        connectionId: "connection-new",
        accountExternalId: "account-new",
        status: "queued" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      } },
    });
    await oldSave;

    expect(page.data.wereadConnection).toEqual(expect.objectContaining({
      connectionId: "connection-new",
      accountExternalId: "account-new",
      revision: "4",
    }));
    expect(page.data.wereadApiKey).toBe("wrk-old");
    expect(page.data.wereadEditorOpen).toBe(true);
  });

  it("adopts a legitimate account replacement when the saved key resolves to a different account", async () => {
    const putConnection = vi.fn(async (input: { apiKey: string; requestId: string; expectedRevision: string | null }) => ({
      connection: {
        connectionId: "connection-b",
        accountExternalId: "weread-account-b",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-03T03:04:05.000Z",
        revision: "4",
      },
      sync: { run: {
        runId: "run-b",
        requestId: input.requestId,
        operation: "books" as const,
        connectionId: "connection-b",
        accountExternalId: "weread-account-b",
        status: "queued" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: "2024-01-03T03:04:05.000Z",
        updatedAt: "2024-01-03T03:04:05.000Z",
      } },
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      apiKeyHint: "old",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-account-b" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();

    expect(putConnection).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: "3" }));
    expect(page.data.wereadConnection).toEqual(expect.objectContaining({
      connectionId: "connection-b",
      accountExternalId: "weread-account-b",
      revision: "4",
    }));
    expect(page.data.wereadEditorOpen).toBe(false);
    expect(page.data.wereadApiKey).toBe("");
    expect(page.data.wereadSaving).toBe(false);
  });

  it("does not let an older connection load overwrite a newly opened connection session", async () => {
    let resolveConnection: ((value: any) => void) | undefined;
    const getConnection = vi.fn(() => new Promise((resolve) => {
      resolveConnection = resolve;
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { getConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    const oldLoad = page.loadWeReadConnection();
    page.showWeReadSettings();
    resolveConnection?.({ connection: {
      connectionId: "old-connection",
      accountExternalId: "old-account",
      apiKeyHint: "old",
      status: "verified" as const,
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "old",
    } });
    await oldLoad;

    expect(page.data.wereadConnection).toBeNull();
    expect(page.data.wereadEditorOpen).toBe(true);
  });

  it("disconnects through the injected port with the observed revision and clears the status", async () => {
    const deleteConnection = vi.fn(async (input: { expectedRevision: string }) => {
      expect(input).toEqual({ expectedRevision: "3" });
      return { status: "disconnected" as const };
    });
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { deleteConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      apiKeyHint: "wrk-••••••••",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    page.data.wereadEditorOpen = true;

    await page.deleteWeReadConnection();

    expect(deleteConnection).toHaveBeenCalledWith({ expectedRevision: "3" });
    expect(page.data).toMatchObject({
      wereadConnection: null,
      wereadSyncStatus: "idle",
      wereadSyncLabel: "未连接",
      wereadEditorOpen: false,
    });
  });

  it("renders a full-screen WeRead editor with masked input, visibility toggle, save and back controls", () => {
    expect(template).toContain('wx:if="{{wereadEditorOpen}}"');
    expect(template).toContain('bindtap="closeWeReadSettings"');
    expect(template).toContain("返回设置");
    expect(template).toContain("/assets/icons/back.svg");
    expect(template).toContain('password="{{!wereadShowApiKey}}"');
    expect(template).toContain('bindinput="onWeReadApiKeyInput"');
    expect(template).toContain('bindtap="toggleWeReadApiKeyVisibility"');
    expect(template).toContain('bindtap="saveWeReadConnection"');
    expect(template).toContain("检测并保存");
    expect(template).toContain('role="alert"');
  });

  it("keeps disconnect as a low-frequency action inside the editor view only", () => {
    const editorStart = template.indexOf('wx:if="{{wereadEditorOpen}}"');
    expect(editorStart).toBeGreaterThan(-1);
    expect(template).toContain("断开连接");
    expect(template.indexOf('bindtap="deleteWeReadConnection"')).toBeGreaterThan(editorStart);
  });

  it("toggles key visibility with an accessible control and resets it when the editor reopens", () => {
    const page = createPage();
    page.showWeReadSettings();
    expect(page.data.wereadShowApiKey).toBe(false);

    page.toggleWeReadApiKeyVisibility();
    expect(page.data.wereadShowApiKey).toBe(true);

    page.closeWeReadSettings();
    page.showWeReadSettings();
    expect(page.data.wereadShowApiKey).toBe(false);
    expect(page.data.wereadApiKey).toBe("");
  });

  it("keeps the editor open with the entered key and a visible error when validation fails", async () => {
    const putConnection = vi.fn(async () => { throw new Error("微信读书暂时不可用"); });
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-kept" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();

    expect(page.data.wereadEditorOpen).toBe(true);
    expect(page.data.wereadApiKey).toBe("wrk-kept");
    expect(page.data.wereadError).toBe("微信读书暂时不可用");
    expect(page.data.wereadSaving).toBe(false);
  });

  it("closes the editor and shows the real connected status after a successful save", async () => {
    const putConnection = vi.fn(async () => ({
      connection: {
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        apiKeyHint: "wrk-••••••••",
        status: "verified" as const,
        verifiedAt: "2024-01-02T03:04:05.000Z",
        revision: "4",
      },
      sync: { run: {
        runId: "run-a",
        requestId: "request-a",
        operation: "books" as const,
        connectionId: "connection-a",
        accountExternalId: "weread-account-a",
        status: "queued" as const,
        snapshot: "none" as const,
        cursor: null,
        nextCursor: null,
        retryCount: 0,
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-02T03:04:05.000Z",
      } },
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { putConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.showWeReadSettings();
    page.onWeReadApiKeyInput({ detail: { value: "wrk-secret" }, currentTarget: { dataset: {} } });

    await page.saveWeReadConnection();

    expect(page.data.wereadEditorOpen).toBe(false);
    expect(page.data.wereadApiKey).toBe("");
    expect(page.data.wereadSaving).toBe(false);
    expect(page.data.wereadSyncLabel).toBe("等待同步");
    expect(page.data.wereadConnection).toEqual(expect.objectContaining({ connectionId: "connection-a" }));
  });

  it("does not let an old disconnect clear a newer account connection", async () => {
    let resolveDelete: ((value: { status: "disconnected" }) => void) | undefined;
    const deleteConnection = vi.fn(() => new Promise<{ status: "disconnected" }>((resolve) => {
      resolveDelete = resolve;
    }));
    vi.stubGlobal("getApp", () => ({ globalData: {
      wereadClient: { deleteConnection },
      sessionStore: { restore: () => ({ kind: "authenticated", token: "token" }) },
      session: { kind: "authenticated", token: "token" },
    } }));
    const page = createPage();
    page.data.wereadConnection = {
      connectionId: "connection-old",
      accountExternalId: "account-old",
      apiKeyHint: "old",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "3",
    };
    const oldDelete = page.deleteWeReadConnection();
    page.data.wereadConnection = {
      connectionId: "connection-new",
      accountExternalId: "account-new",
      apiKeyHint: "new",
      status: "verified",
      verifiedAt: "2024-01-02T03:04:05.000Z",
      revision: "4",
    };
    resolveDelete?.({ status: "disconnected" });
    await oldDelete;

    expect(page.data.wereadConnection).toEqual(expect.objectContaining({
      connectionId: "connection-new",
      accountExternalId: "account-new",
    }));
  });
});
