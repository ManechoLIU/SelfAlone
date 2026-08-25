import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDesktopAppShell } from "./desktop-shell";

describe("DesktopAppShell", () => {
  it("keeps the four-zone conversation hierarchy and semantic first-level navigation", () => {
    const html = renderDesktopAppShell({
      activeSection: "conversation",
      currentConversation: { title: "《长安的荔枝》读书分享", meta: "范围与需求" },
      conversationList: [
        { id: "conversation-1", title: "《长安的荔枝》读书分享", meta: "范围与需求", active: true },
      ],
      mainContent: "<p>conversation</p>",
      taskPanel: "<p>task</p>",
    });

    expect(html).toContain('class="desktop-rail"');
    expect(html).toContain('class="desktop-conversation-list"');
    expect(html).toContain('class="desktop-conversation-main"');
    expect(html).toContain('class="desktop-task-panel"');
    expect(html).toContain('href="#/conversation"');
    expect(html).toContain('href="#/library"');
    expect(html).not.toContain('href="#/settings"');
    expect(html).toContain('aria-label="对话"');
    expect(html).toContain('aria-label="读书"');
    expect(html).toContain('<span class="desktop-nav-link desktop-nav-link-disabled" role="button" tabindex="0" aria-disabled="true" aria-label="设置（暂不可用）"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("本地演示 · 不调用 AI");
    expect(html).toContain("新建对话 · 暂不可用");
    expect(html).toContain("搜索对话 · 暂不可用");
    expect(html).toContain('disabled aria-label="打开会话列表（暂不可用）"');
  });

  it("renders one reconnect action while preserving the visible shell", () => {
    const html = renderDesktopAppShell({
      activeSection: "conversation",
      currentConversation: { title: "《长安的荔枝》读书分享", meta: "生成中" },
      conversationList: [],
      mainContent: "<p>recent task</p>",
      connectionError: "暂时无法连接老己服务",
    });

    expect(html.match(/id="reconnect-workspace"/g)).toHaveLength(1);
    expect(html).toContain("recent task");
    expect(html).toContain("不会清空当前输入或已完成页面");
    expect(html.indexOf('class="desktop-connection-banner"')).toBeGreaterThan(
      html.indexOf('class="desktop-conversation-scroll"'),
    );
  });

  it("keeps compact navigation and search controls at the touch target", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-conversation-search input\s*\{[^}]*min-height:\s*44px/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?\.desktop-primary-nav\s*\{[^}]*margin-left:\s*12px[^}]*margin-right:\s*12px/);
    expect(styles).toMatch(/\.desktop-reconnect, \.desktop-secondary-button\s*\{[^}]*min-height:\s*44px/);
  });

  it("bounds desktop content to the viewport while letting compact stages flow below it", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-app-shell\s*\{[\s\S]*height:\s*100vh[;\s]/);
    expect(styles).toMatch(/\.desktop-rail,\s*\.desktop-conversation-list,\s*\.desktop-conversation-main,\s*\.desktop-task-panel\s*\{[^}]*min-height:\s*0/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?\.desktop-app-shell\s*\{[^}]*height:\s*auto/);
  });

  it("reuses the reader's Qingci paper-card language for conversation messages", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*padding:\s*19px\s+22px/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*border-radius:\s*5px\s+18px\s+18px\s+18px/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*background:\s*rgba\(255,255,255,\.82\)/);
  });

  it("uses a two-column 16:9 template grid when the task panel has room", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-task-panel \.desktop-template-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?\.desktop-task-panel \.desktop-template-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(styles).toMatch(/\.desktop-slide-skeleton\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  });
});
