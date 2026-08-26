import type { Sql, TransactionSql } from "postgres";
import {
  createConversationResponder,
  type ConversationResponder,
} from "./conversation-responder";
export type { ConversationResponder } from "./conversation-responder";
import {
  cloneConversationSession,
  type ConversationRuntimeContextEntry,
  type ConversationRuntimeSession,
  type ConversationStateMachine,
} from "./conversation-runtime";

export type ConversationMessageRecord = ConversationRuntimeContextEntry & {
  accountId: string;
  conversationId: string;
};

export type ConversationStoreOptions = {
  respond?: ConversationResponder;
  responder?: ConversationResponder;
};

export type ConversationSendResult =
  | {
      status: "completed";
      session: ConversationRuntimeSession;
      reply: string;
    }
  | {
      status: "failed";
      session: ConversationRuntimeSession;
      errorCode: "CONVERSATION_REPLY_FAILED";
      retainedDraft: { text: string; attachments: readonly string[] };
    };

export class ConversationStoreError extends Error {
  constructor(readonly code:
    | "SESSION_NOT_FOUND"
    | "STALE_REVISION"
    | "INVALID_MESSAGE"
    | "CONVERSATION_BUSY"
    | "REQUEST_ID_CONFLICT") {
    super(code);
    this.name = "ConversationStoreError";
  }
}

type ConversationRow = {
  id: string;
  revision: number;
  state: ConversationRuntimeSession | string;
};

const asPostgresJson = (session: ConversationRuntimeSession): Parameters<Sql["json"]>[0] =>
  JSON.parse(JSON.stringify(session)) as Parameters<Sql["json"]>[0];

const unconfiguredResponder = createConversationResponder();

export class ConversationStore {
  readonly #sql: Sql;
  readonly #domain: ConversationStateMachine;
  readonly #respond: ConversationResponder;

  constructor(sql: Sql, domain: ConversationStateMachine, options: ConversationStoreOptions = {}) {
    this.#sql = sql;
    this.#domain = domain;
    this.#respond = options.responder ?? options.respond ?? unconfiguredResponder;
  }

  async createSession(accountId: string, conversationId: string): Promise<ConversationRuntimeSession> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(conversationId, "CONVERSATION_ID_REQUIRED");
    const existing = await this.#read(accountId, conversationId);
    if (existing) return cloneConversationSession(existing);

    const [foreign] = await this.#sql<{ id: string }[]>`
      SELECT id FROM conversations WHERE id = ${conversationId}
    `;
    if (foreign) throw new ConversationStoreError("SESSION_NOT_FOUND");

    const session = this.#domain.createSession(conversationId);
    await this.#sql`
      INSERT INTO conversations (id, account_id, revision, state, deleted, updated_at)
      VALUES (
        ${conversationId},
        ${accountId},
        ${session.revision},
        ${this.#sql.json(asPostgresJson(session))},
        ${session.deleted},
        now()
      )
    `;
    return cloneConversationSession(session);
  }

  async getSession(accountId: string, conversationId: string): Promise<ConversationRuntimeSession | null> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    assertIdentifier(conversationId, "CONVERSATION_ID_REQUIRED");
    const session = await this.#read(accountId, conversationId);
    return session ? cloneConversationSession(session) : null;
  }

  async listSessions(accountId: string, query = ""): Promise<ConversationRuntimeSession[]> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    const normalizedQuery = query.trim();
    const searchPattern = `%${normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = await this.#sql<ConversationRow[]>`
      SELECT id, revision, state
      FROM conversations
      WHERE account_id = ${accountId}
        AND deleted = false
        AND (
          ${normalizedQuery} = ''
          OR id ILIKE ${searchPattern}
          OR state::text ILIKE ${searchPattern}
        )
      ORDER BY updated_at DESC, id DESC
    `;
    return rows.map((row) => cloneConversationSession(parseSession(row)));
  }

  async saveSession(
    accountId: string,
    session: ConversationRuntimeSession,
    expectedRevision: number,
    messages: readonly ConversationMessageRecord[] = [],
  ): Promise<"saved" | "stale"> {
    assertIdentifier(accountId, "ACCOUNT_ID_REQUIRED");
    const result = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<ConversationRow[]>`
        UPDATE conversations
        SET revision = ${session.revision},
            state = ${transaction.json(asPostgresJson(session))},
            deleted = ${session.deleted},
            updated_at = now()
        WHERE id = ${session.id}
          AND account_id = ${accountId}
          AND revision = ${expectedRevision}
        RETURNING id
      `;
      if (!rows.length) return "stale" as const;
      await insertMessages(transaction, messages);
      return "saved" as const;
    });
    return result;
  }

  async sendText(input: {
    accountId: string;
    conversationId: string;
    requestId: string;
    text: string;
  }): Promise<ConversationSendResult> {
    if (!input.text.trim()) throw new ConversationStoreError("INVALID_MESSAGE");
    assertIdentifier(input.requestId, "REQUEST_ID_REQUIRED");
    const current = await this.getSession(input.accountId, input.conversationId);
    if (!current) throw new ConversationStoreError("SESSION_NOT_FOUND");

    const requestHistory = findRequestHistory(current, input.requestId);
    if (requestHistory.hasRequest) {
      if (
        requestHistory.userEntries.length === 0
        || requestHistory.userEntries.some((entry) => entry.text !== input.text)
      ) {
        throw new ConversationStoreError("REQUEST_ID_CONFLICT");
      }
      const completedEntry = requestHistory.assistantEntries.at(-1);
      if (completedEntry) {
        return {
          status: "completed",
          session: cloneConversationSession(current),
          reply: completedEntry.text,
        };
      }
      if (current.activeRun) throw new ConversationStoreError("CONVERSATION_BUSY");
    } else if (current.activeRun) {
      throw new ConversationStoreError("CONVERSATION_BUSY");
    }

    const draft = { text: input.text, attachments: [] as const };
    let userEntry: ConversationRuntimeContextEntry | null = null;
    let running: ConversationRuntimeSession;
    try {
      const withDraft = this.#domain.updateDraft(current, current.revision, draft);
      let withUser = withDraft;
      if (requestHistory.userEntries.length === 0) {
        userEntry = {
          id: `${input.requestId}:user`,
          role: "user",
          text: input.text,
          requestId: input.requestId,
        };
        withUser = this.#domain.appendContext(withDraft, withDraft.revision, userEntry);
      }
      running = this.#domain.startRun(withUser, {
        expectedRevision: withUser.revision,
        requestId: input.requestId,
        kind: "response",
      });
    } catch (error) {
      throw mapStateError(error);
    }

    const initialSave = await this.saveSession(
      input.accountId,
      running,
      current.revision,
      userEntry ? [messageRecord(input.accountId, input.conversationId, userEntry)] : [],
    );
    if (initialSave === "stale") throw new ConversationStoreError("STALE_REVISION");

    try {
      const reply = await this.#respond(input.text, running.context);
      const assistantEntry: ConversationRuntimeContextEntry = {
        id: `${input.requestId}:assistant`,
        role: "assistant",
        text: reply,
        requestId: input.requestId,
      };
      const settled = this.#domain.settleRun(running, {
        requestId: input.requestId,
        status: "completed",
        contextEntry: assistantEntry,
      });
      const completed = this.#domain.updateDraft(settled, settled.revision, null);
      const saved = await this.saveSession(
        input.accountId,
        completed,
        running.revision,
        [messageRecord(input.accountId, input.conversationId, assistantEntry)],
      );
      if (saved === "stale") throw new ConversationStoreError("STALE_REVISION");
      return { status: "completed", session: cloneConversationSession(completed), reply };
    } catch (error) {
      if (error instanceof ConversationStoreError && error.code === "STALE_REVISION") throw error;
      const failed = this.#domain.settleRun(running, {
        requestId: input.requestId,
        status: "failed",
      });
      const saved = await this.saveSession(input.accountId, failed, running.revision);
      if (saved === "stale") throw new ConversationStoreError("STALE_REVISION");
      return {
        status: "failed",
        session: cloneConversationSession(failed),
        errorCode: "CONVERSATION_REPLY_FAILED",
        retainedDraft: draft,
      };
    }
  }

  async #read(accountId: string, conversationId: string): Promise<ConversationRuntimeSession | null> {
    const [row] = await this.#sql<ConversationRow[]>`
      SELECT id, revision, state
      FROM conversations
      WHERE id = ${conversationId} AND account_id = ${accountId}
    `;
    return row ? parseSession(row) : null;
  }
}

async function insertMessages(
  transaction: TransactionSql,
  messages: readonly ConversationMessageRecord[],
) {
  for (const message of messages) {
    await transaction`
      INSERT INTO messages (
        id, account_id, conversation_id, role, text, request_id
      )
      VALUES (
        ${message.id},
        ${message.accountId},
        ${message.conversationId},
        ${message.role},
        ${message.text},
        ${message.requestId ?? null}
      )
      ON CONFLICT (account_id, conversation_id, id) DO NOTHING
    `;
  }
}

function messageRecord(
  accountId: string,
  conversationId: string,
  entry: ConversationRuntimeContextEntry,
): ConversationMessageRecord {
  return { ...entry, accountId, conversationId };
}

function findRequestHistory(
  session: ConversationRuntimeSession,
  requestId: string,
) {
  const entries = session.context.filter((entry) =>
    entry.requestId === requestId
    || entry.id === `${requestId}:user`
    || entry.id === `${requestId}:assistant`,
  );
  return {
    hasRequest: entries.length > 0,
    userEntries: entries.filter((entry) => entry.role === "user"),
    assistantEntries: entries.filter((entry) => entry.role === "assistant"),
  };
}

function parseSession(row: ConversationRow): ConversationRuntimeSession {
  const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
  if (!state || typeof state !== "object") throw new Error("CONVERSATION_STATE_INVALID");
  return state as ConversationRuntimeSession;
}

function assertIdentifier(value: string, code: string) {
  if (!value.trim() || value.length > 160) throw new Error(code);
}

function mapStateError(error: unknown): Error {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (code === "STALE_REVISION") return new ConversationStoreError("STALE_REVISION");
    if (code === "CONVERSATION_BUSY") return new ConversationStoreError("CONVERSATION_BUSY");
  }
  return error instanceof Error ? error : new Error("CONVERSATION_STATE_FAILED");
}
