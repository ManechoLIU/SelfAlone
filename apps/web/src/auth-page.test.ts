import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAuthState } from "./auth-state";
import { bindAuthModeInteractions, renderAuthPage } from "./auth-page";

const authStyles = readFileSync(new URL("./styles.css", import.meta.url), "utf8").slice(
  readFileSync(new URL("./styles.css", import.meta.url), "utf8").indexOf("/* Desktop account entry"),
);
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("desktop auth page", () => {
  it("keeps WeChat as the primary entry and does not expose a QR placeholder", () => {
    const html = renderAuthPage(createAuthState("entry"));
    expect(html).toContain("遇见自己，爱你老己");
    expect(html).toContain("微信登录");
    expect(html).toContain("邮箱登录");
    expect(html).not.toContain("二维码");
    expect(html).not.toContain("开发");
    expect(html).not.toContain("fixture");
    expect(html).not.toContain("模拟");
    expect(html).not.toContain("测试");
  });

  it("renders accessible email fields and preserves an inline failure", () => {
    const state = {
      ...createAuthState("login"),
      phase: "unauthenticated" as const,
      email: "reader@example.com",
      fieldErrors: { email: "请输入有效的邮箱地址。" },
      formError: "邮箱或密码不正确，请检查后重试。",
    };
    const html = renderAuthPage(state);
    expect(html).toContain('data-auth-form="login"');
    expect(html).toContain('id="auth-email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("邮箱或密码不正确，请检查后重试。");
    expect(html).toContain("reader@example.com");
  });

  it("opens a closable fail-closed WeChat dialog", () => {
    const html = renderAuthPage(createAuthState("entry"), true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("微信登录暂不可用");
    expect(html).toContain("关闭微信登录提示");
  });

  it("keeps the approved ink-page relationship without an unsupported auth background", () => {
    expect(authStyles).not.toContain("grid-template-columns: minmax(380px, 1fr) minmax(380px, 1fr);");
    expect(authStyles).toContain('background: url("/backgrounds/desktop-left-rail-vintage-transparent-v2.png")');
    expect(authStyles).not.toContain('background: url("/backgrounds/desktop-right-distant-mountains-transparent-v1.png")');
    expect(authStyles).toContain("width: min(376px");
  });

  it("marks the fail-closed dialog focus scope and initial close target", () => {
    const html = renderAuthPage(createAuthState("entry"), true);
    expect(html).toContain('data-auth-dialog="true"');
    expect(html).toContain('data-auth-dialog-initial-focus="true"');
    expect(html).toContain('aria-describedby="wechat-dialog-description"');
  });

  it("wires Escape and bounded Tab navigation for the dialog lifecycle", () => {
    expect(mainSource).toContain('event.key === "Escape"');
    expect(mainSource).toContain('event.key !== "Tab"');
    expect(mainSource).toContain("data-auth-dialog-initial-focus");
    expect(mainSource).toContain("data-auth-wechat");
  });

  it.each(["entry", "login", "register"] as const)(
    "keeps exactly one WeChat primary action before the email content in %s",
    (mode) => {
      const html = renderAuthPage(createAuthState(mode));
      expect(html.match(/data-auth-wechat/g)).toHaveLength(1);
      const wechatIndex = html.indexOf("data-auth-wechat");
      expect(wechatIndex).toBeGreaterThan(-1);
      if (mode === "entry") {
        expect(html).toContain("邮箱登录");
        expect(html.indexOf("邮箱登录")).toBeGreaterThan(wechatIndex);
      } else {
        expect(html).toContain(`data-auth-form="${mode}"`);
        expect(html.indexOf(`data-auth-form="${mode}"`)).toBeGreaterThan(wechatIndex);
      }
    },
  );

  it("renders the divider and the active tab indicator as real DOM nodes", () => {
    const html = renderAuthPage(createAuthState("login"));
    expect(html).toContain("auth-divider-line");
    expect(html).toContain("auth-tab-indicator");
  });

  it("removes all five historical Auth pseudo-element selector groups", () => {
    for (const selector of [
      ".auth-brand-panel::before",
      ".auth-brand-panel::after",
      ".auth-tab.is-active::after",
      ".auth-divider::before",
      ".auth-divider::after",
    ]) {
      expect(authStyles).not.toContain(selector);
    }
  });


  it("renders a single roving tab stop and a labelled tab panel", () => {
    const html = renderAuthPage(createAuthState("login"));
    expect(html).toContain('aria-controls="auth-panel" tabindex="0"');
    expect(html).toContain('aria-controls="auth-panel" tabindex="-1"');
    expect(html).toContain('id="auth-panel" role="tabpanel" aria-labelledby="auth-tab-login"');
  });

  it("activates roving tabs from real click and keydown events", () => {
    class Tab extends EventTarget { dataset: { authMode?: string }; focused = 0; constructor(mode: string) { super(); this.dataset = { authMode: mode }; } focus() { this.focused += 1; } }
    const login = new Tab("login"); const register = new Tab("register"); const modes: Array<[string, { email: string; password: string; confirmPassword: string }]> = [];
    let draft = { email: "a@b.com", password: "password", confirmPassword: "password" };
    const unbind = bindAuthModeInteractions([login, register], () => draft, (mode, snapshot) => modes.push([mode, snapshot]));
    login.dispatchEvent(new Event("click"));
    const right = new Event("keydown", { cancelable: true }); Object.defineProperty(right, "key", { value: "ArrowRight" }); login.dispatchEvent(right);
    expect(modes).toEqual([["login", draft], ["register", draft]]); expect(register.focused).toBe(1); expect(right.defaultPrevented).toBe(true);
    unbind(); login.dispatchEvent(new Event("click")); expect(modes).toHaveLength(2);
  });
});
