import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); },
  };
}

describe("miniapp runtime composition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the notes QA adapter only for the explicit development runtime", async () => {
    vi.stubGlobal("App", vi.fn());
    vi.stubGlobal("wx", {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    const { createMiniappGlobalData } = await import("./app");
    const bookId = "dev-local-ink";

    const development = createMiniappGlobalData({ environment: "develop", storage: memoryStorage() });
    expect(development.developmentAdapter).toBe(true);
    await expect(development.annotationsClient.getAnnotations(bookId)).resolves.toMatchObject({
      notes: expect.arrayContaining([
        expect.objectContaining({ id: "dev-note-dev-local-ink-primary" }),
        expect.objectContaining({ id: "dev-note-dev-local-ink-follow-up" }),
      ]),
    });

    const release = createMiniappGlobalData({ environment: "release", storage: memoryStorage() });
    expect(release.developmentAdapter).toBe(false);
    await expect(release.annotationsClient.getAnnotations(bookId)).rejects.toMatchObject({
      code: "ANNOTATIONS_API_UNAVAILABLE",
    });
  });
});
