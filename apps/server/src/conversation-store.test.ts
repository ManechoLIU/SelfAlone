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
      { id: "request-a-1:user", role: "user", text: "请记住这一段" },
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
