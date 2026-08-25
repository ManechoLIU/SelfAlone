import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateConversationSchema } from "./conversation-migration";
import { migrateConversationSelectionSchema } from "./conversation-selection-migration";
import { ConversationSelectionStore } from "./conversation-selection-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("conversation selection store", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema, sql }) => {
        await sql.end();
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
  });

  it("persists an account-scoped question and restores its history", async () => {
    const setup = await isolatedDatabase(databases, "selection_store_restore");
    await createConversation(setup.sql, "account-a", "conversation-a");
    const store = new ConversationSelectionStore(setup.sql, { idFactory: () => "question-a" });

    const created = await store.createQuestion("account-a", "conversation-a", {
      prompt: "保留哪种内容？",
      mode: "single",
      options: [
        { value: "summary", label: "摘要" },
        { value: "outline", label: "大纲" },
      ],
    });
    expect(created).toMatchObject({
      id: "question-a",
      status: "pending",
      version: 1,
    });

    const answered = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: "question-a",
      requestId: "answer-a",
      expectedVersion: 1,
      values: ["summary"],
    });
    expect(answered).toMatchObject({
      status: "submitted",
      question: { status: "submitted", selectedValues: ["summary"] },
    });

    const refreshed = new ConversationSelectionStore(setup.sql);
    await expect(refreshed.listQuestions("account-a", "conversation-a"))
      .resolves.toMatchObject([{ id: "question-a", status: "submitted", selectedValues: ["summary"] }]);
  });

  it("replays a completed answer idempotently and rejects a reused request id", async () => {
    const setup = await isolatedDatabase(databases, "selection_store_idempotency");
    await createConversation(setup.sql, "account-a", "conversation-a");
    const store = new ConversationSelectionStore(setup.sql, { idFactory: () => "question-a" });
    await store.createQuestion("account-a", "conversation-a", {
      prompt: "保留哪种内容？",
      mode: "single",
      options: [{ value: "summary", label: "摘要" }, { value: "outline", label: "大纲" }],
    });

    const first = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: "question-a",
      requestId: "answer-a",
      expectedVersion: 1,
      values: ["summary"],
    });
    const replay = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: "question-a",
      requestId: "answer-a",
      expectedVersion: first.question.version,
      values: ["summary"],
    });
    expect(replay).toEqual(first);

    await expect(store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: "question-a",
      requestId: "answer-a",
      expectedVersion: first.question.version,
      values: ["outline"],
    })).rejects.toMatchObject({ code: "SELECTION_REQUEST_ID_CONFLICT" });
  });

  it("requires confirmation for multi choice and rejects stale questions after supersession", async () => {
    const setup = await isolatedDatabase(databases, "selection_store_stale");
    await createConversation(setup.sql, "account-a", "conversation-a");
    let nextId = 0;
    const store = new ConversationSelectionStore(setup.sql, {
      idFactory: () => `question-${++nextId}`,
    });
    const first = await store.createQuestion("account-a", "conversation-a", {
      prompt: "保留哪些内容？",
      mode: "multi",
      options: [{ value: "summary", label: "摘要" }, { value: "outline", label: "大纲" }],
    });
    const drafted = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: first.id,
      requestId: "draft-a",
      expectedVersion: first.version,
      values: ["summary"],
      confirm: false,
    });
    expect(drafted.status).toBe("pending");
    expect(drafted.question.selectedValues).toEqual(["summary"]);

    const replayedStore = new ConversationSelectionStore(setup.sql);
    const replayedDraft = await replayedStore.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: first.id,
      requestId: "draft-a",
      expectedVersion: first.version,
      values: ["summary"],
      confirm: false,
    });
    expect(replayedDraft).toEqual(drafted);
    await expect(replayedStore.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: first.id,
      requestId: "draft-a",
      expectedVersion: first.version,
      values: ["outline"],
      confirm: false,
    })).rejects.toMatchObject({ code: "SELECTION_REQUEST_ID_CONFLICT" });

    const nextDraft = await replayedStore.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: first.id,
      requestId: "draft-b",
      expectedVersion: drafted.question.version,
      values: ["outline"],
      confirm: false,
    });
    expect(nextDraft).toMatchObject({ status: "pending", question: { version: 3, selectedValues: ["outline"] } });

    const replacement = await store.createQuestion("account-a", "conversation-a", {
      prompt: "改为选择哪种内容？",
      mode: "single",
      options: [{ value: "outline", label: "大纲" }],
    });
    await expect(store.getQuestion("account-a", "conversation-a", first.id))
      .resolves.toMatchObject({ status: "stale" });
    await expect(store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: first.id,
      requestId: "old-answer",
      expectedVersion: drafted.question.version,
      values: ["summary"],
      confirm: true,
    })).rejects.toMatchObject({ code: "SELECTION_STALE" });
    expect(replacement.status).toBe("pending");
  });

  it("requires explicit confirmation for a high-impact single choice", async () => {
    const setup = await isolatedDatabase(databases, "selection_store_confirmation");
    await createConversation(setup.sql, "account-a", "conversation-a");
    const store = new ConversationSelectionStore(setup.sql, { idFactory: () => "question-a" });
    const created = await store.createQuestion("account-a", "conversation-a", {
      prompt: "这会使已有内容失效吗？",
      mode: "single",
      options: [{ value: "replace", label: "替换已有内容" }],
      requiresConfirmation: true,
    });

    const pending = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: created.id,
      requestId: "select-a",
      expectedVersion: created.version,
      values: ["replace"],
      confirm: false,
    });
    expect(pending).toMatchObject({ status: "pending", question: { selectedValues: ["replace"] } });

    const submitted = await store.answerQuestion({
      accountId: "account-a",
      conversationId: "conversation-a",
      questionId: created.id,
      requestId: "confirm-a",
      expectedVersion: pending.question.version,
      values: ["replace"],
      confirm: true,
    });
    expect(submitted.status).toBe("submitted");
  });

  it("keeps selection data isolated between accounts", async () => {
    const setup = await isolatedDatabase(databases, "selection_store_owner");
    await createConversation(setup.sql, "account-a", "conversation-a");
    const store = new ConversationSelectionStore(setup.sql, { idFactory: () => "question-a" });
    await store.createQuestion("account-a", "conversation-a", {
      prompt: "保留哪种内容？",
      mode: "single",
      options: [{ value: "summary", label: "摘要" }],
    });

    await expect(store.listQuestions("account-b", "conversation-a")).resolves.toEqual([]);
    await expect(store.answerQuestion({
      accountId: "account-b",
      conversationId: "conversation-a",
      questionId: "question-a",
      requestId: "answer-b",
      expectedVersion: 1,
      values: ["summary"],
    })).rejects.toMatchObject({ code: "SELECTION_NOT_FOUND" });
  });
});

async function isolatedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 1 });
  databases.push({ administration, schema, sql });
  await migrateConversationSchema(sql);
  await migrateConversationSelectionSchema(sql);
  return { schema, sql };
}

async function createConversation(sql: Sql, accountId: string, conversationId: string) {
  await sql`
    INSERT INTO conversations (id, account_id, revision, state, deleted)
    VALUES (
      ${conversationId},
      ${accountId},
      0,
      ${sql.json({
        id: conversationId,
        revision: 0,
        draft: null,
        context: [],
        activeRun: null,
        tasks: [],
        works: [],
        deleted: false,
      })},
      false
    )
  `;
}
