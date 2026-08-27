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

const sessionToken = "opaque-mini-session-token-1234567890";
const now = 1_700_000_000_000;

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

  it("restores a live authenticated session and clears an expired record", () => {
    const storage = memoryStorage();
    let currentTime = now;
    const store = createSessionStore(storage, { developmentAdapter: false }, { now: () => currentTime });

    expect(store.saveAuthenticatedSession(sessionToken, now + 60_000)).toEqual({
      kind: "authenticated",
      token: sessionToken,
      expiresAt: now + 60_000,
    });
    expect(store.restore()).toEqual({
      kind: "authenticated",
      token: sessionToken,
      expiresAt: now + 60_000,
    });

    currentTime = now + 60_001;
    expect(store.restore()).toEqual({ kind: "signed-out" });
    expect(storage.get("selfalone.miniapp.session.v2")).toBeUndefined();
  });

  it("clears the authenticated session when a protected request returns 401", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage, { developmentAdapter: false }, { now: () => now });
    store.saveAuthenticatedSession(sessionToken, now + 60_000);

    expect(store.clearOnUnauthorized(401)).toBe(true);
    expect(store.restore()).toEqual({ kind: "signed-out" });
    expect(store.clearOnUnauthorized(500)).toBe(false);
  });
});
