import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDesktopAppShell, renderDesktopRail } from "./desktop-shell";

describe("DesktopAppShell", () => {
  it("exposes settings as a real active first-level route", () => {
    const settings = renderDesktopRail({ activeSection: "settings", conversationHref: "#/conversation" });

    expect(settings).toContain('class="desktop-nav-link active" href="#/settings"');
    expect(settings).toContain('aria-label="设置"');
    expect(settings).toContain('aria-current="page"');
    expect(settings).not.toContain("暂不可用");
    expect(settings).not.toContain('aria-disabled="true"');
  });

  it("renders conversation and library with the same rail DOM and only changes active state", () => {
    const conversation = renderDesktopRail({ activeSection: "conversation", conversationHref: "#/conversation?stage=outline" });
    const library = renderDesktopRail({ activeSection: "library", conversationHref: "#/conversation?stage=outline" });
    const normalizeActiveState = (html: string) => html
      .replaceAll('class="desktop-nav-link active"', 'class="desktop-nav-link"')
      .replaceAll('class="desktop-nav-link "', 'class="desktop-nav-link"')
      .replaceAll(' aria-current="page"', "");

    expect(normalizeActiveState(conversation)).toBe(normalizeActiveState(library));
    expect(conversation).toContain('class="desktop-nav-link active" href="#/conversation?stage=outline"');
    expect(library).toContain('class="desktop-nav-link active" href="#/library"');
    expect(conversation).toContain('aria-current="page"');
    expect(library).toContain('aria-current="page"');
    expect(conversation).not.toContain("library-rail");
    expect(library).not.toContain("library-rail");
  });

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
    expect(html).toContain('href="#/settings"');
    expect(html).toContain('aria-label="对话"');
    expect(html).toContain('aria-label="读书"');
    expect(html).toContain('href="#/settings" aria-label="设置"');
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("本地演示 · 不调用 AI");
    expect(html).toContain("新建对话 · 暂不可用");
    expect(html).toContain("搜索对话 · 暂不可用");
    expect(html).toContain('disabled aria-label="打开会话列表（暂不可用）"');
  });

  it("keeps the 1200 rail brand and labels on one line without changing nav row height", () => {
    const conversation = renderDesktopRail({ activeSection: "conversation", conversationHref: "#/conversation" });
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(conversation).toContain("<span>设置</span>");
    expect(conversation).toContain('href="#/settings" aria-label="设置"');
    expect(conversation).not.toContain("设置 · 暂不可用");
    expect(styles).toMatch(/@media \(min-width: 1025px\) and \(max-width: 1279px\)[\s\S]*?\.desktop-brand\s*\{[^}]*gap:\s*8px[^}]*padding-left:\s*14px[^}]*padding-right:\s*14px/);
    expect(styles).toMatch(/@media \(min-width: 1025px\) and \(max-width: 1279px\)[\s\S]*?\.desktop-brand img\s*\{[^}]*width:\s*50px[^}]*height:\s*50px/);
    expect(styles).toMatch(/@media \(min-width: 1025px\) and \(max-width: 1279px\)[\s\S]*?\.desktop-brand span,\s*\.desktop-nav-link span\s*\{[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.desktop-nav-link\s*\{[^}]*min-height:\s*56px/);
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

  it("uses the compact column widths at the exact 1024px boundary", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.desktop-app-shell, \.library-shell\s*\{[^}]*--desktop-rail-width:\s*92px/);
    expect(styles).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.desktop-app-shell\s*\{[^}]*--desktop-list-width:\s*196px[^}]*--desktop-task-width:\s*320px/);
    expect(styles).toMatch(/\.desktop-conversation-main,\s*\.conversation-content,\s*\.conversation-thread,\s*\.desktop-message,\s*\.desktop-composer\s*\{[^}]*box-sizing:\s*border-box/);
  });

  it("reuses the reader's Qingci paper-card language for conversation messages", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/--desktop-paper:\s*#f1f1ef/);
    expect(styles).toMatch(/--desktop-ink:\s*#21312d/);
    expect(styles).toMatch(/--desktop-muted:\s*#5f6f69/);
    expect(styles).toMatch(/--desktop-celadon:\s*#0d6a57/);
    expect(styles).toMatch(/--desktop-line:\s*#cbd8d3/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*padding:\s*14px\s+16px/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*border-radius:\s*12px/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*background:\s*var\(--desktop-paper-strong\)/);
    expect(styles).toMatch(/\.desktop-message\s*\{[^}]*box-shadow:\s*0 8px 24px rgba\(42,76,63,\.04\)/);
    expect(styles).toMatch(/\.desktop-message-user\s*\{[^}]*background:\s*var\(--desktop-user-wash\)/);
    expect(styles).toMatch(/\.desktop-message-question\s*\{[^}]*background:\s*var\(--desktop-paper-strong\)/);
    expect(styles).toMatch(/\.desktop-composer\s*\{[^}]*padding:\s*12px\s+14px/);
    expect(styles).toMatch(/\.desktop-stage-summary\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/);
  });

  it("uses a two-column 16:9 template grid when the task panel has room", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-task-panel \.desktop-template-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?\.desktop-task-panel \.desktop-template-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(styles).toMatch(/\.desktop-slide-skeleton\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  });

  it("keeps a connection banner in the center without pushing the short viewport composer below the fold", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.desktop-conversation-scroll:has\(> \.desktop-connection-banner\)\s*\{[^}]*position:\s*relative/);
    expect(styles).toMatch(/\.desktop-conversation-scroll:has\(> \.desktop-connection-banner\) > \.desktop-connection-banner\s*\{[^}]*position:\s*absolute/);
    expect(styles).toMatch(/\.desktop-conversation-scroll:has\(> \.desktop-connection-banner\) > \.conversation-content\s*\{[^}]*padding-top:\s*92px/);
  });
});
