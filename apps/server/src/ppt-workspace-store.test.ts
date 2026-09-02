import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migratePptWorkspaceSchema } from "./ppt-workspace-migration";
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
    await seedAccountsAndMessages(sql);
    store = new PptWorkspaceStore(sql);
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
