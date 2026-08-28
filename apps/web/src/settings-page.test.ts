import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSettingsPage } from "./settings-page";
import { createSettingsState, type SettingsOverview } from "./settings-state";
import { createWeReadState } from "./weread-state";

const settings: SettingsOverview = {
  account: { id: "account-1", email: "reader@example.com" },
  loginMethods: {
    email: { connected: true, label: "reader@example.com" },
    wechat: { connected: false, label: null },
  },
  services: {
    textModel: { connected: true, label: "DeepSeek" },
    imageModel: { connected: false, label: "未配置" },
    weread: { connected: true, label: "已连接" },
  },
};

const css = readFileSync(new URL("./settings-page.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("desktop settings page candidate", () => {
  it("renders the approved overview hierarchy with one account entry and one logout row", () => {
    const html = renderSettingsPage(createSettingsState(settings));

    expect(html).toContain('data-settings-page="overview"');
    expect(html).toContain("账户与登录方式");
    expect(html).toContain("文本模型");
    expect(html).toContain("图片模型");
    expect(html).toContain("微信读书");
    expect((html.match(/账户与登录方式/g) ?? []).length).toBe(1);
    expect(html.match(/data-settings-action="account"/g)).toHaveLength(1);
    expect(html.match(/data-settings-action="weread"/g)).toHaveLength(1);
    expect(html.match(/data-settings-action="logout"/g)).toHaveLength(1);
    expect(html.match(/data-settings-row/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain("DeepSeek");
    expect(html).toContain("laoji-mascot-seated-reading-transparent-v1.png");
    expect(html).not.toContain("绑定微信");
    expect(html).not.toContain("解除绑定");
    expect(html).not.toContain("开发适配器");
  });

  it("keeps a stable loading or failure shell and preserves the previous overview context", () => {
    const loading = renderSettingsPage({ ...createSettingsState(), phase: "loading" });
    expect(loading).toContain('data-settings-phase="loading"');
    expect(loading).toContain("正在加载设置");
    expect(loading).toContain('aria-busy="true"');

    const failed = renderSettingsPage({
      ...createSettingsState(settings),
      phase: "ready",
      error: "暂时无法保存设置，请稍后重试。",
      mutation: { kind: "change-email", phase: "failed", error: "暂时无法保存设置，请稍后重试。" },
    });
    expect(failed).toContain("reader@example.com");
    expect(failed).toContain("暂时无法保存设置，请稍后重试。");
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain("状态：失败");

    const initialFailure = renderSettingsPage({
      ...createSettingsState(),
      phase: "failed",
      error: "暂时无法加载设置，请稍后重试。",
    });
    expect(initialFailure).toContain("暂时无法加载设置，请稍后重试。");
    expect(initialFailure).toContain("重新加载");
    expect(initialFailure).not.toContain("正在加载设置");
  });

  it("renders an account detail view with retained fields and a single primary action", () => {
    const html = renderSettingsPage({
      ...createSettingsState(settings),
      view: "account",
      draft: {
        email: "new@example.com",
        currentPassword: "当前密码",
        newPassword: "新密码",
        confirmPassword: "新密码",
      },
      accountError: "验证邮件发送失败，已保留输入，请稍后重试。",
    });
    expect(html).toContain('data-settings-page="account"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="currentPassword"');
    expect(html).toContain('name="newPassword"');
    expect(html).toContain("new@example.com");
    expect(html).toContain("验证邮件发送失败，已保留输入，请稍后重试。");
    expect(html.match(/data-settings-primary/g)).toHaveLength(1);
    expect(html).toContain("保存并验证");
  });

  it("renders the WeRead connection detail inside the authenticated settings shell", () => {
    const html = renderSettingsPage(
      createSettingsState(settings),
      createWeReadState({ view: "connection", phase: "ready" }),
    );

    expect(html).toContain('data-settings-page="weread"');
    expect(html).toContain('data-weread-connection-form');
    expect(html).toContain('data-weread-action="save-connection"');
    expect(html).toContain("当前接缝使用本地同步数据");
  });

  it("renders the text model detail within the authenticated settings shell", () => {
    const state = createSettingsState(settings);
    const html = renderSettingsPage({
      ...state,
      view: "text-model",
      textModel: {
        status: "editing",
        credential: null,
        draft: {
          provider: "deepseek",
          apiKey: "fake-browser-key",
          workspaceId: "",
          existingMaskedApiKey: "",
          showApiKey: false,
        },
        returnTo: "#/settings",
        error: "校验未通过，请检查 API Key。",
      },
    });
    expect(html).toContain('data-settings-page="text-model"');
    expect(html).toContain('id="text-model-api-key"');
    expect(html).toContain("检测并保存");
    expect(html).toContain("校验未通过");
    expect(html).not.toContain("fake-browser-key");
  });

  it("uses an explicit logout confirmation and labels the destructive action", () => {
    const html = renderSettingsPage({
      ...createSettingsState(settings),
      logoutConfirmation: true,
    });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("确认退出登录");
    expect(html).toContain('data-settings-action="logout-confirm"');
    expect(html).toContain('data-settings-action="logout-cancel"');
    expect(html).toContain("退出后需要重新登录才能继续");
  });

  it("keeps responsive rows, paper surfaces, focus rings and reduced-motion rules local to the candidate", () => {
    expect(css).toContain("#E7EAE8");
    expect(css).toContain("#F1F1EF");
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (max-width: 1024px)");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain("clip-path");
    expect(css).not.toContain("linear-gradient");
  });

  it("routes the real desktop hash to settings and binds the page actions", () => {
    expect(mainSource).toContain('window.location.hash.startsWith("#/settings")');
    expect(mainSource).toContain("renderSettingsPage");
    expect(mainSource).toContain("settings-page.css");
    expect(mainSource).toContain('data-settings-action="account"');
    expect(mainSource).toContain('data-settings-action="logout"');
  });

  it("restores the focused account field after a failed mutation", () => {
    expect(mainSource).toContain("const settingsFocusField = document.activeElement?.getAttribute(\"name\")");
    expect(mainSource).toContain("focusSettingsField(settingsFocusField ||");
    expect(mainSource).toContain("accountError: message,\n      draft,");
  });

  it("clears stale field errors when API validation fails after draft validation", () => {
    const submitCatch = mainSource.match(
      /  } catch \(error\) \{\n    const code = error instanceof ApiError[\s\S]*?\n  \}\n  if \(isTextModelSettingsRoute\(\)\)/,
    )?.[0];

    expect(submitCatch).toContain("fieldErrors: undefined,");
    expect(submitCatch).toContain("draft,");
    expect(submitCatch).toContain("error: getTextModelErrorMessage(code),");
  });
});
