import { describe, expect, it } from "vitest";
import {
  createSettingsState,
  parseSettingsDraft,
  resolveSettingsOverview,
  serializeSettingsDraft,
  settingsDraftStorageKey,
  settingsHash,
  settingsErrorMessage,
  type SettingsDraft,
} from "./settings-state";

const overview = {
  account: { id: "account-1", email: "reader@example.com" },
  loginMethods: {
    email: { connected: true, label: "reader@example.com" },
    wechat: { connected: false, label: null },
  },
};

describe("desktop settings state", () => {
  it("keeps one stable loading-to-normal overview contract and exposes long status text without truncation", () => {
    const loading = createSettingsState();
    expect(loading.phase).toBe("loading");
    expect(resolveSettingsOverview(loading, overview)).toMatchObject({
      phase: "ready",
      overview,
    });
    expect(resolveSettingsOverview(loading, {
      ...overview,
      services: {
        textModel: { connected: true, label: "通义千问（阿里云百炼）／工作空间：一个很长的业务空间名称" },
      },
    }).overview?.services?.textModel?.label).toContain("工作空间");
  });

  it("retains existing overview and typed mutation fields when a request fails", () => {
    const state = {
      ...createSettingsState(overview),
      draft: {
        email: "new@example.com",
        currentPassword: "当前密码",
        newPassword: "新密码",
        confirmPassword: "新密码",
      },
      mutation: { kind: "change-email" as const, phase: "submitting" as const, error: "" },
    };
    const failed = resolveSettingsOverview(state, new Error("NETWORK"));
    expect(failed.phase).toBe("ready");
    expect(failed.overview).toEqual(overview);
    expect(failed.draft).toEqual(state.draft);
    expect(failed.mutation).toEqual({
      kind: "change-email",
      phase: "failed",
      error: "暂时无法保存设置，请稍后重试。",
    });
  });

  it("round-trips refresh-safe drafts and ignores malformed storage", () => {
    const draft: SettingsDraft = {
      email: "new@example.com",
      currentPassword: "当前密码",
      newPassword: "新密码",
      confirmPassword: "新密码",
    };
    expect(settingsDraftStorageKey("account-1")).toBe("selfalone:m1:settings-draft:account-1");
    expect(parseSettingsDraft(serializeSettingsDraft(draft))).toEqual(draft);
    expect(parseSettingsDraft('{"version":1,"email":7}')).toBeNull();
  });

  it("keeps account and logout routes explicit and maps safe errors without exposing implementation details", () => {
    expect(settingsHash()).toBe("#/settings");
    expect(settingsErrorMessage("EMAIL_DELIVERY_UNAVAILABLE")).toBe(
      "暂时无法发送验证邮件，请稍后重试。",
    );
    expect(settingsErrorMessage("INTERNAL_ERROR")).toBe("暂时无法保存设置，请稍后重试。");
  });
});
