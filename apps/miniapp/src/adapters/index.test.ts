import { describe, expect, it } from "vitest";
import { createClientAdapter } from ".";
import { ClientBoundaryError, parseDevelopmentState } from "./client";

describe("replaceable client adapter boundary", () => {
  it("fails closed outside the explicit develop environment", async () => {
    const client = createClientAdapter("release");
    expect(client.development).toBe(false);
    await expect(client.listBooks()).rejects.toEqual(new ClientBoundaryError("CLIENT_ADAPTER_UNAVAILABLE"));
  });

  it("enables the in-memory adapter only for develop and does not persist across instances", async () => {
    const first = createClientAdapter("develop");
    const detail = await first.getBook("dev-local-ink");
    await first.savePosition(detail.book.id, {
      sectionId: "dev-section-1",
      offset: 360,
      progress: 0.5,
      background: "dark",
      expectedVersion: 0,
    });
    expect((await first.getBook(detail.book.id)).position).toMatchObject({ progress: 0.5, background: "dark" });
    const second = createClientAdapter("develop");
    expect((await second.getBook(detail.book.id)).position).toBeNull();
  });

  it("allows state forcing only inside the development adapter", () => {
    expect(parseDevelopmentState("failed", true)).toBe("failed");
    expect(parseDevelopmentState("failed", false)).toBe("normal");
    expect(parseDevelopmentState("unknown", true)).toBe("normal");
  });

  it("exposes the reader filtered-empty state through the development boundary", async () => {
    const client = createClientAdapter("develop");
    expect((await client.getBook("dev-local-ink", "filtered-empty")).sections).toEqual([]);
  });

  it("keeps develop on the in-memory adapter when the QA HTTP switch is off", () => {
    const client = createClientAdapter("develop", {
      baseUrl: "http://127.0.0.1:4100",
      authProvider: () => ({
        kind: "authenticated",
        token: "opaque-qa-session-token-123456",
        expiresAt: Date.now() + 60_000,
      }),
    });
    expect(client.kind).toBe("development");
    expect(client.development).toBe(true);
  });

  it("stays on the in-memory adapter when develop QA HTTP is on without a base URL", () => {
    const client = createClientAdapter("develop", {
      qaRealHttp: true,
      authProvider: () => ({
        kind: "authenticated",
        token: "opaque-qa-session-token-123456",
        expiresAt: Date.now() + 60_000,
      }),
    });
    expect(client.kind).toBe("development");
    expect(client.development).toBe(true);
  });

  it("uses the production HTTP client when develop QA HTTP is on with a loopback base URL", () => {
    const client = createClientAdapter("develop", {
      qaRealHttp: true,
      baseUrl: "http://127.0.0.1:4100",
      authProvider: () => ({
        kind: "authenticated",
        token: "opaque-qa-session-token-123456",
        expiresAt: Date.now() + 60_000,
      }),
    });
    expect(client.kind).toBe("production");
    expect(client.development).toBe(false);
  });
});
