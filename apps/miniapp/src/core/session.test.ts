import { describe, expect, it } from "vitest";
import { createSessionStore, type KeyValueStorage } from "./session";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, unknown>();
  return {
    get: (key) => values.get(key),
    remove: (key) => values.delete(key),
    set: (key, value) => values.set(key, value),
  };
}

describe("miniapp session security", () => {
  it("starts signed out and refuses a development session outside development", () => {
    const store = createSessionStore(memoryStorage(), { developmentAdapter: false });
    expect(store.restore()).toEqual({ kind: "signed-out" });
    expect(() => store.startDevelopmentSession()).toThrow("DEVELOPMENT_SESSION_DISABLED");
    expect(store.restore()).toEqual({ kind: "signed-out" });
  });

  it("restores only an explicitly started local development session", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage, { developmentAdapter: true });
    expect(store.startDevelopmentSession()).toEqual({ kind: "development" });
    expect(createSessionStore(storage, { developmentAdapter: true }).restore()).toEqual({ kind: "development" });
  });

  it("keeps an email draft without treating it as an authenticated session", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage, { developmentAdapter: true });
    store.saveEmailDraft("reader@example.com");
    expect(store.restoreEmailDraft()).toBe("reader@example.com");
    expect(store.restore()).toEqual({ kind: "signed-out" });
  });
});
