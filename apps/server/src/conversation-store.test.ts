import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateConversationSchema } from "./conversation-migration";
import { ConversationStore } from "./conversation-store";

const domainModulePath = "../../../packages/domain/src/" + "conversation-session";
const domain = await import(domainModulePath);

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

const domainStateMachine = {
  createSession: domain.createConversationSession,
  updateDraft: domain.updateConversationDraft,
  appendContext: domain.appendConversationContext,
  startRun: domain.startConversationRun,
  recordWork: domain.recordConversationWork,
  settleRun: domain.settleConversationRun,
  deleteSession: domain.deleteConversationSession,
  isSendLocked: domain.isConversationSendLocked,
};

describe("conversation store", () => {
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

  it("persists a deterministic local reply that a fresh store can recover", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_reply");
    const firstStore = new ConversationStore(setup.sql, domainStateMachine);
    await firstStore.createSession("account-a", "conversation-a");

    const sent = await firstStore.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-a-1",
      text: "请记住这一段",
    });

    expect(sent.status).toBe("completed");
    if (sent.status !== "completed") throw new Error("expected completed send");
    expect(sent.reply).toBe("我先记下：请记住这一段");
    expect(sent.session.draft).toBeNull();
    const [stored] = await setup.sql<{ stateType: string }[]>`
      SELECT jsonb_typeof(state) AS "stateType"
      FROM conversations
      WHERE id = 'conversation-a'
    `;
    expect(stored?.stateType).toBe("object");

    const refreshedStore = new ConversationStore(setup.sql, domainStateMachine);
    const refreshed = await refreshedStore.getSession("account-a", "conversation-a");
    expect(refreshed?.context).toEqual([
      { id: "request-a-1:user", role: "user", text: "请记住这一段", requestId: "request-a-1" },
      {
        id: "request-a-1:assistant",
        role: "assistant",
        text: "我先记下：请记住这一段",
        requestId: "request-a-1",
      },
    ]);
  });

  it("retains the original input when the local responder fails", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_failure");
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        throw new Error("LOCAL_REPLY_FAILED");
      },
    });
    await store.createSession("account-a", "conversation-a");

    const sent = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-a-1",
      text: "这段输入不能丢",
    });

    expect(sent).toMatchObject({
      status: "failed",
      errorCode: "CONVERSATION_REPLY_FAILED",
      retainedDraft: { text: "这段输入不能丢", attachments: [] },
      session: { draft: { text: "这段输入不能丢", attachments: [] }, activeRun: null },
    });

    const refreshed = await new ConversationStore(setup.sql, domainStateMachine).getSession(
      "account-a",
      "conversation-a",
    );
    expect(refreshed?.draft).toEqual({ text: "这段输入不能丢", attachments: [] });
  });

  it("reuses one persisted user entry across a failure then same-request retry", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_retry");
    let responderCalls = 0;
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        responderCalls += 1;
        if (responderCalls <= 2) throw new Error("LOCAL_REPLY_FAILED");
        return "重试后完成";
      },
    });
    await store.createSession("account-a", "conversation-a");

    const first = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });
    const second = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });
    const third = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-retry",
      text: "需要重试",
    });

    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
    expect(third).toMatchObject({ status: "completed", reply: "重试后完成" });
    if (third.status !== "completed") throw new Error("expected completed retry");
    expect(third.session.context.filter((entry) => entry.id === "request-retry:user")).toHaveLength(1);
    expect(third.session.context.filter((entry) => entry.id === "request-retry:assistant")).toHaveLength(1);
    expect(responderCalls).toBe(3);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);
  });

  it("replays a completed request without a second response or message group", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_replay");
    let responderCalls = 0;
    const store = new ConversationStore(setup.sql, domainStateMachine, {
      respond: async () => {
        responderCalls += 1;
        return "只生成一次";
      },
    });
    await store.createSession("account-a", "conversation-a");

    const first = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-replay",
      text: "响应可能丢失",
    });
    const replay = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-replay",
      text: "响应可能丢失",
    });

    expect(first.status).toBe("completed");
    expect(replay).toMatchObject({ status: "completed", reply: "只生成一次" });
    if (replay.status !== "completed") throw new Error("expected completed replay");
    if (first.status !== "completed") throw new Error("expected initial completed send");
    expect(replay.session.revision).toBe(first.session.revision);
    expect(replay.session.context).toHaveLength(2);
    expect(responderCalls).toBe(1);

    const [messageCount] = await setup.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM messages
      WHERE account_id = 'account-a' AND conversation_id = 'conversation-a'
    `;
    expect(messageCount?.count).toBe(2);

    const fresh = await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-fresh",
      text: "响应可能丢失",
    });
    expect(fresh.status).toBe("completed");
    expect(responderCalls).toBe(2);
    if (fresh.status !== "completed") throw new Error("expected fresh completed send");
    expect(fresh.session.context.filter((entry) => entry.role === "user")).toHaveLength(2);
    expect(fresh.session.context.filter((entry) => entry.role === "assistant")).toHaveLength(2);
  });

  it("fails closed when a request id is reused with different text", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_conflict");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-a");

    await store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-conflict",
      text: "原始内容",
    });

    await expect(store.sendText({
      accountId: "account-a",
      conversationId: "conversation-a",
      requestId: "request-conflict",
      text: "篡改内容",
    })).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
  });

  it("does not expose one account's conversation to another account", async () => {
    const setup = await isolatedDatabase(databases, "conversation_store_owner");
    const store = new ConversationStore(setup.sql, domainStateMachine);
    await store.createSession("account-a", "conversation-a");

    expect(await store.getSession("account-b", "conversation-a")).toBeNull();
    expect(await store.listSessions("account-b")).toEqual([]);
    await expect(store.createSession("account-b", "conversation-a")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
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
  return { schema, sql };
}
