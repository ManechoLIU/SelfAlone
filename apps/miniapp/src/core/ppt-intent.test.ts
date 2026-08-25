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

describe("development PPT conversation intent", () => {
  it("reuses the current conversation when another book starts a PPT intent", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: true });
    const first = store.selectBook({ id: "book-a", title: "甲书" });
    const second = store.selectBook({ id: "book-b", title: "乙书" });

    expect(first?.conversationId).toBe("development-current");
    expect(second).toMatchObject({
      conversationId: first?.conversationId,
      bookId: "book-b",
      bookTitle: "乙书",
      phase: "awaiting-confirmation",
    });
    expect(second?.taskId).not.toBe(first?.taskId);
  });

  it("restores the selected book after a new store instance and gates the workspace until confirmation", () => {
    const storage = memoryStorage();
    const firstStore = createPptIntentStore(storage, { developmentAdapter: true });
    firstStore.selectBook({ id: "book-a", title: "甲书" });

    const restoredStore = createPptIntentStore(storage, { developmentAdapter: true });
    expect(restoredStore.restore()).toMatchObject({ bookId: "book-a", phase: "awaiting-confirmation" });
    expect(restoredStore.workspaceUrl()).toBeNull();

    const confirmed = restoredStore.confirm();
    expect(confirmed?.phase).toBe("requirements-ready");
    expect(restoredStore.workspaceUrl()).toBe(
      "/pages/ppt/index?bookId=book-a&intentId=development-ppt-book-a",
    );
    restoredStore.clear();
    expect(restoredStore.restore()).toBeNull();
  });

  it("fails closed outside the development adapter", () => {
    const store = createPptIntentStore(memoryStorage(), { developmentAdapter: false });
    expect(store.selectBook({ id: "book-a", title: "甲书" })).toBeNull();
    expect(store.restore()).toBeNull();
    expect(store.confirm()).toBeNull();
    expect(store.workspaceUrl()).toBeNull();
  });
});
