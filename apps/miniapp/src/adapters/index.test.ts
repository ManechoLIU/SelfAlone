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
});
