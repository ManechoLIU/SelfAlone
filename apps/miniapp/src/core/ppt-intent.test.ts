import { describe, expect, it } from "vitest";
import { createPptIntentStore, type PptIntentStorage } from "./ppt-intent";

function memoryStorage(): PptIntentStorage {
  const values = new Map<string, unknown>();
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
}

describe("development PPT draft/context handoff", () => {
  it("writes a versioned draft with real book context and no task before sending", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: true });

    const handoff = store.selectBook({
      id: "book-a",
      title: "甲书",
      author: "甲作者",
      source: "local",
      sourceLabel: "已导入",
      coverUrl: "/covers/book-a.png",
      coverVariant: 2,
    });

    expect(handoff).toMatchObject({
      version: 2,
      conversationId: "development-current",
      bookId: "book-a",
      bookTitle: "甲书",
      author: "甲作者",
      source: "local",
      sourceLabel: "已导入",
      coverUrl: "/covers/book-a.png",
      coverVariant: 2,
      draft: "帮我制作这本书PPT",
      phase: "draft",
    });
    expect(handoff).not.toHaveProperty("taskId");
    expect(store.workspaceUrl()).toBeNull();
  });

  it("restores and updates the editable draft without activating PPT flow", () => {
    const storage = memoryStorage();
    const firstStore = createPptIntentStore(storage, { developmentAdapter: true });
    firstStore.selectBook({ id: "book-a", title: "甲书" });
    firstStore.updateDraft("帮我制作这本书PPT，重点讲第二章");

    const restoredStore = createPptIntentStore(storage, { developmentAdapter: true });
    expect(restoredStore.restore()).toMatchObject({
      bookId: "book-a",
      bookTitle: "甲书",
      draft: "帮我制作这本书PPT，重点讲第二章",
      phase: "draft",
    });
    expect(restoredStore.workspaceUrl()).toBeNull();
  });

  it("enters confirmation only after activation and opens the workspace after confirmation", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: true });
    store.selectBook({ id: "book-a", title: "甲书" });

    const activated = store.activate();
    expect(activated).toMatchObject({ phase: "awaiting-confirmation", bookId: "book-a" });
    expect(activated).not.toHaveProperty("taskId");
    expect(store.workspaceUrl()).toBeNull();

    const confirmed = store.confirm();
    expect(confirmed).toMatchObject({ phase: "requirements-ready", bookId: "book-a" });
    expect(store.workspaceUrl()).toBe("/pages/ppt/index?bookId=book-a");
  });

  it("keeps the same conversation when another book starts a new handoff", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: true });
    const first = store.selectBook({ id: "book-a", title: "甲书" });
    const second = store.selectBook({ id: "book-b", title: "乙书" });

    expect(second?.conversationId).toBe(first?.conversationId);
    expect(second?.bookId).toBe("book-b");
    expect(second?.phase).toBe("draft");
    expect(second).not.toHaveProperty("taskId");
  });

  it("fails closed outside the development adapter", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: false });
    expect(store.selectBook({ id: "book-a", title: "甲书" })).toBeNull();
    expect(store.restore()).toBeNull();
    expect(store.activate()).toBeNull();
    expect(store.confirm()).toBeNull();
    expect(store.workspaceUrl()).toBeNull();
  });
});
