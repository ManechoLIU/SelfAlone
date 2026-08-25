import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  COPY_SUCCESS_CLEAR_MS,
  applyTextReaderMode,
  copyReaderSelection,
  copyStatusClearDelay,
  createTextReaderApi,
  readCachedReaderBackground,
  readerBackgroundCacheKey,
  writeCachedReaderBackground,
  type ReaderBackgroundCacheScope,
} from "./text-reader";
import {
  createTextReaderModel,
  filterTextReaderSections,
  paragraphOffsets,
  READER_RESTORE_GUARD_MS,
  READER_SCROLL_SAVE_DELAY_MS,
  restoreParagraphOffset,
  shouldPersistReaderScroll,
  textReaderParagraphs,
  textReaderViewState,
  type TextReaderApi,
  type TextReaderSnapshot,
} from "./text-reader-state";
import { renderTextReader } from "./text-reader-view";

const snapshot: TextReaderSnapshot = {
  loading: false,
  error: "",
  query: "",
  focusMode: false,
  directoryOpen: false,
  copied: false,
  background: "dark",
  reading: {
    bookId: "book-1",
    title: "雨后山亭",
    author: "林野",
    contentMode: "text",
    fileVersion: 2,
    position: {
      version: 4,
      background: "dark",
      locator: { kind: "text", fileVersion: 2, sectionId: "epub:two", offset: 3 },
    },
  },
  sections: [
    { sectionId: "epub:one", title: "雨停以后", order: 0, text: "第一段。\n\n第二段。" },
    { sectionId: "epub:two", title: "山路尽头", order: 1, text: "亭中有一盏茶。" },
  ],
  pendingSave: null,
  saveError: "",
};

describe("M1-F2-B desktop text reader state", () => {
  it("distinguishes loading, true empty, filtered empty, failure and normal", () => {
    expect(textReaderViewState({ ...snapshot, loading: true, sections: [] })).toBe("loading");
    expect(textReaderViewState({ ...snapshot, reading: null, sections: [] })).toBe("empty");
    expect(textReaderViewState({ ...snapshot, query: "不存在", sections: [] })).toBe("filtered_empty");
    expect(textReaderViewState({ ...snapshot, error: "正文暂时没有载入", sections: [] })).toBe("failure");
    expect(textReaderViewState(snapshot)).toBe("normal");
  });

  it("filters the on-demand directory without changing the full book or position", () => {
    expect(filterTextReaderSections(snapshot.sections, "山路").map((section) => section.sectionId)).toEqual([
      "epub:two",
    ]);
    expect(filterTextReaderSections(snapshot.sections, "没有")).toEqual([]);
    expect(snapshot.reading?.position?.locator).toEqual({
      kind: "text",
      fileVersion: 2,
      sectionId: "epub:two",
      offset: 3,
    });
  });

  it("derives stable paragraph offsets from the original section text", () => {
    expect(paragraphOffsets("第一段。\n\n第二段。\n第三行。")) .toEqual([
      { offset: 0, text: "第一段。" },
      { offset: 6, text: "第二段。\n第三行。" },
    ]);
  });

  it("restores a chapter start to its heading and later offsets to the nearest paragraph", () => {
    const paragraphs = [{ offset: 0 }, { offset: 120 }, { offset: 260 }];
    expect(restoreParagraphOffset(paragraphs, 0)).toBeNull();
    expect(restoreParagraphOffset(paragraphs, 90)).toBe(0);
    expect(restoreParagraphOffset(paragraphs, 200)).toBe(120);
  });

  it("does not persist programmatic restoration scroll as a new user position", () => {
    expect(READER_RESTORE_GUARD_MS).toBeGreaterThan(READER_SCROLL_SAVE_DELAY_MS);
    expect(shouldPersistReaderScroll({ restoringPosition: true, hasVisibleLocator: true })).toBe(false);
    expect(shouldPersistReaderScroll({ restoringPosition: false, hasVisibleLocator: false })).toBe(false);
    expect(shouldPersistReaderScroll({ restoringPosition: false, hasVisibleLocator: true })).toBe(true);
  });

  it("keeps the latest locator and background when saving fails, then retries it", async () => {
    let shouldFail = true;
    const writes: unknown[] = [];
    const api: TextReaderApi = {
      loadReading: async () => snapshot.reading!,
      loadSections: async () => ({ fileVersion: 2, sections: snapshot.sections }),
      savePosition: async (input) => {
        writes.push(input);
        if (shouldFail) throw new Error("POSITION_SAVE_FAILED");
        return { version: 5, locator: input.locator, background: input.background };
      },
    };
    const model = createTextReaderModel("book-1", api);
    await model.load();
    expect(model.snapshot.background).toBe("dark");
    const pending = {
      locator: { kind: "text" as const, fileVersion: 2, sectionId: "epub:one", offset: 5 },
      background: "light" as const,
    };

    await expect(model.save(pending)).rejects.toThrow("POSITION_SAVE_FAILED");
    expect(model.snapshot).toMatchObject({
      pendingSave: pending,
      saveError: "阅读位置没有保存，当前画面已保留；刷新后可能恢复上次选择。",
      reading: { position: { locator: pending.locator, background: "light", version: 4 } },
      background: "light",
    });
    shouldFail = false;
    await model.retrySave();
    expect(writes).toHaveLength(2);
    expect(model.snapshot).toMatchObject({ pendingSave: null, saveError: "", reading: { position: { version: 5 } } });
  });

  it("suppresses a duplicated TXT title line while keeping the source offset", () => {
    expect(textReaderParagraphs({
      sectionId: "txt:00000013",
      title: "第一章 风从海上来",
      order: 1,
      text: "第一章 风从海上来\n第1段：雨线从屋檐落下。\n\n第2段：灯塔亮起。",
    })).toEqual([
      { offset: 10, text: "第1段：雨线从屋檐落下。" },
      { offset: 24, text: "第2段：灯塔亮起。" },
    ]);
    expect(textReaderParagraphs({
      sectionId: "epub:one",
      title: "第一章 风从海上来",
      order: 1,
      text: "第一章 风从海上来\n正文保留 EPUB 原始结构。",
    })).toEqual([{ offset: 0, text: "第一章 风从海上来\n正文保留 EPUB 原始结构。" }]);
  });
});
describe("M1-F2-B desktop text reader view", () => {
  it("constrains the 768px toolbar grid and flex actions to the reading viewport", () => {
    const css = readFileSync(new URL("./text-reader.css", import.meta.url), "utf8");
    const narrowToolbar = css.match(
      /@media \(max-width: 840px\)\s*\{[\s\S]*?\.text-reader-toolbar\s*\{([\s\S]*?)\}/,
    )?.[1] ?? "";
    const toolbar = css.match(/\.text-reader-toolbar\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const heading = css.match(/\.text-reader-heading\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const headingStrong = css.match(/\.text-reader-heading strong\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const actions = css.match(/\.text-reader-actions\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    // At 768px the reader rail consumes 80px, leaving a 688px main viewport.
    // The title track must be allowed to shrink and the action flex row must
    // be allowed to wrap inside the toolbar instead of growing its scroll area.
    expect(narrowToolbar).toMatch(/grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/);
    expect(toolbar).toMatch(/min-width:\s*0/);
    expect(heading).toMatch(/min-width:\s*0/);
    expect(headingStrong).toMatch(/display:\s*block/);
    expect(actions).toMatch(/min-width:\s*0/);
    expect(actions).toMatch(/flex-wrap:\s*wrap/);
    expect(actions).toMatch(/max-width:\s*100%/);
  });

  it("uses a private light/dark shell and falls closed to light without trusted cache", () => {
    const dark = renderTextReader(snapshot);
    const light = renderTextReader({ ...snapshot, background: "light" });

    expect(dark).toContain('class="text-reader-shell is-dark"');
    expect(dark).toContain('data-reader-background="dark"');
    expect(light).toContain('class="text-reader-shell is-light"');
    expect(light).toContain('data-reader-background="light"');
    expect(renderTextReader(createTextReaderModel("book-1", {
      loadReading: async () => snapshot.reading!,
      loadSections: async () => ({ fileVersion: 2, sections: [] }),
      savePosition: async (input) => ({ ...input, version: 1 }),
    }).snapshot)).toContain('class="text-reader-shell is-light"');
  });

  it("isolates trusted background cache by account, book and file version and tolerates storage denial", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const scope: ReaderBackgroundCacheScope = { accountId: "account-a", bookId: "book-1", fileVersion: 2 };
    expect(readerBackgroundCacheKey(scope)).toContain("account-a");
    writeCachedReaderBackground(storage, scope, "dark");
    expect(readCachedReaderBackground(storage, scope)).toBe("dark");
    expect(readCachedReaderBackground(storage, { ...scope, accountId: "account-b" })).toBeNull();
    expect(readCachedReaderBackground(storage, { ...scope, bookId: "book-2" })).toBeNull();
    expect(readCachedReaderBackground(storage, { ...scope, fileVersion: 3 })).toBeNull();
    expect(readCachedReaderBackground(storage, null)).toBeNull();
    const denied = {
      getItem: () => { throw new Error("STORAGE_DENIED"); },
      setItem: () => { throw new Error("STORAGE_DENIED"); },
    };
    expect(readCachedReaderBackground(denied, scope)).toBeNull();
    expect(() => writeCachedReaderBackground(denied, scope, "light")).not.toThrow();
  });

  it("uses a trusted cached background on the first render, then accepts the server position", async () => {
    const api: TextReaderApi = {
      loadReading: async () => snapshot.reading!,
      loadSections: async () => ({ fileVersion: 2, sections: snapshot.sections }),
      savePosition: async (input) => ({ ...input, version: 5 }),
    };
    const model = createTextReaderModel("book-1", api, "dark");
    expect(renderTextReader(model.snapshot)).toContain('class="text-reader-shell is-dark"');
    await model.load();
    expect(model.snapshot.background).toBe("dark");
  });

  it("defines contrasting rail palettes and disables their transition for reduced motion", () => {
    const css = readFileSync(new URL("./text-reader.css", import.meta.url), "utf8");
    const controller = readFileSync(new URL("./text-reader.ts", import.meta.url), "utf8");
    expect(css).toContain("--reader-paper: #fafbf8");
    expect(css).toContain("--reader-rail-bg: #e7eae8");
    expect(css).toContain("--reader-paper: #171b1a");
    expect(css).toContain("--reader-rail-bg: #202624");
    expect(css).toContain("--reader-ink: #edf2ef");
    expect(css).toContain("--reader-muted: #b7c3be");
    expect(css).toContain("--reader-line: #3a4843");
    expect(css).toContain("--reader-rail-active-bg: #2b3833");
    expect(css).toContain("--reader-rail-art-opacity: .34");
    expect(css).toContain("--reader-rail-art-opacity: .08");
    expect(css).not.toContain("min(var(--reader-rail-art-opacity)");
    expect(css).toContain("background: var(--reader-rail-bg)");
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*?\.text-reader-rail[\s\S]*?transition: none/);
    expect(css).not.toContain("is-background-pending");
    expect(controller).toContain('querySelector<HTMLButtonElement>("button[data-reader-background]")');
  });

  it("renders the shared shell, one continuous body and retained focus controls", () => {
    const html = renderTextReader({ ...snapshot, focusMode: true, directoryOpen: true });
    expect(html).toContain('class="text-reader-shell is-focus is-dark"');
    expect(html).toContain('aria-label="主导航"');
    expect(html).toContain('aria-label="阅读工具"');
    expect(html).toContain('aria-label="打开目录"');
    expect(html).toContain('aria-label="切换阅读背景"');
    expect(html).toContain('aria-label="退出专注阅读"');
    expect(html).toContain('aria-label="复制所选正文"');
    expect(html).toContain("和老己聊聊");
    expect(html).toContain('role="dialog" aria-modal="false" aria-label="目录"');
    expect(html).not.toContain("text-reader-scrim");
    expect(html).toContain('aria-controls="text-reader-directory"');
    expect(html).toContain('tabindex="0" aria-label="正文阅读区"');
    expect(html).toContain('data-section-id="epub:one"');
    expect(html).toContain('data-section-id="epub:two"');
    expect(html).not.toContain("继续阅读本章");
    expect(html).not.toContain("laoji-mascot-seated-reading");
  });

  it("leaves a private annotation and book-detail seam inside the reader without changing the shared route", () => {
    const html = renderTextReader(snapshot);
    expect(html).toContain('data-text-annotation-root');
    expect(html).toContain('data-reader-book-detail');
    expect(html).toContain("划线与笔记");
    expect(html).toMatch(/data-reader-book-detail[^>]*>[\s\S]*<svg/);
  });

  it("renders persisted highlights as real marks without turning the first line into a title", () => {
    const html = renderTextReader({
      ...snapshot,
      highlights: [{
        id: "highlight-1",
        bookId: "book-1",
        locator: { kind: "text", fileVersion: 2, sectionId: "epub:one", offset: 0 },
        endOffset: 3,
        quote: "第一段",
        thought: null,
        version: 1,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }],
    });
    expect(html).toContain('data-annotation-highlight-id="highlight-1"');
    expect(html).toContain("<mark");
    expect(html).not.toContain('name="title"');
  });

  it("removes non-reading toolbar actions and empty grid columns in focus mode", () => {
    const css = readFileSync(new URL("./text-reader.css", import.meta.url), "utf8");
    expect(css).toMatch(
      /\.text-reader-shell\.is-focus \.text-reader-toolbar > a\[aria-label="返回书架"\],[\s\S]*?\.text-reader-shell\.is-focus \[data-reader-chat\]\s*\{\s*display: none;\s*\}/,
    );
    expect(css).toMatch(
      /\.text-reader-shell\.is-focus \.text-reader-toolbar\s*\{[^}]*display: flex;[^}]*justify-content: flex-end;[^}]*\}/,
    );
  });

  it("removes the focused reader rail from access and hit testing", () => {
    const css = readFileSync(new URL("./text-reader.css", import.meta.url), "utf8");
    expect(css).toMatch(
      /\.text-reader-shell\.is-focus \.text-reader-rail\s*\{[^}]*transform: translateX\(-100%\);[^}]*visibility: hidden;[^}]*pointer-events: none;[^}]*\}/,
    );
  });

  it("does not leave aria-controls dangling and disables tools only without retained content", () => {
    const closed = renderTextReader({ ...snapshot, directoryOpen: false });
    expect(closed).not.toContain('aria-controls="text-reader-directory"');
    const empty = renderTextReader({ ...snapshot, reading: null, sections: [] });
    expect(empty).toContain("data-reader-directory aria-label=\"打开目录\" aria-expanded=\"false\" disabled");
    expect(empty).toContain("data-reader-background aria-label=\"切换阅读背景\" aria-pressed=\"true\" disabled");
    const retained = renderTextReader({ ...snapshot, saveError: "保存失败" });
    expect(retained).not.toContain("data-reader-background aria-label=\"切换阅读背景\" aria-pressed=\"true\" disabled");
  });

  it("keeps the failure state actionable and preserves a dedicated retry for position saving", () => {
    const failure = renderTextReader({ ...snapshot, error: "正文服务暂时不可用", sections: [] });
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("重新载入");
    const saveFailure = renderTextReader({ ...snapshot, saveError: "阅读位置没有保存，当前画面已保留；刷新后可能恢复上次选择。" });
    expect(saveFailure).toContain("刷新后可能恢复上次选择");
    expect(saveFailure).toContain("重试保存");
  });

  it("reports clipboard success and failure without rejecting", async () => {
    const ok = vi.fn(async () => undefined);
    await expect(copyReaderSelection("序章", ok)).resolves.toBe("已复制所选正文");
    expect(ok).toHaveBeenCalledWith("序章");
    await expect(copyReaderSelection("序章", async () => { throw new Error("DENIED"); }))
      .resolves.toBe("复制失败，选区已保留，请重试。");
    expect(copyStatusClearDelay("已复制所选正文")).toBe(COPY_SUCCESS_CLEAR_MS);
    expect(COPY_SUCCESS_CLEAR_MS).toBeGreaterThanOrEqual(2_000);
    expect(COPY_SUCCESS_CLEAR_MS).toBeLessThanOrEqual(3_000);
    expect(copyStatusClearDelay("复制失败，选区已保留，请重试。")).toBeNull();
  });

  it("patches theme and focus controls in place without replacing the reader DOM", () => {
    const classes = new Set(["text-reader-shell", "is-light"]);
    const shell = {
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
          return Boolean(force);
        },
      },
      dataset: { readerBackground: "light" },
    };
    const backgroundAttributes = new Map<string, string>();
    const focusAttributes = new Map<string, string>();
    const backgroundButton = {
      setAttribute: (name: string, value: string) => void backgroundAttributes.set(name, value),
    };
    const focusButton = {
      setAttribute: (name: string, value: string) => void focusAttributes.set(name, value),
    };
    const root = {
      querySelector: (selector: string) => {
        if (selector === ".text-reader-shell") return shell;
        if (selector === "button[data-reader-background]") return backgroundButton;
        if (selector === "[data-reader-focus]") return focusButton;
        return null;
      },
      set innerHTML(_value: string) {
        throw new Error("reader DOM was replaced");
      },
    } as unknown as HTMLElement;

    expect(() => applyTextReaderMode(root, { background: "dark", focusMode: true })).not.toThrow();
    expect(classes).toEqual(new Set(["text-reader-shell", "is-dark", "is-focus"]));
    expect(shell.dataset.readerBackground).toBe("dark");
    expect(backgroundAttributes.get("aria-pressed")).toBe("true");
    expect(focusAttributes).toEqual(new Map([
      ["aria-pressed", "true"],
      ["aria-label", "退出专注阅读"],
    ]));
  });

  it("uses the frozen reading, sections and expected-version position routes", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot.reading), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileVersion: 2, sections: snapshot.sections }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 5,
        locator: snapshot.reading?.position?.locator,
        background: "light",
      }), { status: 200 }));
    const api = createTextReaderApi("book-1", fetcher);
    await api.loadReading();
    await api.loadSections();
    await api.savePosition({
      expectedVersion: 4,
      locator: snapshot.reading!.position!.locator,
      background: "light",
    });

    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method ?? "GET"])).toEqual([
      ["/api/v1/books/book-1/reading", "GET"],
      ["/api/v1/books/book-1/content/sections", "GET"],
      ["/api/v1/books/book-1/position", "PUT"],
    ]);
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({
      expectedVersion: 4,
      locator: snapshot.reading!.position!.locator,
      background: "light",
    }));
  });
});
