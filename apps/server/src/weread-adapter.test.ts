import { describe, expect, it } from "vitest";
import * as wereadAdapter from "./weread-adapter";
import {
  createFakeWeReadAdapter,
  type FakeWeReadDataset,
} from "./weread-adapter";

const NOW = "2024-01-02T03:04:05.000Z";

function book(externalId: string, title: string) {
  return {
    externalId,
    title,
    author: "作者",
    coverUrl: `https://cdn.example.test/${externalId}.jpg`,
    progressPercent: 43,
    lastReadAt: NOW,
  };
}

function annotation(externalId: string, bookExternalId: string, quote: string) {
  return {
    externalId,
    bookExternalId,
    quote,
    thought: `想法-${externalId}`,
    location: "第一章",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function dataset(overrides: Partial<FakeWeReadDataset> = {}): FakeWeReadDataset {
  return {
    account: { externalId: "weread-a", displayName: "读者 A" },
    apiKey: "wrk-a-secret",
    books: [book("book-a", "A 书")],
    annotations: [annotation("annotation-a", "book-a", "A 的原文")],
    ...overrides,
  };
}

describe("fake WeRead adapter contract", () => {
  it("keeps an annotation upgrade pause fail-closed across book and annotation syncs", async () => {
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        books: [book("book-a", "A 书"), book("book-b", "B 书")],
        annotations: [annotation("annotation-b", "book-b", "B 的原文")],
        annotationFailures: {
          "book-a": { errcode: 426, upgrade_info: "please upgrade" },
        },
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");

    await expect(adapter.syncAnnotations(connection.connectionId, "book-a"))
      .rejects.toMatchObject({
        code: "WEREAD_SYNC_PAUSED",
        snapshot: [],
      });
    await expect(adapter.syncBooks(connection.connectionId))
      .resolves.toMatchObject({ status: "paused", snapshot: "last_success" });
    await expect(adapter.syncAnnotationsResult(connection.connectionId, "book-b"))
      .resolves.toMatchObject({ status: "paused", snapshot: "last_success" });
    await expect(adapter.syncAnnotations(connection.connectionId, "book-b"))
      .rejects.toMatchObject({ code: "WEREAD_SYNC_PAUSED" });
    await expect(adapter.getConnection(connection.connectionId))
      .resolves.toMatchObject({ status: "paused" });
  });

  it("keeps a books upgrade pause fail-closed when annotations are requested", async () => {
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        books: [book("book-a", "A 书"), book("book-b", "B 书")],
        annotations: [annotation("annotation-b", "book-b", "B 的原文")],
        bookPages: [{
          cursor: null,
          books: [book("book-a", "A 书"), book("book-b", "B 书")],
          nextCursor: null,
          failure: { errcode: 426, upgrade_info: "please upgrade" },
        }],
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");

    await expect(adapter.syncBooks(connection.connectionId))
      .resolves.toMatchObject({ status: "paused", snapshot: "last_success" });
    await expect(adapter.syncAnnotationsResult(connection.connectionId, "book-b"))
      .resolves.toMatchObject({ status: "paused", snapshot: "last_success" });
    await expect(adapter.syncAnnotations(connection.connectionId, "book-b"))
      .rejects.toMatchObject({ code: "WEREAD_SYNC_PAUSED" });
  });

  it("does not expose a generic production adapter alias", () => {
    const exports = wereadAdapter as Record<string, unknown>;
    expect(exports.createWeReadAdapter).toBeUndefined();
    expect(exports.createFakeWeReadAdapter).toBeTypeOf("function");
    expect(exports.createWeReadFakeAdapter).toBeTypeOf("function");
    expect(exports.createDevelopmentWeReadAdapter).toBeTypeOf("function");
  });

  it.each(["key=wrk-a-secret", "wrk-a-secret", "unsafe-hint"])(
    "always projects a safe API key hint for custom value %s",
    async (apiKeyHint) => {
      const adapter = createFakeWeReadAdapter({ datasets: [dataset({ apiKeyHint })] });
      const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");
      expect(connection.apiKeyHint).toBe("••••••••cret");
      expect(connection.apiKeyHint).not.toContain("wrk-a-secret");
    },
  );

  it.each(["", "   "])("normalizes blank annotation location %j to null", async (location) => {
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        annotations: [{ ...annotation("annotation-blank", "book-a", "原文"), location }],
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");
    const annotations = await adapter.syncAnnotations(connection.connectionId, "book-a");
    expect(annotations[0]?.location).toBeNull();
  });

  it("normalizes provider epoch seconds to canonical UTC timestamps", async () => {
    const adapter = createFakeWeReadAdapter({
      now: () => 1_700_000_000,
      datasets: [dataset()],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");
    expect(connection.verifiedAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("validates an injected key without returning it and replaces a connection only after success", async () => {
    const adapter = createFakeWeReadAdapter({
      now: () => NOW,
      datasets: [
        dataset(),
        {
          account: { externalId: "weread-b", displayName: "读者 B" },
          apiKey: "wrk-b-secret",
          books: [book("book-b", "B 书")],
          annotations: [annotation("annotation-b", "book-b", "B 的原文")],
        },
      ],
    });

    await expect(adapter.validate("wrk-a-secret")).resolves.toEqual({
      externalId: "weread-a",
      displayName: "读者 A",
    });
    await expect(adapter.validate("wrk-a-secret")).resolves.not.toHaveProperty("apiKey");

    const first = await adapter.replaceConnection("account-a", "wrk-a-secret");
    expect(first).toMatchObject({
      accountId: "account-a",
      accountExternalId: "weread-a",
      status: "verified",
      apiKeyHint: "••••••••cret",
      verifiedAt: NOW,
    });
    expect(JSON.stringify(first)).not.toContain("wrk-a-secret");

    await expect(adapter.syncBooks(first.connectionId)).resolves.toMatchObject({
      books: [expect.objectContaining({ externalId: "book-a" })],
    });

    await expect(adapter.replaceConnection("account-a", "wrk-invalid")).rejects.toMatchObject({
      code: "WEREAD_INVALID_API_KEY",
    });
    await expect(adapter.getCurrentConnection("account-a")).resolves.toEqual(first);

    const replaced = await adapter.replaceConnection("account-a", "wrk-b-secret");
    expect(replaced.connectionId).not.toBe(first.connectionId);
    expect(replaced.accountExternalId).toBe("weread-b");
    await expect(adapter.syncBooks(first.connectionId)).rejects.toMatchObject({
      code: "WEREAD_CONNECTION_REVOKED",
    });
    expect(adapter.getLastSuccessfulBooks(first.connectionId)).toEqual([book("book-a", "A 书")]);
    await expect(adapter.syncBooks(replaced.connectionId)).resolves.toMatchObject({
      status: "success",
      books: [expect.objectContaining({ externalId: "book-b" })],
    });
  });

  it("keeps opaque cursors, returns multiple records, and does not hide an annotation N+1 call", async () => {
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        books: [book("book-a", "A 书"), book("book-shared", "A 的同 ID")],
        annotations: [
          annotation("annotation-a1", "book-a", "第一条"),
          annotation("annotation-a2", "book-a", "第二条"),
        ],
        bookPages: [
          { cursor: null, books: [book("book-a", "A 书"), book("book-shared", "A 的同 ID")], nextCursor: "cursor:opaque/二" },
          { cursor: "cursor:opaque/二", books: [book("book-last", "最后一本")], nextCursor: null },
        ],
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");

    const first = await adapter.syncBooks(connection.connectionId);
    expect(first).toMatchObject({
      status: "success",
      snapshot: "fresh",
      cursor: null,
      nextCursor: "cursor:opaque/二",
    });
    expect(first.books).toHaveLength(2);
    expect(adapter.calls.filter((call) => call.operation === "syncBooks")).toEqual([
      { operation: "syncBooks", connectionId: connection.connectionId, cursor: null },
    ]);

    await expect(adapter.syncBooks(connection.connectionId, "not-the-cursor")).rejects.toMatchObject({
      code: "WEREAD_CURSOR_INVALID",
    });
    const last = await adapter.syncBooks(connection.connectionId, first.nextCursor ?? undefined);
    expect(last).toMatchObject({ cursor: "cursor:opaque/二", nextCursor: null });
    expect(last.books).toHaveLength(1);
    expect(adapter.getLastSuccessfulBooks(connection.connectionId)).toHaveLength(3);

    const annotations = await adapter.syncAnnotations(connection.connectionId, "book-a");
    expect(annotations).toHaveLength(2);
    expect(annotations.map((item) => item.externalId)).toEqual(["annotation-a1", "annotation-a2"]);
    expect(adapter.calls.filter((call) => call.operation === "syncAnnotations")).toHaveLength(1);
    expect(adapter.calls.filter((call) => call.operation === "syncBooks")).toHaveLength(3);
  });

  it("isolates local accounts, connections, and provider book IDs", async () => {
    const adapter = createFakeWeReadAdapter({
      datasets: [
        dataset({
          books: [book("same-external-id", "账户 A 的书")],
          annotations: [annotation("annotation-a", "same-external-id", "A 的原文")],
        }),
        {
          account: { externalId: "weread-b", displayName: "读者 B" },
          apiKey: "wrk-b-secret",
          books: [book("same-external-id", "账户 B 的书")],
          annotations: [annotation("annotation-b", "same-external-id", "B 的原文")],
        },
      ],
    });
    const connectionA = await adapter.replaceConnection("account-a", "wrk-a-secret");
    const connectionB = await adapter.replaceConnection("account-b", "wrk-b-secret");

    await expect(adapter.syncBooksForAccount("account-a", connectionA.connectionId)).resolves.toMatchObject({
      books: [expect.objectContaining({ title: "账户 A 的书" })],
    });
    await expect(adapter.syncBooksForAccount("account-b", connectionB.connectionId)).resolves.toMatchObject({
      books: [expect.objectContaining({ title: "账户 B 的书" })],
    });
    await expect(adapter.syncBooksForAccount("account-b", connectionA.connectionId)).rejects.toMatchObject({
      code: "WEREAD_CONNECTION_FORBIDDEN",
    });
    await expect(adapter.syncAnnotationsForAccount("account-a", connectionA.connectionId, "same-external-id"))
      .resolves.toEqual([expect.objectContaining({ externalId: "annotation-a" })]);
    await expect(adapter.syncAnnotationsForAccount("account-a", connectionA.connectionId, "book-b-only"))
      .rejects.toMatchObject({ code: "WEREAD_BOOK_NOT_FOUND" });
  });

  it("pauses on errcode/upgrade_info and returns the complete last-success snapshot", async () => {
    const previousBook = book("book-previous", "上次成功");
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        books: [book("book-new", "这次同步")],
        lastSuccessfulBooks: [previousBook],
        bookPages: [
          { cursor: null, books: [book("book-new", "这次同步")], nextCursor: "opaque-next" },
          { cursor: "opaque-next", books: [], nextCursor: null, failure: { errcode: 426, upgrade_info: "please upgrade" } },
        ],
        lastSuccessfulAnnotations: {
          "book-new": [annotation("annotation-old", "book-new", "旧划线")],
        },
        annotationFailures: {
          "book-new": { errcode: 426, upgrade_info: "please upgrade" },
        },
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");

    await expect(adapter.syncBooks(connection.connectionId)).resolves.toMatchObject({
      status: "success",
      nextCursor: "opaque-next",
    });
    const paused = await adapter.syncBooks(connection.connectionId, "opaque-next");
    expect(paused).toMatchObject({
      status: "paused",
      snapshot: "last_success",
      cursor: "opaque-next",
      nextCursor: null,
      books: [previousBook],
      pause: {
        reason: "upgrade_required",
        errcode: 426,
        upgradeInfo: "please upgrade",
      },
    });
    expect(adapter.getLastSuccessfulBooks(connection.connectionId)).toEqual([previousBook]);

    const annotationPause = await adapter.syncAnnotationsResult(connection.connectionId, "book-new");
    expect(annotationPause).toMatchObject({
      status: "paused",
      snapshot: "last_success",
      annotations: [expect.objectContaining({ externalId: "annotation-old" })],
      pause: { reason: "upgrade_required", errcode: 426 },
    });
    await expect(adapter.syncAnnotations(connection.connectionId, "book-new"))
      .rejects.toMatchObject({
        code: "WEREAD_SYNC_PAUSED",
        snapshot: [expect.objectContaining({ externalId: "annotation-old" })],
      });
    expect(JSON.stringify(paused)).not.toContain("wrk-a-secret");
  });

  it("keeps the last snapshot untouched for a provider error without upgrade metadata", async () => {
    const previousBook = book("book-previous", "上次成功");
    const adapter = createFakeWeReadAdapter({
      datasets: [dataset({
        lastSuccessfulBooks: [previousBook],
        bookPages: [{ cursor: null, books: [], nextCursor: null, failure: { errcode: 503 } }],
      })],
    });
    const connection = await adapter.replaceConnection("account-a", "wrk-a-secret");

    const error = await adapter.syncBooks(connection.connectionId).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "WEREAD_PROVIDER_ERROR", errcode: 503, retryable: true });
    expect(adapter.getLastSuccessfulBooks(connection.connectionId)).toEqual([previousBook]);
    expect(JSON.stringify(error)).not.toContain("wrk-a-secret");
  });
});
