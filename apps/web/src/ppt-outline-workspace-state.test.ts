import { describe, expect, it } from "vitest";
import type { PptOutlineParagraph, PptOutlineSnapshot } from "./ppt-outline-workspace-client";
import { PptOutlineClientError } from "./ppt-outline-workspace-client";
import {
  countOutlinePages,
  createPptOutlineWorkspaceStore,
  findOrphanParagraphIds,
  indentParagraph,
  mergeParagraphWithPrevious,
  outdentParagraph,
  removeEmptyParagraph,
  serializeOutlineForSave,
  splitParagraph,
  updateParagraphText,
} from "./ppt-outline-workspace-state";

const paragraphs: PptOutlineParagraph[] = [
  { id: "page-1", level: 1, text: "第一页" },
  { id: "point-1", level: 2, text: "要点一" },
  { id: "detail-1", level: 3, text: "说明一" },
  { id: "page-2", level: 1, text: "第二页" },
];

function snapshot(overrides: Partial<PptOutlineSnapshot> = {}): PptOutlineSnapshot {
  return {
    version: 3,
    pageCount: 2,
    paragraphs,
    publicSources: [{
      url: "https://publisher.example.invalid/catalog/book",
      title: "出版社公开目录",
      publishedAt: null,
      fetchedAt: "2026-09-06T00:00:00.000Z",
      usageScope: "outline:draft-1",
    }],
    ...overrides,
  };
}

function createScheduler() {
  const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
  return {
    scheduled,
    schedule(callback: () => void, delayMs: number) {
      scheduled.push({ delayMs, callback });
      return scheduled.length;
    },
    clear() {
      scheduled.length = 0;
    },
    flush() {
      const pending = scheduled.splice(0, scheduled.length);
      for (const item of pending) item.callback();
    },
  };
}

describe("PPT outline paragraph ops", () => {
  it("counts only level-1 paragraphs as pages", () => {
    expect(countOutlinePages(paragraphs)).toBe(2);
    expect(countOutlinePages([{ id: "x", level: 2, text: "孤儿" }])).toBe(0);
    expect(countOutlinePages([])).toBe(0);
  });

  it("flags level-2/3 paragraphs that lost their page hierarchy", () => {
    expect(findOrphanParagraphIds(paragraphs)).toEqual([]);
    expect(findOrphanParagraphIds([
      { id: "point-1", level: 2, text: "没有页面" },
    ])).toEqual(["point-1"]);
    expect(findOrphanParagraphIds([
      { id: "page-1", level: 1, text: "页面" },
      { id: "detail-1", level: 3, text: "没有要点" },
    ])).toEqual(["detail-1"]);
    expect(findOrphanParagraphIds([
      { id: "page-1", level: 1, text: "页面" },
      { id: "point-1", level: 2, text: "要点" },
      { id: "page-2", level: 1, text: "" },
      { id: "point-2", level: 2, text: "跨页要点" },
    ])).toEqual([]);
  });

  it("updates only the targeted paragraph text", () => {
    const next = updateParagraphText(paragraphs, "point-1", "改后要点");
    expect(next.find((p) => p.id === "point-1")?.text).toBe("改后要点");
    expect(next.find((p) => p.id === "page-1")?.text).toBe("第一页");
    expect(paragraphs.find((p) => p.id === "point-1")?.text).toBe("要点一");
  });

  it("splits at the cursor and inherits the current level on Enter", () => {
    const result = splitParagraph(paragraphs, "point-1", 2, "point-2");
    expect(result).not.toBeNull();
    expect(result?.paragraphs.map((p) => [p.id, p.level, p.text])).toEqual([
      ["page-1", 1, "第一页"],
      ["point-1", 2, "要点"],
      ["point-2", 2, "一"],
      ["detail-1", 3, "说明一"],
      ["page-2", 1, "第二页"],
    ]);
    expect(result?.focus).toEqual({ id: "point-2", offset: 0 });
  });

  it("indents only when the previous paragraph can parent the new child level", () => {
    // A point directly under a page cannot skip to detail level (previous is the page).
    expect(indentParagraph(paragraphs, "point-1").find((p) => p.id === "point-1")?.level).toBe(2);
    // A page following a deeper paragraph can become that paragraph's child level.
    expect(indentParagraph(paragraphs, "page-2").find((p) => p.id === "page-2")?.level).toBe(2);
    // The first paragraph has no parent candidate and stays put.
    const blocked = indentParagraph([{ id: "page-1", level: 1, text: "唯一" }], "page-1");
    expect(blocked[0].level).toBe(1);
    // A point following another point under the same page can become a detail.
    const nested = indentParagraph([
      { id: "page-1", level: 1, text: "页面" },
      { id: "point-1", level: 2, text: "要点" },
      { id: "point-2", level: 2, text: "要点二" },
    ], "point-2");
    expect(nested.find((p) => p.id === "point-2")?.level).toBe(3);
    // Level 3 is the deepest level.
    const levelThree = indentParagraph(paragraphs, "detail-1");
    expect(levelThree.find((p) => p.id === "detail-1")?.level).toBe(3);
  });

  it("outdents one level but never above page level", () => {
    expect(outdentParagraph(paragraphs, "detail-1").find((p) => p.id === "detail-1")?.level).toBe(2);
    expect(outdentParagraph(paragraphs, "point-1").find((p) => p.id === "point-1")?.level).toBe(1);
    expect(outdentParagraph(paragraphs, "page-1").find((p) => p.id === "page-1")?.level).toBe(1);
  });

  it("deletes an empty paragraph and focuses the previous paragraph end", () => {
    const withEmpty: PptOutlineParagraph[] = [
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-1", level: 2, text: "" },
    ];
    const result = removeEmptyParagraph(withEmpty, "point-1");
    expect(result?.paragraphs).toHaveLength(1);
    expect(result?.focus).toEqual({ id: "page-1", offset: 3 });
    expect(removeEmptyParagraph(withEmpty, "page-1")).toBeNull();
    expect(removeEmptyParagraph([{ id: "only", level: 1, text: "" }], "only")).toBeNull();
  });

  it("merges a level-1 paragraph into the previous one on paragraph-start Backspace", () => {
    const result = mergeParagraphWithPrevious(paragraphs, "page-2");
    expect(result?.paragraphs.map((p) => [p.id, p.level, p.text])).toEqual([
      ["page-1", 1, "第一页"],
      ["point-1", 2, "要点一"],
      ["detail-1", 3, "说明一第二页"],
    ]);
    expect(result?.focus).toEqual({ id: "detail-1", offset: 3 });
    expect(mergeParagraphWithPrevious(paragraphs, "page-1")).toBeNull();
  });

  it("serializes trimmed non-empty paragraphs for the frozen PUT", () => {
    expect(serializeOutlineForSave([
      { id: "page-1", level: 1, text: "  第一页  " },
      { id: "point-1", level: 2, text: "   " },
      { id: "point-2", level: 2, text: "要点" },
    ])).toEqual([
      { id: "page-1", level: 1, text: "第一页" },
      { id: "point-2", level: 2, text: "要点" },
    ]);
  });
});

describe("PPT outline workspace store", () => {
  it("stays hidden until a recovered or generated outline becomes ready", () => {
    const store = createPptOutlineWorkspaceStore({
      save: async () => snapshot({ version: 4 }),
      recover: async () => null,
    });
    expect(store.getState()).toEqual({ phase: "hidden" });
    expect(store.currentVersion()).toBeNull();

    store.ready("draft-1", snapshot());
    const state = store.getState();
    expect(state).toMatchObject({
      phase: "ready",
      draftId: "draft-1",
      version: 3,
      paragraphs,
      saveStatus: "saved",
      dirty: false,
    });
    expect(store.currentVersion()).toBe(3);
    store.hide();
    expect(store.getState()).toEqual({ phase: "hidden" });
  });

  it("autosaves through PUT 300-500ms after an edit and adopts only the response version", async () => {
    const scheduler = createScheduler();
    const saves: Array<{ draftId: string; expectedVersion: number; paragraphs: PptOutlineParagraph[] }> = [];
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        saves.push(input);
        return snapshot({ version: input.expectedVersion + 1, publicSources: [] });
      },
      recover: async () => null,
    });
    store.ready("draft-1", snapshot());

    store.editText("point-1", "改后要点");
    expect(store.getState()).toMatchObject({ saveStatus: "pending", dirty: true });
    expect(scheduler.scheduled).toHaveLength(1);
    expect(scheduler.scheduled[0].delayMs).toBeGreaterThanOrEqual(300);
    expect(scheduler.scheduled[0].delayMs).toBeLessThanOrEqual(500);

    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ draftId: "draft-1", expectedVersion: 3 });
    expect(saves[0].paragraphs.find((p) => p.id === "point-1")?.text).toBe("改后要点");
    const state = store.getState();
    expect(state).toMatchObject({ phase: "ready", version: 4, saveStatus: "saved", dirty: false });
    // The PUT response carries no provenance rows; the generated provenance stays visible.
    expect(state.phase === "ready" && state.publicSources).toHaveLength(1);
    expect(state.phase === "ready" && state.paragraphs.find((p) => p.id === "point-1")?.text).toBe("改后要点");
  });

  it("serializes without transient empty paragraphs and skips the network call while orphans block", async () => {
    const scheduler = createScheduler();
    const saves: unknown[] = [];
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        saves.push(input);
        return snapshot({ version: input.expectedVersion + 1 });
      },
      recover: async () => null,
      idFactory: () => "new-1",
    });
    store.ready("draft-1", snapshot());

    store.split("point-1", 3);
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect((saves[0] as { paragraphs: PptOutlineParagraph[] }).paragraphs.some((p) => p.id === "new-1")).toBe(false);

    store.ready("draft-1", snapshot({
      paragraphs: [{ id: "point-1", level: 2, text: "孤儿要点" }],
    }));
    store.editText("point-1", "仍是孤儿");
    scheduler.flush();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(store.getState()).toMatchObject({ saveBlocked: true, orphanIds: ["point-1"] });
  });

  it("keeps local text and focus-owned state on save failure and retries inline", async () => {
    const scheduler = createScheduler();
    let attempts = 0;
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        attempts += 1;
        if (attempts === 1) throw new PptOutlineClientError(503, "PPT_OUTLINE_ADAPTER_NOT_CONFIGURED");
        return snapshot({ version: input.expectedVersion + 1 });
      },
      recover: async () => null,
    });
    store.ready("draft-1", snapshot());
    store.editText("page-1", "失败时保留的本地文本");
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let state = store.getState();
    expect(state).toMatchObject({ saveStatus: "failed", dirty: true, version: 3 });
    expect(state.phase === "ready" && state.paragraphs.find((p) => p.id === "page-1")?.text).toBe("失败时保留的本地文本");

    await store.retrySave();
    state = store.getState();
    expect(state).toMatchObject({ saveStatus: "saved", version: 4, dirty: false });
    expect(state.phase === "ready" && state.paragraphs.find((p) => p.id === "page-1")?.text).toBe("失败时保留的本地文本");
  });

  it("recovers through GET on PPT_WORKSPACE_STALE without discarding unpersisted local edits", async () => {
    const scheduler = createScheduler();
    const recoveries: string[] = [];
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async () => {
        throw new PptOutlineClientError(409, "PPT_WORKSPACE_STALE");
      },
      recover: async (draftId) => {
        recoveries.push(draftId);
        return snapshot({
          version: 9,
          paragraphs: [{ id: "page-server", level: 1, text: "服务器版本" }],
        });
      },
    });
    store.ready("draft-1", snapshot());
    store.editText("page-1", "尚未保存的本地修改");
    scheduler.flush();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(recoveries).toEqual(["draft-1"]);
    const state = store.getState();
    expect(state).toMatchObject({ saveStatus: "failed", version: 9, dirty: true });
    expect(state.phase === "ready" && state.paragraphs.some((p) => p.id === "page-1")).toBe(true);
    expect(state.phase === "ready" && state.paragraphs.find((p) => p.id === "page-1")?.text).toBe("尚未保存的本地修改");
    expect(state.phase === "ready" && state.paragraphs.some((p) => p.id === "page-server")).toBe(false);
  });

  it("runs structural keyboard ops through the store and reschedules the autosave", async () => {
    const scheduler = createScheduler();
    const saves: Array<{ paragraphs: PptOutlineParagraph[] }> = [];
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        saves.push(input);
        return snapshot({ version: input.expectedVersion + 1 });
      },
      recover: async () => null,
      idFactory: () => "new-1",
    });
    store.ready("draft-1", snapshot());

    expect(store.split("point-1", 2)).toEqual({ id: "new-1", offset: 0 });
    expect(store.indent("new-1")).toBe(true);
    expect(store.outdent("new-1")).toBe(true);
    expect(store.backspaceAtStart("page-2")).toEqual({ kind: "merged", focus: { id: "detail-1", offset: 3 } });

    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0].paragraphs.map((p) => [p.id, p.level, p.text])).toEqual([
      ["page-1", 1, "第一页"],
      ["point-1", 2, "要点"],
      ["new-1", 2, "一"],
      ["detail-1", 3, "说明一第二页"],
    ]);
  });

  it("resaves when edits arrive during an in-flight save", async () => {
    const scheduler = createScheduler();
    const saves: number[] = [];
    let resolveFirst: ((snapshot: PptOutlineSnapshot) => void) | null = null;
    const store = createPptOutlineWorkspaceStore({
      schedule: scheduler.schedule,
      clearScheduled: scheduler.clear,
      save: async (input) => {
        saves.push(input.expectedVersion);
        if (saves.length === 1) {
          return new Promise<PptOutlineSnapshot>((resolve) => { resolveFirst = resolve; });
        }
        return snapshot({ version: input.expectedVersion + 1 });
      },
      recover: async () => null,
    });
    store.ready("draft-1", snapshot());
    store.editText("page-1", "第一版修改");
    scheduler.flush();
    await Promise.resolve();
    expect(saves).toEqual([3]);

    store.editText("page-1", "第二版修改");
    const completeFirstSave = resolveFirst as ((next: PptOutlineSnapshot) => void) | null;
    expect(completeFirstSave).not.toBeNull();
    completeFirstSave?.(snapshot({ version: 4 }));
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    scheduler.flush();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(saves).toEqual([3, 4]);
    expect(store.getState()).toMatchObject({ saveStatus: "saved", version: 5, dirty: false });
  });
});
