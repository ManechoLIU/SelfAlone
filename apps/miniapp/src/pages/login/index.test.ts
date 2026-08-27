import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type LoginPageHarness = {
  data: {
    mode: "main" | "email";
    email: string;
    message: string;
    developmentAdapter: boolean;
    keyboardOpen: boolean;
    viewportStyle: string;
    viewportMetrics: string;
    wechatPending?: boolean;
  };
  setData(patch: Record<string, unknown>, callback?: () => void): void;
  loginWechat(): Promise<void>;
  [key: string]: any;
};

let pageDefinition: LoginPageHarness;

beforeAll(async () => {
  vi.stubGlobal("Page", (definition: LoginPageHarness) => { pageDefinition = definition; });
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function createPage() {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(this: LoginPageHarness, patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  } as LoginPageHarness;
}

function appHarness() {
  const session = { kind: "signed-out" as const };
  const saveAuthenticatedSession = vi.fn((token: string, expiresAt: number) => ({
    kind: "authenticated" as const,
    token,
    expiresAt,
  }));
  const authClient = { login: vi.fn() };
  const app = {
    globalData: {
      session,
      sessionStore: {
        restore: () => session,
        restoreEmailDraft: () => "",
        saveEmailDraft: vi.fn(),
        saveAuthenticatedSession,
      },
      authClient,
      developmentAdapter: false,
    },
  };
  const reLaunch = vi.fn();
  vi.stubGlobal("getApp", () => app);
  vi.stubGlobal("wx", { reLaunch });
  return { app, authClient, reLaunch, saveAuthenticatedSession };
}

describe("miniapp WeChat login page", () => {
  it("saves the injected auth result and enters the conversation", async () => {
    const { app, authClient, reLaunch, saveAuthenticatedSession } = appHarness();
    authClient.login.mockResolvedValue({
      account: { id: "account-a", email: null },
      sessionToken: "opaque-mini-session-token-1234567890",
      expiresAt: 1_900_000_000_000,
    });
    const page = createPage();

    await page.loginWechat();

    expect(saveAuthenticatedSession).toHaveBeenCalledWith(
      "opaque-mini-session-token-1234567890",
      1_900_000_000_000,
    );
    expect(app.globalData.session).toEqual({
      kind: "authenticated",
      token: "opaque-mini-session-token-1234567890",
      expiresAt: 1_900_000_000_000,
    });
    expect(reLaunch).toHaveBeenCalledWith({ url: "/pages/conversation/index" });
    expect(page.data).toMatchObject({ message: "", wechatPending: false });
  });

  it("keeps the page signed out and visible when auth fails", async () => {
    const { app, authClient, reLaunch, saveAuthenticatedSession } = appHarness();
    authClient.login.mockRejectedValue(new Error("network down"));
    const page = createPage();
    page.data.mode = "email";
    page.data.email = "reader@example.com";

    await page.loginWechat();

    expect(saveAuthenticatedSession).not.toHaveBeenCalled();
    expect(app.globalData.session).toEqual({ kind: "signed-out" });
    expect(reLaunch).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({
      mode: "email",
      email: "reader@example.com",
      message: "network down",
      wechatPending: false,
    });
  });
});
