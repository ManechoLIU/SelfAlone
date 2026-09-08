import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePptOutlineGenerationAdapter,
  createFakePptPublicSourceAdapter,
} from "./ppt-outline-adapters";
import { migratePptOutlineSchema } from "./ppt-outline-migration";
import { PptOutlineRuntimeError } from "./ppt-outline-runtime";
import { migratePptWorkspaceSchema } from "./ppt-workspace-migration";
import { registerPptWorkspaceRoutes } from "./ppt-workspace-routes";
import { PptWorkspaceStore } from "./ppt-workspace-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("PPT workspace store", () => {
  let administration: Sql;
  let schema: string;
  let sql: Sql;
  let store: PptWorkspaceStore;

  beforeEach(async () => {
    schema = `ppt_workspace_store_${randomUUID().replaceAll("-", "")}`;
    administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(baseDatabaseUrl);
    databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
    sql = postgres(databaseUrl.toString(), { max: 4 });
    await createBaseSchema(sql);
    await migratePptWorkspaceSchema(sql);
    await migratePptOutlineSchema(sql);
    await seedAccountsAndMessages(sql);
    store = new PptWorkspaceStore(sql, {
      generation: createFakePptOutlineGenerationAdapter(),
      publicSources: createFakePptPublicSourceAdapter(),
    });
  });

  afterEach(async () => {
    await sql.end();
    await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await administration.end();
  });

  it("creates one account-owned draft only after its user message was sent", async () => {
    const result = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });

    expect(result.status).toBe("created");
    expect(result.workspace).toEqual({
      draft: {
        id: result.workspace.draft.id,
        conversationId: "conversation-a",
        stage: "requirements",
        version: 1,
        requirements: {
          purpose: null,
          audience: null,
          pageRange: null,
          additionalRequirements: "",
        },
      },
      sources: [
        {
          bookId: "book-a",
          title: "第一本书",
          author: "甲作者",
          sourceLabel: "本地",
        },
      ],
    });
    expect(await store.getWorkspace("account-a", result.workspace.draft.id)).toEqual(
      result.workspace,
    );
  });

  it("reuses the same sent intent but rejects a different source for that request", async () => {
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    };
    const first = await store.createFromSentIntent(input);
    const repeated = await store.createFromSentIntent(input);

    expect(repeated).toEqual({ status: "reused", workspace: first.workspace });
    await expect(store.createFromSentIntent({ ...input, bookId: "book-b" })).rejects.toThrow(
      "PPT_INTENT_CONFLICT",
    );
  });

  it("reuses the original create-request fingerprint after the current source changes", async () => {
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    };
    const created = await store.createFromSentIntent(input);
    const replaced = await store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      bookId: "book-b",
    });
    await sql`DELETE FROM books WHERE account_id = 'account-a' AND id = 'book-a'`;

    const originalRetry = await store.createFromSentIntent(input);
    expect(originalRetry).toEqual({
      status: "reused",
      workspace: replaced,
    });
    await expect(store.createFromSentIntent({ ...input, bookId: "book-b" })).rejects.toThrow(
      "PPT_INTENT_CONFLICT",
    );
    await expect(store.createFromSentIntent({ ...input, bookId: "book-missing" })).rejects.toThrow(
      "PPT_INTENT_CONFLICT",
    );
    const [fingerprint] = await sql<Array<{ bookId: string | null }>>`
      SELECT intent_source_book_id AS "bookId"
      FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    expect(fingerprint).toEqual({ bookId: "book-a" });
    expect(await store.getWorkspace("account-a", created.workspace.draft.id)).toEqual(replaced);
  });

  it.each(["deleted", "non-user"] as const)(
    "keeps the sent-message gate when an existing intent's message is %s",
    async (messageState) => {
      const input = {
        accountId: "account-a",
        conversationId: "conversation-a",
        bookId: "book-a",
        requestId: "request-a",
      };
      await store.createFromSentIntent(input);
      if (messageState === "deleted") {
        await sql`
          DELETE FROM messages
          WHERE account_id = 'account-a'
            AND conversation_id = 'conversation-a'
            AND request_id = 'request-a'
        `;
      } else {
        await sql`
          UPDATE messages SET role = 'assistant'
          WHERE account_id = 'account-a'
            AND conversation_id = 'conversation-a'
            AND request_id = 'request-a'
        `;
      }

      await expect(store.createFromSentIntent(input)).rejects.toThrow("PPT_INTENT_NOT_SENT");
    },
  );

  it("fails closed when an upgraded intent has no immutable source fingerprint", async () => {
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    };
    await store.createFromSentIntent(input);
    await sql`
      UPDATE ppt_drafts SET intent_source_book_id = NULL
      WHERE account_id = 'account-a' AND intent_request_id = 'request-a'
    `;

    await expect(store.createFromSentIntent(input)).rejects.toThrow("PPT_INTENT_CONFLICT");
    await expect(store.createFromSentIntent({ ...input, bookId: "book-b" })).rejects.toThrow(
      "PPT_INTENT_CONFLICT",
    );
  });

  it("creates only one draft for concurrent same-request same-source retries", async () => {
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    };

    const [first, second] = await Promise.all([
      store.createFromSentIntent(input),
      store.createFromSentIntent(input),
    ]);

    expect(new Set([first.status, second.status])).toEqual(new Set(["created", "reused"]));
    expect(first.workspace.draft.id).toBe(second.workspace.draft.id);
    expect(first.workspace.sources).toEqual(second.workspace.sources);
    const drafts = await sql<Array<{ id: string }>>`
      SELECT id FROM ppt_drafts
      WHERE account_id = 'account-a' AND intent_request_id = 'request-a'
    `;
    expect(drafts).toHaveLength(1);
  });

  it("conflicts the other concurrent create when the same request uses a different source", async () => {
    const input = {
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-a",
    };

    const results = await Promise.allSettled([
      store.createFromSentIntent({ ...input, bookId: "book-a" }),
      store.createFromSentIntent({ ...input, bookId: "book-b" }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "PPT_INTENT_CONFLICT" }),
    });
    const created = (fulfilled[0] as PromiseFulfilledResult<{
      status: "created" | "reused";
      workspace: { draft: { id: string }; sources: ReadonlyArray<{ bookId: string }> };
    }>).value;
    expect(created.status).toBe("created");
    const drafts = await sql<Array<{ id: string }>>`
      SELECT id FROM ppt_drafts
      WHERE account_id = 'account-a' AND intent_request_id = 'request-a'
    `;
    expect(drafts).toHaveLength(1);
    expect(created.workspace.sources).toHaveLength(1);
    expect(["book-a", "book-b"]).toContain(created.workspace.sources[0]?.bookId);
  });

  it("returns a consistent version and source snapshot when replacement commits mid-read", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });

    let resumeRead = () => {};
    const readGate = new Promise<void>((resolve) => {
      resumeRead = resolve;
    });
    let releaseReplace = () => {};
    const replaceGate = new Promise<void>((resolve) => {
      releaseReplace = resolve;
    });
    let readQueries = 0;
    const reader = new PptWorkspaceStore(interceptWorkspaceRead(
      sql,
      async () => {
        releaseReplace();
        await readGate;
      },
      () => {
        readQueries += 1;
      },
    ));

    const snapshotPromise = reader.getWorkspace("account-a", created.workspace.draft.id);
    const outcome = await Promise.race([
      replaceGate.then(() => "interleaved" as const),
      snapshotPromise.then(() => "atomic" as const),
    ]);
    if (outcome === "interleaved") {
      await store.replaceSource({
        accountId: "account-a",
        draftId: created.workspace.draft.id,
        expectedVersion: 1,
        bookId: "book-b",
      });
      resumeRead();
    }
    const snapshot = await snapshotPromise;

    expect(snapshot).not.toBeNull();
    if (snapshot?.draft.version === 1) {
      expect(snapshot.sources).toEqual(created.workspace.sources);
    } else {
      expect(snapshot).toMatchObject({
        draft: { version: 2 },
        sources: [{ bookId: "book-b" }],
      });
    }
    expect(readQueries).toBe(1);
  });

  it("fails closed and rolls back writes unless exactly one ordered source exists", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    await sql`
      DELETE FROM ppt_draft_sources
      WHERE account_id = 'account-a' AND draft_id = ${created.workspace.draft.id}
    `;

    await expect(store.getWorkspace("account-a", created.workspace.draft.id)).rejects.toThrow(
      "PPT_SOURCE_CARDINALITY_INVALID",
    );
    await expect(store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    })).rejects.toThrow("PPT_SOURCE_CARDINALITY_INVALID");
    const [afterMissingSource] = await sql<Array<{ version: number }>>`
      SELECT version FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    expect(afterMissingSource?.version).toBe(1);

    await sql`
      INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
      VALUES
        ('account-a', ${created.workspace.draft.id}, 'book-a', 0),
        ('account-a', ${created.workspace.draft.id}, 'book-b', 1)
    `;
    await expect(store.getWorkspace("account-a", created.workspace.draft.id)).rejects.toThrow(
      "PPT_SOURCE_CARDINALITY_INVALID",
    );
    await expect(store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      bookId: "book-b",
    })).rejects.toThrow("PPT_SOURCE_CARDINALITY_INVALID");
    const [afterMultipleSources] = await sql<Array<{ version: number }>>`
      SELECT version FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    expect(afterMultipleSources?.version).toBe(1);
  });

  it("fails closed for unsent intents and resources owned by another account", async () => {
    await expect(store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-never-sent",
    })).rejects.toThrow("PPT_INTENT_NOT_SENT");

    await expect(store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-b",
      bookId: "book-secret",
      requestId: "request-b",
    })).rejects.toThrow("PPT_WORKSPACE_NOT_FOUND");

    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    expect(await store.getWorkspace("account-b", created.workspace.draft.id)).toBeNull();
  });

  it("persists hierarchical outline paragraphs with optimistic versioning", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    await store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 2, max: 6 },
        additionalRequirements: "",
      },
    });

    const saved = await store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
      paragraphs: [
        { id: "page-1", level: 1, text: "第一章" },
        { id: "point-1", level: 2, text: "核心观点" },
        { id: "detail-1", level: 3, text: "观点说明" },
        { id: "page-2", level: 1, text: "第二章" },
      ],
    });

    expect(saved).toMatchObject({ version: 3, pageCount: 2 });
    const rows = await sql<Array<{ nodeId: string; level: number; body: string }>>`
      SELECT node_id AS "nodeId", level, body
      FROM ppt_outline_nodes
      WHERE account_id = 'account-a' AND draft_id = ${created.workspace.draft.id}
      ORDER BY node_order
    `;
    expect(rows).toEqual([
      { nodeId: "page-1", level: 1, body: "第一章" },
      { nodeId: "point-1", level: 2, body: "核心观点" },
      { nodeId: "detail-1", level: 3, body: "观点说明" },
      { nodeId: "page-2", level: 1, body: "第二章" },
    ]);

    await expect(store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
      paragraphs: [{ id: "page-x", level: 1, text: "过期写入" }],
    })).rejects.toThrow("PPT_WORKSPACE_STALE");

    const loaded = await store.getOutline("account-a", created.workspace.draft.id);
    expect(loaded).toMatchObject({
      version: 3,
      pageCount: 2,
      paragraphs: [
        { id: "page-1", level: 1, text: "第一章" },
        { id: "point-1", level: 2, text: "核心观点" },
        { id: "detail-1", level: 3, text: "观点说明" },
        { id: "page-2", level: 1, text: "第二章" },
      ],
    });
    expect(await store.getOutline("account-b", created.workspace.draft.id)).toBeNull();
  });

  it("rejects orphan children without writing nodes and isolates outline writes by account", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });

    await expect(store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      paragraphs: [{ id: "point-orphan", level: 2, text: "没有页面的要点" }],
    })).rejects.toEqual(new PptOutlineRuntimeError("PPT_OUTLINE_ORPHAN_CHILD"));
    const orphanRows = await sql<Array<{ nodeId: string }>>`
      SELECT node_id AS "nodeId"
      FROM ppt_outline_nodes
      WHERE account_id = 'account-a' AND draft_id = ${created.workspace.draft.id}
    `;
    expect(orphanRows).toEqual([]);

    await expect(store.saveOutline({
      accountId: "account-b",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      paragraphs: [{ id: "page-stolen", level: 1, text: "串号写入" }],
    })).rejects.toThrow("PPT_WORKSPACE_NOT_FOUND");
    expect(await store.getOutline("account-a", created.workspace.draft.id)).toMatchObject({
      version: 1,
      paragraphs: [],
      publicSources: [],
    });
  });

  it("persists generated public-source provenance only for the owning account and draft", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network disabled");
    });
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });

    const generated = await store.generateOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generated.pageCount).toBe(1);
    expect(generated.publicSources).toHaveLength(2);

    const loaded = await store.getOutline("account-a", created.workspace.draft.id);
    expect(loaded).toMatchObject({
      version: 2,
      pageCount: 1,
      publicSources: generated.publicSources,
    });
    expect(await store.getOutline("account-b", created.workspace.draft.id)).toBeNull();

    await expect(store.generateOutline({
      accountId: "account-b",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
    })).rejects.toThrow("PPT_WORKSPACE_NOT_FOUND");
    await expect(sql`
      INSERT INTO ppt_public_sources (
        account_id, draft_id, url, title, fetched_at, usage_scope
      ) VALUES (
        'account-b', ${created.workspace.draft.id}, 'https://example.invalid/stolen',
        '串号来源', '2026-09-06T00:00:00Z', 'outline'
      )
    `).rejects.toMatchObject({ code: "23503" });

    const unconfigured = new PptWorkspaceStore(sql);
    await expect(unconfigured.generateOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
    })).rejects.toEqual(new PptOutlineRuntimeError("PPT_OUTLINE_ADAPTER_NOT_CONFIGURED"));
    fetchSpy.mockRestore();
  });

  it("persists only normalized fixed requirements with optimistic versioning", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    const saved = await store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "  读书会分享  ",
        audience: "  产品团队  ",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "  保留普通人的选择  ",
      },
    });

    expect(saved).toMatchObject({
      draft: {
        stage: "requirements",
        version: 2,
        requirements: {
          purpose: "读书会分享",
          audience: "产品团队",
          pageRange: { min: 8, max: 10 },
          additionalRequirements: "保留普通人的选择",
        },
      },
    });
    const [legacyFields] = await sql<Array<{
      requirements: string;
      outline: unknown[];
      templateId: string | null;
    }>>`
      SELECT requirements, outline, template_id AS "templateId"
      FROM ppt_drafts
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    expect(legacyFields).toEqual({ requirements: "", outline: [], templateId: null });

    await expect(store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "课程分享",
        audience: "学生",
        pageRange: { min: 6, max: 8 },
        additionalRequirements: "",
      },
    })).rejects.toThrow("PPT_WORKSPACE_STALE");
    await expect(store.saveRequirements({
      accountId: "account-b",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
      requirements: {
        purpose: "课程分享",
        audience: "学生",
        pageRange: { min: 6, max: 8 },
        additionalRequirements: "",
      },
    })).rejects.toThrow("PPT_WORKSPACE_NOT_FOUND");
  });

  it("rejects incrementable versions at PostgreSQL int max without overflowing", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    await sql`
      UPDATE ppt_drafts SET version = ${2_147_483_646}
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;

    const maxed = await store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_646,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    });
    expect(maxed.draft.version).toBe(2_147_483_647);
    expect(await store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_647,
      bookId: "book-a",
    })).toEqual(maxed);

    await expect(store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_647,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "",
      },
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_INVALID_REQUIREMENTS" });
    await expect(store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_647,
      bookId: "book-b",
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_STALE" });

    const snapshot = await store.getWorkspace("account-a", created.workspace.draft.id);
    expect(snapshot?.draft.version).toBe(2_147_483_647);
    expect(snapshot).toEqual(maxed);
  });

  it("rejects a nonincrementable outline version before dispatching a PostgreSQL overflow", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    await sql`
      UPDATE ppt_drafts SET version = ${2_147_483_647}
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    const app = Fastify({ logger: false });
    await registerPptWorkspaceRoutes(app, store, () => "account-a");

    const outlinePut = await app.inject({
      method: "PUT",
      url: `/api/v1/ppt-drafts/${created.workspace.draft.id}/outline`,
      payload: {
        expectedVersion: 2_147_483_647,
        paragraphs: [{ id: "page-1", level: 1, text: "第一章" }],
      },
    });
    const outlineGenerate = await app.inject({
      method: "POST",
      url: `/api/v1/ppt-drafts/${created.workspace.draft.id}/outline/generate`,
      payload: { expectedVersion: 2_147_483_647 },
    });
    await app.close();

    expect(outlinePut.statusCode).toBe(400);
    expect(outlinePut.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(outlineGenerate.statusCode).toBe(400);
    expect(outlineGenerate.json()).toEqual({ code: "INVALID_REQUEST" });
    await expect(store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_647,
      paragraphs: [{ id: "page-1", level: 1, text: "第一章" }],
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_STALE" });
    await expect(store.generateOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2_147_483_647,
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_STALE" });
  });

  it("reads outline version, nodes, and public sources from one PostgreSQL snapshot", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    let releaseReader = () => {};
    const readerPaused = new Promise<void>((resolve) => {
      releaseReader = resolve;
    });
    let releaseWriter = () => {};
    const writerStarted = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const reader = new PptWorkspaceStore(interceptOutlineDraftRead(sql, async () => {
      releaseWriter();
      await readerPaused;
    }));

    const read = reader.getOutline("account-a", created.workspace.draft.id);
    await writerStarted;
    await store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      paragraphs: [{ id: "page-2", level: 1, text: "更新后的章节" }],
      publicSources: [{
        url: "https://example.invalid/new-source",
        title: "更新后的公开资料",
        publishedAt: null,
        fetchedAt: "2026-09-08T00:00:00.000Z",
        usageScope: "outline",
      }],
    });
    releaseReader();

    await expect(read).resolves.toEqual({
      version: 1,
      pageCount: 0,
      paragraphs: [],
      publicSources: [],
    });
  });

  it("returns the snapshot committed by this save rather than a later concurrent save", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    let releaseFirstResponse = () => {};
    const firstResponsePaused = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let firstCommitCompleted = () => {};
    const firstResponseStarted = new Promise<void>((resolve) => {
      firstCommitCompleted = resolve;
    });
    const firstWriter = new PptWorkspaceStore(interceptOutlineResponseRead(sql, async () => {
      firstCommitCompleted();
      await firstResponsePaused;
    }));

    const first = firstWriter.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      paragraphs: [{ id: "first-page", level: 1, text: "第一份大纲" }],
      publicSources: [{
        url: "https://example.invalid/first",
        title: "第一份资料",
        publishedAt: null,
        fetchedAt: "2026-09-08T00:00:00.000Z",
        usageScope: "outline",
      }],
    });
    await firstResponseStarted;
    await store.saveOutline({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
      paragraphs: [{ id: "second-page", level: 1, text: "第二份大纲" }],
      publicSources: [{
        url: "https://example.invalid/second",
        title: "第二份资料",
        publishedAt: null,
        fetchedAt: "2026-09-08T00:01:00.000Z",
        usageScope: "outline",
      }],
    });
    releaseFirstResponse();

    await expect(first).resolves.toEqual({
      version: 2,
      pageCount: 1,
      paragraphs: [{ id: "first-page", level: 1, text: "第一份大纲" }],
      publicSources: [{
        url: "https://example.invalid/first",
        title: "第一份资料",
        publishedAt: null,
        fetchedAt: "2026-09-08T00:00:00.000Z",
        usageScope: "outline",
      }],
    });
  });

  it("accepts a page count at the PostgreSQL integer maximum", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    const saved = await store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 2_147_483_647, max: 2_147_483_647 },
        additionalRequirements: "",
      },
    });
    expect(saved.draft.requirements.pageRange).toEqual({
      min: 2_147_483_647,
      max: 2_147_483_647,
    });
  });

  it("rejects page counts that PostgreSQL integer columns cannot store", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });

    await expect(store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 2_147_483_648 },
        additionalRequirements: "",
      },
    })).rejects.toMatchObject({ code: "PPT_WORKSPACE_INVALID_REQUIREMENTS" });

    expect(await store.getWorkspace("account-a", created.workspace.draft.id)).toEqual(
      created.workspace,
    );
  });

  it("replaces the only source before outline while preserving fixed requirements", async () => {
    const created = await store.createFromSentIntent({
      accountId: "account-a",
      conversationId: "conversation-a",
      bookId: "book-a",
      requestId: "request-a",
    });
    const required = await store.saveRequirements({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 1,
      requirements: {
        purpose: "读书会分享",
        audience: "产品团队",
        pageRange: { min: 8, max: 10 },
        additionalRequirements: "保留普通人的选择",
      },
    });
    const replaced = await store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: required.draft.version,
      bookId: "book-b",
    });

    expect(replaced).toMatchObject({
      draft: {
        version: 3,
        requirements: required.draft.requirements,
      },
      sources: [{ bookId: "book-b", title: "第二本书", author: null }],
    });
    const repeated = await store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 3,
      bookId: "book-b",
    });
    expect(repeated).toEqual(replaced);

    await expect(store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 2,
      bookId: "book-a",
    })).rejects.toThrow("PPT_WORKSPACE_STALE");
    await expect(store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 3,
      bookId: "book-secret",
    })).rejects.toThrow("PPT_WORKSPACE_NOT_FOUND");

    await sql`
      UPDATE ppt_drafts SET stage = 'outline'
      WHERE account_id = 'account-a' AND id = ${created.workspace.draft.id}
    `;
    await expect(store.replaceSource({
      accountId: "account-a",
      draftId: created.workspace.draft.id,
      expectedVersion: 3,
      bookId: "book-a",
    })).rejects.toThrow("PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION");
    const sources = await sql<Array<{ bookId: string }>>`
      SELECT book_id AS "bookId"
      FROM ppt_draft_sources
      WHERE account_id = 'account-a' AND draft_id = ${created.workspace.draft.id}
    `;
    expect(sources).toEqual([{ bookId: "book-b" }]);
  });
});

async function createBaseSchema(sql: Sql) {
  await sql`CREATE TABLE accounts (id text PRIMARY KEY)`;
  await sql`
    CREATE TABLE books (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      title text NOT NULL,
      source_label text NOT NULL,
      author text,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE conversations (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      book_id text,
      revision integer NOT NULL DEFAULT 0,
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      deleted boolean NOT NULL DEFAULT false,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE messages (
      id text NOT NULL,
      account_id text NOT NULL,
      conversation_id text NOT NULL,
      role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      text text NOT NULL,
      request_id text,
      PRIMARY KEY (account_id, conversation_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `;
  await sql`
    CREATE TABLE ppt_drafts (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      conversation_id text NOT NULL,
      stage text NOT NULL,
      version integer NOT NULL,
      requirements text NOT NULL DEFAULT '',
      outline jsonb NOT NULL DEFAULT '[]'::jsonb,
      template_id text,
      UNIQUE (account_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `;
}

function interceptWorkspaceRead(
  sql: Sql,
  barrier: () => Promise<void>,
  onQuery: () => void,
): Sql {
  return new Proxy(sql, {
    apply(target, thisArg, argArray) {
      const strings = argArray[0] as TemplateStringsArray;
      onQuery();
      const result = Reflect.apply(target, thisArg, argArray) as Promise<unknown>;
      if (!isDraftSnapshotSelect(strings)) return result;
      return Promise.resolve(result).then(async (rows) => {
        await barrier();
        return rows;
      });
    },
  });
}

function isDraftSnapshotSelect(strings: TemplateStringsArray) {
  const text = strings.join("?");
  return /SELECT\b/i.test(text)
    && /FROM\s+ppt_drafts\b/i.test(text)
    && !/\bUPDATE\b/i.test(text)
    && !/\bINSERT\b/i.test(text);
}

function interceptOutlineDraftRead(sql: Sql, barrier: () => Promise<void>): Sql {
  const interceptQuery = (query: Sql) => new Proxy(query, {
    apply(target, thisArg, argArray) {
      const strings = argArray[0] as TemplateStringsArray;
      const result = Reflect.apply(target, thisArg, argArray) as Promise<unknown>;
      if (!isOutlineDraftSelect(strings)) return result;
      return Promise.resolve(result).then(async (rows) => {
        await barrier();
        return rows;
      });
    },
  });

  return new Proxy(sql, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(interceptQuery(target), thisArg, argArray);
    },
    get(target, property, receiver) {
      if (property !== "begin") return Reflect.get(target, property, receiver);
      return (options: string, callback: (transaction: Sql) => Promise<unknown>) => target.begin(
        options,
        async (transaction) => callback(interceptQuery(transaction as unknown as Sql)),
      );
    },
  });
}

function interceptOutlineResponseRead(sql: Sql, barrier: () => Promise<void>): Sql {
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property !== "begin") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        const result = await Reflect.apply(target.begin, target, args);
        if (typeof args[0] === "function") {
          await barrier();
        }
        return result;
      };
    },
  });
}

function isOutlineDraftSelect(strings: TemplateStringsArray) {
  const text = strings.join("?");
  return /SELECT\s+version\s+FROM\s+ppt_drafts\b/i.test(text);
}

async function seedAccountsAndMessages(sql: Sql) {
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await sql`
    INSERT INTO books (id, account_id, title, source_label, author)
    VALUES
      ('book-a', 'account-a', '第一本书', '本地', '甲作者'),
      ('book-b', 'account-a', '第二本书', '微信读书', NULL),
      ('book-secret', 'account-b', '另一个账号的书', '本地', '乙作者')
  `;
  await sql`
    INSERT INTO conversations (id, account_id, revision, state, deleted)
    VALUES
      ('conversation-a', 'account-a', 0, '{}'::jsonb, false),
      ('conversation-b', 'account-b', 0, '{}'::jsonb, false)
  `;
  await sql`
    INSERT INTO messages (
      id, account_id, conversation_id, role, text, request_id
    ) VALUES
      ('request-a:user', 'account-a', 'conversation-a', 'user', '帮我制作这本书PPT', 'request-a'),
      ('request-b:user', 'account-b', 'conversation-b', 'user', '帮我制作这本书PPT', 'request-b')
  `;
}
