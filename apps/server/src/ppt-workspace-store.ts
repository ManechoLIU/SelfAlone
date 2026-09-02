import { randomUUID } from "node:crypto";
import type { PptWorkspaceSnapshot, PptWorkspaceSource } from "@selfalone/contracts";
import type { Sql, TransactionSql } from "postgres";

export const PPT_WORKSPACE_INTEGER_MAX = 2_147_483_647;
export const PPT_WORKSPACE_PAGE_COUNT_MAX = PPT_WORKSPACE_INTEGER_MAX;
export const PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX = PPT_WORKSPACE_INTEGER_MAX - 1;

export type PptWorkspaceStoreErrorCode =
  | "PPT_INTENT_CONFLICT"
  | "PPT_INTENT_NOT_SENT"
  | "PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION"
  | "PPT_SOURCE_CARDINALITY_INVALID"
  | "PPT_WORKSPACE_INVALID_REQUIREMENTS"
  | "PPT_WORKSPACE_NOT_FOUND"
  | "PPT_WORKSPACE_STAGE_UNSUPPORTED"
  | "PPT_WORKSPACE_STALE";

export class PptWorkspaceStoreError extends Error {
  readonly code: PptWorkspaceStoreErrorCode;

  constructor(code: PptWorkspaceStoreErrorCode) {
    super(code);
    this.name = "PptWorkspaceStoreError";
    this.code = code;
  }
}

type DraftRow = {
  id: string;
  conversationId: string;
  stage: string;
  version: number;
  purpose: string | null;
  audience: string | null;
  pageMin: number | null;
  pageMax: number | null;
  additionalRequirements: string;
};

type SourceRow = PptWorkspaceSource & { sourceOrder: number };

export class PptWorkspaceStore {
  constructor(private readonly sql: Sql) {}

  async createFromSentIntent(input: {
    accountId: string;
    conversationId: string;
    bookId: string;
    requestId: string;
  }): Promise<{ status: "created" | "reused"; workspace: PptWorkspaceSnapshot }> {
    const accountId = input.accountId.trim();
    const conversationId = input.conversationId.trim();
    const bookId = input.bookId.trim();
    const requestId = input.requestId.trim();
    if (!accountId || !conversationId || !bookId) {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
    }
    if (!requestId) throw new PptWorkspaceStoreError("PPT_INTENT_NOT_SENT");

    const result = await this.sql.begin(async (transaction) => {
      const [conversation] = await transaction<Array<{ id: string }>>`
        SELECT id
        FROM conversations
        WHERE account_id = ${accountId} AND id = ${conversationId} AND deleted = false
        FOR UPDATE
      `;
      if (!conversation) {
        throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
      }

      const [existing] = await transaction<Array<{ id: string; intentSourceBookId: string | null }>>`
        SELECT id, intent_source_book_id AS "intentSourceBookId"
        FROM ppt_drafts
        WHERE account_id = ${accountId}
          AND conversation_id = ${conversationId}
          AND intent_request_id = ${requestId}
        FOR UPDATE
      `;
      if (existing) {
        if (existing.intentSourceBookId !== bookId) {
          throw new PptWorkspaceStoreError("PPT_INTENT_CONFLICT");
        }
        return { status: "reused" as const, draftId: existing.id };
      }

      const [book] = await transaction<Array<{ id: string }>>`
        SELECT id
        FROM books
        WHERE account_id = ${accountId} AND id = ${bookId}
      `;
      if (!book) {
        throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
      }

      const [sentMessage] = await transaction<Array<{ id: string }>>`
        SELECT id
        FROM messages
        WHERE account_id = ${accountId}
          AND conversation_id = ${conversationId}
          AND request_id = ${requestId}
          AND role = 'user'
        LIMIT 1
      `;
      if (!sentMessage) throw new PptWorkspaceStoreError("PPT_INTENT_NOT_SENT");

      const draftId = randomUUID();
      const [inserted] = await transaction<Array<{ id: string }>>`
        INSERT INTO ppt_drafts (
          id, account_id, conversation_id, stage, version,
          requirements, outline, intent_request_id, intent_source_book_id
        ) VALUES (
          ${draftId}, ${accountId}, ${conversationId}, 'requirements', 1,
          '', '[]'::jsonb, ${requestId}, ${bookId}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted) {
        await transaction`
          INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
          VALUES (${accountId}, ${draftId}, ${bookId}, 0)
        `;
        return { status: "created" as const, draftId };
      }

      const [racedExisting] = await transaction<Array<{ id: string; intentSourceBookId: string | null }>>`
        SELECT id, intent_source_book_id AS "intentSourceBookId"
        FROM ppt_drafts
        WHERE account_id = ${accountId}
          AND conversation_id = ${conversationId}
          AND intent_request_id = ${requestId}
        FOR UPDATE
      `;
      if (!racedExisting) throw new PptWorkspaceStoreError("PPT_INTENT_CONFLICT");
      if (racedExisting.intentSourceBookId !== bookId) {
        throw new PptWorkspaceStoreError("PPT_INTENT_CONFLICT");
      }
      return { status: "reused" as const, draftId: racedExisting.id };
    });

    const workspace = await this.getWorkspace(accountId, result.draftId);
    if (!workspace) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
    return { status: result.status, workspace };
  }

  async getWorkspace(accountIdInput: string, draftIdInput: string) {
    const accountId = accountIdInput.trim();
    const draftId = draftIdInput.trim();
    if (!accountId || !draftId) return null;

    return this.#getWorkspaceWith(this.sql, accountId, draftId);
  }

  async saveRequirements(input: {
    accountId: string;
    draftId: string;
    expectedVersion: number;
    requirements: {
      purpose: string;
      audience: string;
      pageRange: { min: number; max: number };
      additionalRequirements: string;
    };
  }): Promise<PptWorkspaceSnapshot> {
    const accountId = input.accountId.trim();
    const draftId = input.draftId.trim();
    const purpose = input.requirements.purpose.trim();
    const audience = input.requirements.audience.trim();
    const additionalRequirements = input.requirements.additionalRequirements.trim();
    const { min, max } = input.requirements.pageRange;
    if (!accountId || !draftId) {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
    }
    if (
      !purpose
      || !audience
      || !Number.isSafeInteger(input.expectedVersion)
      || input.expectedVersion < 1
      || input.expectedVersion > PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX
      || !Number.isSafeInteger(min)
      || !Number.isSafeInteger(max)
      || min < 1
      || min > PPT_WORKSPACE_PAGE_COUNT_MAX
      || max > PPT_WORKSPACE_PAGE_COUNT_MAX
      || max < min
    ) {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_INVALID_REQUIREMENTS");
    }

    return this.sql.begin(async (transaction) => {
      const updated = await transaction<Array<{ id: string }>>`
        UPDATE ppt_drafts
        SET purpose = ${purpose}, audience = ${audience},
            page_min = ${min}, page_max = ${max},
            additional_requirements = ${additionalRequirements},
            version = version + 1, updated_at = now()
        WHERE account_id = ${accountId} AND id = ${draftId}
          AND stage = 'requirements' AND version = ${input.expectedVersion}
        RETURNING id
      `;
      if (!updated.length) {
        const [current] = await transaction<Array<{ stage: string; version: number }>>`
          SELECT stage, version
          FROM ppt_drafts
          WHERE account_id = ${accountId} AND id = ${draftId}
        `;
        if (!current) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
        if (current.version !== input.expectedVersion) {
          throw new PptWorkspaceStoreError("PPT_WORKSPACE_STALE");
        }
        throw new PptWorkspaceStoreError("PPT_WORKSPACE_STAGE_UNSUPPORTED");
      }
      const workspace = await this.#getWorkspaceWith(transaction, accountId, draftId);
      if (!workspace) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
      return workspace;
    });
  }

  async replaceSource(input: {
    accountId: string;
    draftId: string;
    expectedVersion: number;
    bookId: string;
  }): Promise<PptWorkspaceSnapshot> {
    const accountId = input.accountId.trim();
    const draftId = input.draftId.trim();
    const bookId = input.bookId.trim();
    if (!accountId || !draftId || !bookId) {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
    }
    if (
      !Number.isSafeInteger(input.expectedVersion)
      || input.expectedVersion < 1
      || input.expectedVersion > PPT_WORKSPACE_PAGE_COUNT_MAX
    ) {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_STALE");
    }

    return this.sql.begin(async (transaction) => {
      const [draft] = await transaction<Array<{ stage: string; version: number }>>`
        SELECT stage, version
        FROM ppt_drafts
        WHERE account_id = ${accountId} AND id = ${draftId}
        FOR UPDATE
      `;
      if (!draft) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
      if (draft.version !== input.expectedVersion) {
        throw new PptWorkspaceStoreError("PPT_WORKSPACE_STALE");
      }
      if (draft.stage !== "requirements") {
        throw new PptWorkspaceStoreError("PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION");
      }

      const [book] = await transaction<Array<{ id: string }>>`
        SELECT id FROM books
        WHERE account_id = ${accountId} AND id = ${bookId}
      `;
      if (!book) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");

      const sources = await transaction<Array<{ bookId: string; sourceOrder: number }>>`
        SELECT book_id AS "bookId", source_order AS "sourceOrder"
        FROM ppt_draft_sources
        WHERE account_id = ${accountId} AND draft_id = ${draftId}
        ORDER BY source_order, book_id
        FOR UPDATE
      `;
      if (sources.length !== 1 || sources[0]?.sourceOrder !== 0) {
        throw new PptWorkspaceStoreError("PPT_SOURCE_CARDINALITY_INVALID");
      }

      if (sources[0].bookId !== bookId) {
        if (draft.version > PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX) {
          throw new PptWorkspaceStoreError("PPT_WORKSPACE_STALE");
        }
        await transaction`
          DELETE FROM ppt_draft_sources
          WHERE account_id = ${accountId} AND draft_id = ${draftId}
        `;
        await transaction`
          INSERT INTO ppt_draft_sources (account_id, draft_id, book_id, source_order)
          VALUES (${accountId}, ${draftId}, ${bookId}, 0)
        `;
        await transaction`
          UPDATE ppt_drafts
          SET version = version + 1, updated_at = now()
          WHERE account_id = ${accountId} AND id = ${draftId}
        `;
      }

      const workspace = await this.#getWorkspaceWith(transaction, accountId, draftId);
      if (!workspace) throw new PptWorkspaceStoreError("PPT_WORKSPACE_NOT_FOUND");
      return workspace;
    });
  }

  async #getWorkspaceWith(
    query: Sql | TransactionSql,
    accountId: string,
    draftId: string,
  ): Promise<PptWorkspaceSnapshot | null> {
    const rows = await query<Array<DraftRow & Partial<SourceRow>>>`
      SELECT draft.id, draft.conversation_id AS "conversationId", draft.stage, draft.version,
             draft.purpose, draft.audience, draft.page_min AS "pageMin",
             draft.page_max AS "pageMax",
             draft.additional_requirements AS "additionalRequirements",
             source.book_id AS "bookId", source.source_order AS "sourceOrder",
             book.title, book.author, book.source_label AS "sourceLabel"
      FROM ppt_drafts AS draft
      LEFT JOIN ppt_draft_sources AS source
        ON source.account_id = draft.account_id AND source.draft_id = draft.id
      LEFT JOIN books AS book
        ON book.account_id = source.account_id AND book.id = source.book_id
      WHERE draft.account_id = ${accountId} AND draft.id = ${draftId}
      ORDER BY source.source_order, source.book_id
    `;
    const [draft] = rows;
    if (!draft) return null;
    if (draft.stage !== "requirements") {
      throw new PptWorkspaceStoreError("PPT_WORKSPACE_STAGE_UNSUPPORTED");
    }

    const sources = rows.flatMap((row) => {
      if (
        row.bookId == null
        || row.sourceOrder == null
        || row.title == null
        || row.sourceLabel == null
      ) {
        return [];
      }
      return [{
        bookId: row.bookId,
        sourceOrder: row.sourceOrder,
        title: row.title,
        author: row.author ?? null,
        sourceLabel: row.sourceLabel,
      } satisfies SourceRow];
    });
    if (sources.length !== 1 || sources[0]?.sourceOrder !== 0) {
      throw new PptWorkspaceStoreError("PPT_SOURCE_CARDINALITY_INVALID");
    }

    const [source] = sources;
    return {
      draft: {
        id: draft.id,
        conversationId: draft.conversationId,
        stage: "requirements" as const,
        version: draft.version,
        requirements: {
          purpose: draft.purpose,
          audience: draft.audience,
          pageRange: draft.pageMin === null && draft.pageMax === null
            ? null
            : { min: requiredPageValue(draft.pageMin), max: requiredPageValue(draft.pageMax) },
          additionalRequirements: draft.additionalRequirements,
        },
      },
      sources: [{
        bookId: source.bookId,
        title: source.title,
        author: source.author,
        sourceLabel: source.sourceLabel,
      }],
    } satisfies PptWorkspaceSnapshot;
  }
}

function requiredPageValue(value: number | null) {
  if (value === null) throw new PptWorkspaceStoreError("PPT_WORKSPACE_STAGE_UNSUPPORTED");
  return value;
}
