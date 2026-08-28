import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import template from "./index.wxml?raw";

type SettingsPageHarness = {
  data: Record<string, any>;
  setData(patch: Record<string, any>, callback?: () => void): void;
  showWeReadSettings(): void;
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
});
