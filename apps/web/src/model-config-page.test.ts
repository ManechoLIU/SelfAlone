import { describe, expect, it } from "vitest";
import { createTextModelDraft, type TextModelCredential } from "./model-config";
import {
  parseSettingsRoute,
  renderSettingsOverview,
  renderTextModelPage,
  settingsRouteHash,
  type SettingsOverviewState,
  type TextModelPageState,
} from "./model-config-page";

const configured: TextModelCredential = {
  provider: "qwen",
  maskedApiKey: "••••••••1234",
  workspaceId: "workspace-1",
  verifiedAt: "2026-08-23T00:00:00.000Z",
  catalogVersion: "text-models-v1",
  status: "verified",
};

describe("settings routes and pages", () => {
  it("keeps settings and detail routes in the hash without putting secrets in them", () => {
    expect(parseSettingsRoute("#/settings")).toEqual({ kind: "settings" });
    expect(parseSettingsRoute("#/settings/text-model")).toEqual({ kind: "text-model" });
    expect(parseSettingsRoute("#/settings/text-model?return=%23%2Fbooks")).toEqual({ kind: "text-model", returnTo: "#/books" });
    expect(settingsRouteHash({ kind: "text-model" })).toBe("#/settings/text-model");
    expect(settingsRouteHash({ kind: "settings" })).toBe("#/settings");
    expect(settingsRouteHash({ kind: "text-model", returnTo: "#/books" })).toBe("#/settings/text-model?return=%23%2Fbooks");
  });

  it("renders overview loading, unconfigured, configured and error states", () => {
    const states: SettingsOverviewState[] = [
      { status: "loading" },
      { status: "unconfigured" },
      { status: "configured", credential: configured },
      { status: "error", message: "暂时无法加载设置。" },
    ];
    expect(renderSettingsOverview(states[0])).toContain("正在加载设置");
    expect(renderSettingsOverview(states[1])).toContain("未配置");
    expect(renderSettingsOverview(states[2])).toContain("••••••••1234");
    expect(renderSettingsOverview(states[3])).toContain("暂时无法加载设置");
  });

  it("renders the fixed provider form and only shows workspace input for Qwen", () => {
    const state: TextModelPageState = {
      status: "editing",
      credential: configured,
      draft: createTextModelDraft(configured),
      returnTo: "#/settings",
    };
    const html = renderTextModelPage(state);
    expect(html).toContain('id="text-model-provider"');
    expect(html).toContain("DeepSeek");
    expect(html).toContain("Kimi（月之暗面）");
    expect(html).toContain("GLM（智谱）");
    expect(html).toContain("通义千问（阿里云百炼）");
    expect(html).toContain('id="text-model-workspace"');
    expect(html).toContain('id="text-model-api-key"');
    expect(html).toContain("检测并保存");
    expect(html).toContain("••••••••1234");

    const nonQwenHtml = renderTextModelPage({
      ...state,
      draft: { ...state.draft, provider: "deepseek", workspaceId: "" },
    });
    expect(nonQwenHtml).not.toContain('id="text-model-workspace"');
  });

  it("does not render a secret in success state and keeps an inline error near the form", () => {
    const secret = "new-secret";
    const errorState: TextModelPageState = {
      status: "editing",
      credential: null,
      draft: { ...createTextModelDraft(null), apiKey: secret },
      returnTo: "#/settings",
      error: "校验未通过，请检查 API Key 和业务空间 ID。",
    };
    expect(renderTextModelPage(errorState)).toContain("校验未通过");
    expect(renderTextModelPage(errorState)).not.toContain(secret);

    const successHtml = renderTextModelPage({
      status: "success",
      credential: configured,
      draft: createTextModelDraft(configured),
      returnTo: "#/settings",
      notice: "已配置，可继续",
    });
    expect(successHtml).toContain("已配置，可继续");
    expect(successHtml).not.toContain(secret);
  });

  it("renders revoke confirmation as a secondary destructive action", () => {
    const html = renderTextModelPage({
      status: "confirm-revoke",
      credential: configured,
      draft: createTextModelDraft(configured),
      returnTo: "#/settings",
    });
    expect(html).toContain("确认移除");
    expect(html).toContain("保留当前配置");
  });

  it("does not claim model access continues after the credential is revoked", () => {
    const html = renderTextModelPage({
      status: "success",
      credential: null,
      draft: createTextModelDraft(null),
      returnTo: "#/settings",
      notice: "文本模型配置已移除",
    });
    expect(html).toContain("已移除保存的凭证");
    expect(html).toContain("书籍、笔记和历史作品不受影响");
    expect(html).not.toContain("可以继续使用 AI 能力");
  });
});
