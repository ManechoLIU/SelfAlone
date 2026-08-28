import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  TextAnnotationList as TextAnnotationListDto,
  TextHighlight,
  TextLocator,
  TextNote,
} from "@selfalone/contracts";
import {
  createTextHighlightDraft,
  createTextNoteDraft,
  TEXT_ANNOTATION_LIMITS,
  validateTextAnnotationSource,
} from "@selfalone/domain";
import type { TextAnnotationSource as DomainTextAnnotationSource } from "@selfalone/domain";
import { resolveAccountOwner } from "./account-owner";

const MAX_SECTION_ID_LENGTH = TEXT_ANNOTATION_LIMITS.maxSectionIdLength;
const MAX_QUOTE_LENGTH = TEXT_ANNOTATION_LIMITS.maxQuoteLength;
const MAX_THOUGHT_LENGTH = TEXT_ANNOTATION_LIMITS.maxThoughtLength;
const MAX_NOTE_BODY_LENGTH = TEXT_ANNOTATION_LIMITS.maxNoteBodyLength;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** Text annotation source semantics follow the shared ReadingLocator/TextLocator contract. */
export type TextAnnotationSource = DomainTextAnnotationSource;

export type TextHighlightRecord = TextHighlight;
export type TextNoteRecord = TextNote;

export type CreateTextHighlightInput = {
  idempotencyKey: string;
  locator: TextLocator;
  endOffset: number;
  quote?: string;
  thought?: string | null;
};

export type UpdateTextHighlightInput = {
  expectedVersion: number;
  thought: string | null;
};

export type CreateTextNoteInput = {
  idempotencyKey: string;
  body: string;
  source?: TextAnnotationSource | null;
};

export type UpdateTextNoteInput = {
  expectedVersion: number;
  body: string;
  /** Optional stable key for replaying one update after an uncertain response. */
  idempotencyKey?: string;
  /** Echoed by clients so a failed save can restore the complete anchored draft. */
  source?: TextAnnotationSource | null;
};

export type TextHighlightRecordInput = TextAnnotationSource & {
  thought: string | null;
};

export type TextNoteRecordInput = {
  body: string;
  source: TextAnnotationSource | null;
};

type TextHighlightDraft = TextHighlightRecordInput & { idempotencyKey: string };
type TextNoteDraft = TextNoteRecordInput & { idempotencyKey: string };

export type TextAnnotationRepository = {
  getCurrentTextBook(accountId: string, bookId: string): Promise<{ fileVersion: number }>;
  getTextSection(
    accountId: string,
    bookId: string,
    fileVersion: number,
    sectionId: string,
  ): Promise<{ sectionId: string; text: string } | null>;
  listHighlights(accountId: string, bookId: string, fileVersion: number): Promise<TextHighlightRecord[]>;
  listNotes(accountId: string, bookId: string, fileVersion: number): Promise<TextNoteRecord[]>;
  getNote(accountId: string, bookId: string, noteId: string): Promise<TextNoteRecord | null>;
  createHighlight(input: {
    accountId: string;
    bookId: string;
    draft: TextHighlightDraft;
  }): Promise<TextHighlightRecord>;
  updateHighlight(input: {
    accountId: string;
    bookId: string;
    highlightId: string;
    expectedVersion: number;
    thought: string | null;
    fileVersion: number;
  }): Promise<TextHighlightRecord | null | "stale">;
  deleteHighlight(input: {
    accountId: string;
    bookId: string;
    highlightId: string;
    expectedVersion: number;
    fileVersion: number;
  }): Promise<boolean | "stale">;
  createNote(input: {
    accountId: string;
    bookId: string;
    draft: TextNoteDraft;
  }): Promise<TextNoteRecord>;
  updateNote(input: {
    accountId: string;
    bookId: string;
    noteId: string;
    expectedVersion: number;
    body: string;
    fileVersion?: number;
    idempotencyKey?: string;
    source?: TextAnnotationSource | null;
  }): Promise<TextNoteRecord | null | "stale">;
  deleteNote(input: {
    accountId: string;
    bookId: string;
    noteId: string;
    expectedVersion: number;
    fileVersion: number;
  }): Promise<boolean | "stale">;
};

type TextAnnotationList = TextAnnotationListDto;

function normalizeBody(value: string) {
  const body = value.trim();
  if (!body) throw new Error("NOTE_BODY_REQUIRED");
  if (body.length > MAX_NOTE_BODY_LENGTH) throw new Error("TEXT_TOO_LONG");
  return body;
}

function normalizeThought(value: string | null | undefined) {
  const thought = value?.trim() || null;
  if (thought && thought.length > MAX_THOUGHT_LENGTH) throw new Error("TEXT_TOO_LONG");
  return thought;
}

function normalizeIdempotencyKey(value: string) {
  const key = value.trim();
  if (!key) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new Error("IDEMPOTENCY_KEY_TOO_LONG");
  return key;
}

function isControlError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return new Set([
    "ACCOUNT_FORBIDDEN",
    "BOOK_NOT_FOUND",
    "TEXT_CONTENT_UNAVAILABLE",
    "STALE_VERSION",
    "SECTION_NOT_FOUND",
    "INVALID_VERSION",
    "INVALID_FILE_VERSION",
    "INVALID_LOCATOR",
    "INVALID_HIGHLIGHT_RANGE",
    "INVALID_HIGHLIGHT_QUOTE",
    "NOTE_BODY_REQUIRED",
    "TEXT_TOO_LONG",
    "IDEMPOTENCY_KEY_REQUIRED",
    "IDEMPOTENCY_KEY_TOO_LONG",
    "IDEMPOTENCY_KEY_REUSED",
    "HIGHLIGHT_NOT_FOUND",
    "NOTE_NOT_FOUND",
  ]).has(code);
}

export class TextAnnotationService {
  constructor(protected readonly repository: TextAnnotationRepository) {}

  async list(accountId: string, bookId: string): Promise<TextAnnotationList> {
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    const [allHighlights, allNotes] = await Promise.all([
      this.repository.listHighlights(accountId, bookId, book.fileVersion),
      this.repository.listNotes(accountId, bookId, book.fileVersion),
    ]);
    const highlights = allHighlights.filter((highlight) => highlight.locator.fileVersion === book.fileVersion);
    const notes = allNotes.filter((note) => note.source === null || note.source.locator.fileVersion === book.fileVersion);
    return { fileVersion: book.fileVersion, highlights, notes };
  }

  async createHighlight(accountId: string, bookId: string, value: CreateTextHighlightInput) {
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    if (value.locator.kind !== "text") throw new Error("INVALID_LOCATOR");
    if (value.locator.fileVersion !== book.fileVersion) throw new Error("STALE_VERSION");
    const section = await this.repository.getTextSection(
      accountId,
      bookId,
      book.fileVersion,
      value.locator.sectionId,
    );
    if (!section) throw new Error("SECTION_NOT_FOUND");
    const draft = {
      idempotencyKey: normalizeIdempotencyKey(value.idempotencyKey),
      ...createTextHighlightDraft({
        section: { ...section, fileVersion: book.fileVersion },
        locator: value.locator,
        endOffset: value.endOffset,
        quote: value.quote,
        thought: value.thought,
      }),
    } satisfies TextHighlightDraft;
    try {
      const highlight = await this.repository.createHighlight({ accountId, bookId, draft });
      return { status: "saved" as const, highlight };
    } catch (error) {
      if (isControlError(error)) throw error;
      return {
        status: "failed" as const,
        errorCode: "HIGHLIGHT_SAVE_FAILED" as const,
        retainedDraft: draft,
      };
    }
  }

  async updateHighlight(
    accountId: string,
    bookId: string,
    highlightId: string,
    value: UpdateTextHighlightInput,
  ) {
    if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) {
      throw new Error("INVALID_VERSION");
    }
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    const thought = normalizeThought(value.thought);
    try {
      const highlight = await this.repository.updateHighlight({
        accountId,
        bookId,
        highlightId,
        expectedVersion: value.expectedVersion,
        thought,
        fileVersion: book.fileVersion,
      });
      if (highlight === "stale") throw new Error("STALE_VERSION");
      if (!highlight) throw new Error("HIGHLIGHT_NOT_FOUND");
      return { status: "saved" as const, highlight };
    } catch (error) {
      if (isControlError(error)) throw error;
      return {
        status: "failed" as const,
        errorCode: "HIGHLIGHT_SAVE_FAILED" as const,
        retainedDraft: { thought },
      };
    }
  }

  async deleteHighlight(accountId: string, bookId: string, highlightId: string, expectedVersion: number) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("INVALID_VERSION");
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    try {
      const deleted = await this.repository.deleteHighlight({
        accountId,
        bookId,
        highlightId,
        expectedVersion,
        fileVersion: book.fileVersion,
      });
      if (deleted === "stale") throw new Error("STALE_VERSION");
      if (!deleted) throw new Error("HIGHLIGHT_NOT_FOUND");
      return { status: "deleted" as const, id: highlightId };
    } catch (error) {
      if (isControlError(error)) throw error;
      return { status: "failed" as const, errorCode: "HIGHLIGHT_DELETE_FAILED" as const, id: highlightId };
    }
  }

  async createNote(accountId: string, bookId: string, value: CreateTextNoteInput) {
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    const body = normalizeBody(value.body);
    let source: TextAnnotationSource | null = null;
    if (value.source) {
      if (value.source.locator.kind !== "text") throw new Error("INVALID_LOCATOR");
      if (value.source.locator.fileVersion !== book.fileVersion) throw new Error("STALE_VERSION");
      const section = await this.repository.getTextSection(
        accountId,
        bookId,
        book.fileVersion,
        value.source.locator.sectionId,
      );
      if (!section) throw new Error("SECTION_NOT_FOUND");
      source = validateTextAnnotationSource({
        section: { ...section, fileVersion: book.fileVersion },
        source: value.source,
      });
    }
    const draft = {
      idempotencyKey: normalizeIdempotencyKey(value.idempotencyKey),
      ...createTextNoteDraft({ body, source }),
    } satisfies TextNoteDraft;
    try {
      const note = await this.repository.createNote({ accountId, bookId, draft });
      return { status: "saved" as const, note };
    } catch (error) {
      if (isControlError(error)) throw error;
      return {
        status: "failed" as const,
        errorCode: "NOTE_SAVE_FAILED" as const,
        retainedDraft: draft,
      };
    }
  }

  async updateNote(
    accountId: string,
    bookId: string,
    noteId: string,
    value: UpdateTextNoteInput,
  ) {
    if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) {
      throw new Error("INVALID_VERSION");
    }
    const body = normalizeBody(value.body);
    const idempotencyKey = value.idempotencyKey === undefined
      ? undefined
      : normalizeIdempotencyKey(value.idempotencyKey);

    if (idempotencyKey !== undefined) {
      try {
        const note = await this.repository.updateNote({
          accountId,
          bookId,
          noteId,
          expectedVersion: value.expectedVersion,
          body,
          idempotencyKey,
          source: value.source ?? null,
        });
        if (note === "stale") throw new Error("STALE_VERSION");
        if (!note) throw new Error("NOTE_NOT_FOUND");
        return { status: "saved" as const, note };
      } catch (error) {
        if (isControlError(error)) throw error;
        let source: TextAnnotationSource | null = null;
        try {
          source = (await this.repository.getNote(accountId, bookId, noteId))?.source ?? null;
        } catch {
          // Keep the retryable operation fail-closed when its source cannot be read.
        }
        return {
          status: "failed" as const,
          errorCode: "NOTE_SAVE_FAILED" as const,
          retainedDraft: { body, source },
        };
      }
    }

    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    let existing: TextNoteRecord | null;
    try {
      existing = await this.repository.getNote(accountId, bookId, noteId);
    } catch {
      return {
        status: "failed" as const,
        errorCode: "NOTE_SOURCE_UNVERIFIED" as const,
        retainedDraft: { body, source: null },
      };
    }
    const retainedSource = existing?.source ?? null;
    try {
      const note = await this.repository.updateNote({
        accountId,
        bookId,
        noteId,
        expectedVersion: value.expectedVersion,
        body,
        fileVersion: book.fileVersion,
      });
      if (note === "stale") throw new Error("STALE_VERSION");
      if (!note) throw new Error("NOTE_NOT_FOUND");
      return { status: "saved" as const, note };
    } catch (error) {
      if (isControlError(error)) throw error;
      return {
        status: "failed" as const,
        errorCode: "NOTE_SAVE_FAILED" as const,
        retainedDraft: { body, source: retainedSource },
      };
    }
  }

  async deleteNote(accountId: string, bookId: string, noteId: string, expectedVersion: number) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("INVALID_VERSION");
    const book = await this.repository.getCurrentTextBook(accountId, bookId);
    try {
      const deleted = await this.repository.deleteNote({
        accountId,
        bookId,
        noteId,
        expectedVersion,
        fileVersion: book.fileVersion,
      });
      if (deleted === "stale") throw new Error("STALE_VERSION");
      if (!deleted) throw new Error("NOTE_NOT_FOUND");
      return { status: "deleted" as const, id: noteId };
    } catch (error) {
      if (isControlError(error)) throw error;
      return { status: "failed" as const, errorCode: "NOTE_DELETE_FAILED" as const, id: noteId };
    }
  }
}

type DateValue = Date | string;

type HighlightRow = {
  id: string;
  bookId: string;
  fileVersion: number;
  sectionId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  thought: string | null;
  version: number;
  createdAt: DateValue;
  updatedAt: DateValue;
};

type NoteRow = {
  id: string;
  bookId: string;
  body: string;
  fileVersion: number | null;
  sectionId: string | null;
  startOffset: number | null;
  endOffset: number | null;
  quote: string | null;
  version: number;
  createdAt: DateValue;
  updatedAt: DateValue;
};

type NoteUpdateIdempotencyRow = {
  idempotencyKey: string;
  accountId: string;
  bookId: string;
  noteId: string;
  expectedVersion: number;
  body: string;
  sourcePayload: TextAnnotationSource | null;
  result: TextNoteRecord;
};

function isoDate(value: DateValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function highlightRecord(row: HighlightRow): TextHighlightRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    locator: {
      kind: "text",
      fileVersion: row.fileVersion,
      sectionId: row.sectionId,
      offset: row.startOffset,
    },
    endOffset: row.endOffset,
    quote: row.quote,
    thought: row.thought,
    version: row.version,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function noteRecord(row: NoteRow): TextNoteRecord {
  const hasSource = row.fileVersion !== null;
  return {
    id: row.id,
    bookId: row.bookId,
    body: row.body,
    source: hasSource
      ? {
          locator: {
            kind: "text",
            fileVersion: row.fileVersion!,
            sectionId: row.sectionId!,
            offset: row.startOffset!,
          },
          endOffset: row.endOffset!,
          quote: row.quote!,
        }
      : null,
    version: row.version,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function sameHighlight(row: HighlightRow, draft: TextHighlightDraft) {
  return row.fileVersion === draft.locator.fileVersion
    && row.sectionId === draft.locator.sectionId
    && row.startOffset === draft.locator.offset
    && row.endOffset === draft.endOffset
    && row.quote === draft.quote
    && row.thought === draft.thought;
}

function sameNote(row: NoteRow, draft: TextNoteDraft) {
  const source = draft.source;
  const sourceMatches = source === null
    ? row.fileVersion === null
    : row.fileVersion === source.locator.fileVersion
      && row.sectionId === source.locator.sectionId
      && row.startOffset === source.locator.offset
      && row.endOffset === source.endOffset
      && row.quote === source.quote;
  return row.body === draft.body && sourceMatches;
}

function sameNoteUpdateRequest(
  row: NoteUpdateIdempotencyRow,
  input: {
    accountId: string;
    bookId: string;
    noteId: string;
    expectedVersion: number;
    body: string;
    source?: TextAnnotationSource | null;
  },
) {
  return row.accountId === input.accountId
    && row.bookId === input.bookId
    && row.noteId === input.noteId
    && row.expectedVersion === input.expectedVersion
    && row.body === input.body
    && sameAnnotationSource(row.sourcePayload, input.source ?? null);
}

function sameAnnotationSource(
  left: TextAnnotationSource | null,
  right: TextAnnotationSource | null,
) {
  if (!left || !right) return left === right;
  return left.locator.kind === right.locator.kind
    && left.locator.fileVersion === right.locator.fileVersion
    && left.locator.sectionId === right.locator.sectionId
    && left.locator.offset === right.locator.offset
    && left.endOffset === right.endOffset
    && left.quote === right.quote;
}

export class PostgresTextAnnotationRepository implements TextAnnotationRepository {
  constructor(private readonly sql: Sql) {}

  /** Production migration ownership remains with the total controller; this only probes it. */
  async assertSchemaReady() {
    try {
      await this.sql`SELECT 1 FROM highlights LIMIT 0`;
      await this.sql`SELECT 1 FROM notes LIMIT 0`;
      await this.sql`SELECT 1 FROM note_update_idempotency LIMIT 0`;
    } catch {
      throw new Error("TEXT_ANNOTATION_SCHEMA_MISSING");
    }
  }

  private async lockCurrentTextBook(transaction: TransactionSql, accountId: string, bookId: string) {
    const [book] = await transaction<Array<{ localFormat: string; parseStatus: string }>>`
      SELECT local_format AS "localFormat", parse_status AS "parseStatus"
      FROM books
      WHERE account_id = ${accountId} AND id = ${bookId}
      FOR UPDATE
    `;
    if (!book) throw new Error("BOOK_NOT_FOUND");
    if (book.localFormat !== "epub" && book.localFormat !== "txt") {
      throw new Error("TEXT_CONTENT_UNAVAILABLE");
    }
    if (book.parseStatus !== "ready_text") throw new Error("TEXT_CONTENT_UNAVAILABLE");
    const [file] = await transaction<Array<{ fileVersion: number }>>`
      SELECT version AS "fileVersion"
      FROM book_files
      WHERE account_id = ${accountId} AND book_id = ${bookId}
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE
    `;
    if (!file) throw new Error("BOOK_NOT_FOUND");
    return file.fileVersion;
  }

  async getCurrentTextBook(accountId: string, bookId: string) {
    const [book] = await this.sql<Array<{ fileVersion: number }>>`
      SELECT file.version AS "fileVersion"
      FROM book_files AS file
      JOIN books AS book
        ON book.account_id = file.account_id AND book.id = file.book_id
      WHERE file.account_id = ${accountId}
        AND file.book_id = ${bookId}
        AND book.local_format IN ('epub', 'txt')
        AND book.parse_status = 'ready_text'
      ORDER BY file.version DESC
      LIMIT 1
    `;
    if (!book) throw new Error("BOOK_NOT_FOUND");
    return book;
  }

  async getTextSection(accountId: string, bookId: string, fileVersion: number, sectionId: string) {
    const [section] = await this.sql<Array<{ sectionId: string; text: string }>>`
      SELECT section_id AS "sectionId", body AS text
      FROM book_sections
      WHERE account_id = ${accountId} AND book_id = ${bookId}
        AND file_version = ${fileVersion} AND section_id = ${sectionId}
    `;
    return section ?? null;
  }

  async listHighlights(accountId: string, bookId: string, fileVersion: number) {
    const rows = await this.sql<HighlightRow[]>`
      SELECT id, book_id AS "bookId", file_version AS "fileVersion",
             section_id AS "sectionId", start_offset AS "startOffset",
             end_offset AS "endOffset", quote, thought, version,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM highlights
      WHERE account_id = ${accountId} AND book_id = ${bookId} AND file_version = ${fileVersion}
      ORDER BY created_at DESC, id DESC
    `;
    return rows.map(highlightRecord);
  }

  async listNotes(accountId: string, bookId: string, fileVersion: number) {
    const rows = await this.sql<NoteRow[]>`
      SELECT id, book_id AS "bookId", body, file_version AS "fileVersion",
             section_id AS "sectionId", start_offset AS "startOffset",
             end_offset AS "endOffset", quote, version,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM notes
      WHERE account_id = ${accountId} AND book_id = ${bookId}
        AND (file_version IS NULL OR file_version = ${fileVersion})
      ORDER BY created_at DESC, id DESC
    `;
    return rows.map(noteRecord);
  }

  async getNote(accountId: string, bookId: string, noteId: string) {
    const [row] = await this.sql<NoteRow[]>`
      SELECT id, book_id AS "bookId", body, file_version AS "fileVersion",
             section_id AS "sectionId", start_offset AS "startOffset",
             end_offset AS "endOffset", quote, version,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM notes
      WHERE id = ${noteId} AND account_id = ${accountId} AND book_id = ${bookId}
    `;
    return row ? noteRecord(row) : null;
  }

  async createHighlight(input: { accountId: string; bookId: string; draft: TextHighlightDraft }) {
    return this.sql.begin(async (transaction) => {
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (currentFileVersion !== input.draft.locator.fileVersion) throw new Error("STALE_VERSION");
      const [existing] = await transaction<HighlightRow[]>`
        SELECT id, book_id AS "bookId", file_version AS "fileVersion",
               section_id AS "sectionId", start_offset AS "startOffset",
               end_offset AS "endOffset", quote, thought, version,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM highlights
        WHERE account_id = ${input.accountId} AND book_id = ${input.bookId}
          AND idempotency_key = ${input.draft.idempotencyKey}
        FOR UPDATE
      `;
      if (existing) {
        if (!sameHighlight(existing, input.draft)) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return highlightRecord(existing);
      }
      const [row] = await transaction<HighlightRow[]>`
        INSERT INTO highlights (
          id, account_id, book_id, idempotency_key, file_version, section_id,
          start_offset, end_offset, quote, thought
        ) VALUES (
          ${randomUUID()}, ${input.accountId}, ${input.bookId}, ${input.draft.idempotencyKey},
          ${input.draft.locator.fileVersion}, ${input.draft.locator.sectionId},
          ${input.draft.locator.offset}, ${input.draft.endOffset}, ${input.draft.quote},
          ${input.draft.thought}
        )
        RETURNING id, book_id AS "bookId", file_version AS "fileVersion",
                  section_id AS "sectionId", start_offset AS "startOffset",
                  end_offset AS "endOffset", quote, thought, version,
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      if (!row) throw new Error("HIGHLIGHT_CREATE_FAILED");
      return highlightRecord(row);
    });
  }

  async updateHighlight(input: {
    accountId: string;
    bookId: string;
    highlightId: string;
    expectedVersion: number;
    thought: string | null;
    fileVersion: number;
  }) {
    return this.sql.begin(async (transaction) => {
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (currentFileVersion !== input.fileVersion) throw new Error("STALE_VERSION");
      const [row] = await transaction<HighlightRow[]>`
        UPDATE highlights
        SET thought = ${input.thought}, version = version + 1, updated_at = now()
        WHERE id = ${input.highlightId} AND account_id = ${input.accountId}
          AND book_id = ${input.bookId} AND file_version = ${input.fileVersion}
          AND version = ${input.expectedVersion}
        RETURNING id, book_id AS "bookId", file_version AS "fileVersion",
                  section_id AS "sectionId", start_offset AS "startOffset",
                  end_offset AS "endOffset", quote, thought, version,
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      if (row) return highlightRecord(row);
      return this.highlightConflict(transaction, input);
    });
  }

  async deleteHighlight(input: {
    accountId: string;
    bookId: string;
    highlightId: string;
    expectedVersion: number;
    fileVersion: number;
  }) {
    return this.sql.begin(async (transaction) => {
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (currentFileVersion !== input.fileVersion) throw new Error("STALE_VERSION");
      const result = await transaction`
        DELETE FROM highlights
        WHERE id = ${input.highlightId} AND account_id = ${input.accountId}
          AND book_id = ${input.bookId} AND file_version = ${input.fileVersion}
          AND version = ${input.expectedVersion}
      `;
      if (result.count > 0) return true;
      const conflict = await this.highlightConflict(transaction, input);
      return conflict ?? false;
    });
  }

  private async highlightConflict(
    transaction: TransactionSql,
    input: { accountId: string; bookId: string; highlightId: string; expectedVersion: number; fileVersion: number },
  ): Promise<"stale" | null> {
    const [row] = await transaction<Array<{ fileVersion: number; version: number }>>`
      SELECT file_version AS "fileVersion", version
      FROM highlights
      WHERE id = ${input.highlightId} AND account_id = ${input.accountId} AND book_id = ${input.bookId}
    `;
    if (!row) return null;
    if (row.fileVersion !== input.fileVersion || row.version !== input.expectedVersion) return "stale";
    throw new Error("HIGHLIGHT_UPDATE_FAILED");
  }

  async createNote(input: { accountId: string; bookId: string; draft: TextNoteDraft }) {
    return this.sql.begin(async (transaction) => {
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (input.draft.source && input.draft.source.locator.fileVersion !== currentFileVersion) {
        throw new Error("STALE_VERSION");
      }
      const [existing] = await transaction<NoteRow[]>`
        SELECT id, book_id AS "bookId", body, file_version AS "fileVersion",
               section_id AS "sectionId", start_offset AS "startOffset",
               end_offset AS "endOffset", quote, version,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM notes
        WHERE account_id = ${input.accountId} AND book_id = ${input.bookId}
          AND idempotency_key = ${input.draft.idempotencyKey}
        FOR UPDATE
      `;
      if (existing) {
        if (!sameNote(existing, input.draft)) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return noteRecord(existing);
      }
      const source = input.draft.source;
      const [row] = await transaction<NoteRow[]>`
        INSERT INTO notes (
          id, account_id, book_id, idempotency_key, body,
          file_version, section_id, start_offset, end_offset, quote
        ) VALUES (
          ${randomUUID()}, ${input.accountId}, ${input.bookId}, ${input.draft.idempotencyKey},
          ${input.draft.body}, ${source?.locator.fileVersion ?? null},
          ${source?.locator.sectionId ?? null}, ${source?.locator.offset ?? null},
          ${source?.endOffset ?? null}, ${source?.quote ?? null}
        )
        RETURNING id, book_id AS "bookId", body, file_version AS "fileVersion",
                  section_id AS "sectionId", start_offset AS "startOffset",
                  end_offset AS "endOffset", quote, version,
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      if (!row) throw new Error("NOTE_CREATE_FAILED");
      return noteRecord(row);
    });
  }

  async updateNote(input: {
    accountId: string;
    bookId: string;
    noteId: string;
    expectedVersion: number;
    body: string;
    fileVersion?: number;
    idempotencyKey?: string;
    source?: TextAnnotationSource | null;
  }) {
    return this.sql.begin(async (transaction) => {
      const idempotencyKey = input.idempotencyKey;
      if (idempotencyKey !== undefined) {
        const [ownedBook] = await transaction<Array<{ id: string }>>`
          SELECT id
          FROM books
          WHERE account_id = ${input.accountId} AND id = ${input.bookId}
        `;
        if (!ownedBook) throw new Error("BOOK_NOT_FOUND");
        await transaction`
          SELECT pg_advisory_xact_lock(hashtext(${"text-note-update:" + input.accountId + ":" + idempotencyKey}))
        `;
        const [replayed] = await transaction<Array<{
          idempotencyKey: string;
          accountId: string;
          bookId: string;
          noteId: string;
          expectedVersion: number;
          body: string;
          sourcePayload: unknown;
          result: unknown;
        }>>`
          SELECT idempotency_key AS "idempotencyKey",
                 account_id AS "accountId", book_id AS "bookId", note_id AS "noteId",
                 expected_version AS "expectedVersion", body,
                 source_payload AS "sourcePayload", result
          FROM note_update_idempotency
          WHERE account_id = ${input.accountId} AND idempotency_key = ${idempotencyKey}
          FOR UPDATE
        `;
        if (replayed) {
          const replay = {
            ...replayed,
            sourcePayload: replayed.sourcePayload as TextAnnotationSource | null,
            result: replayed.result as TextNoteRecord,
          } satisfies NoteUpdateIdempotencyRow;
          if (!sameNoteUpdateRequest(replay, input)) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
          }
          return replay.result;
        }
      }
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (input.fileVersion !== undefined && currentFileVersion !== input.fileVersion) {
        throw new Error("STALE_VERSION");
      }
      const [row] = await transaction<NoteRow[]>`
        UPDATE notes
        SET body = ${input.body}, version = version + 1, updated_at = now()
        WHERE id = ${input.noteId} AND account_id = ${input.accountId}
          AND book_id = ${input.bookId}
          AND (file_version IS NULL OR file_version = ${currentFileVersion})
          AND version = ${input.expectedVersion}
        RETURNING id, book_id AS "bookId", body, file_version AS "fileVersion",
                  section_id AS "sectionId", start_offset AS "startOffset",
                  end_offset AS "endOffset", quote, version,
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      if (!row) return this.noteConflict(transaction, { ...input, fileVersion: currentFileVersion });
      const note = noteRecord(row);
      if (idempotencyKey !== undefined) {
        await transaction`
          INSERT INTO note_update_idempotency (
            idempotency_key, account_id, book_id, note_id,
            expected_version, body, source_payload, result
          ) VALUES (
            ${idempotencyKey}, ${input.accountId}, ${input.bookId}, ${input.noteId},
            ${input.expectedVersion}, ${input.body},
            ${transaction.json(input.source ?? null)}, ${transaction.json(note)}
          )
        `;
      }
      return note;
    });
  }

  async deleteNote(input: {
    accountId: string;
    bookId: string;
    noteId: string;
    expectedVersion: number;
    fileVersion: number;
  }) {
    return this.sql.begin(async (transaction) => {
      const currentFileVersion = await this.lockCurrentTextBook(transaction, input.accountId, input.bookId);
      if (currentFileVersion !== input.fileVersion) throw new Error("STALE_VERSION");
      const result = await transaction`
        DELETE FROM notes
        WHERE id = ${input.noteId} AND account_id = ${input.accountId}
          AND book_id = ${input.bookId}
          AND (file_version IS NULL OR file_version = ${input.fileVersion})
          AND version = ${input.expectedVersion}
      `;
      if (result.count > 0) return true;
      const conflict = await this.noteConflict(transaction, input);
      return conflict ?? false;
    });
  }

  private async noteConflict(
    transaction: TransactionSql,
    input: { accountId: string; bookId: string; noteId: string; expectedVersion: number; fileVersion: number },
  ): Promise<"stale" | null> {
    const [row] = await transaction<Array<{ fileVersion: number | null; version: number }>>`
      SELECT file_version AS "fileVersion", version
      FROM notes
      WHERE id = ${input.noteId} AND account_id = ${input.accountId} AND book_id = ${input.bookId}
    `;
    if (!row) return null;
    if ((row.fileVersion !== null && row.fileVersion !== input.fileVersion) || row.version !== input.expectedVersion) {
      return "stale";
    }
    throw new Error("NOTE_UPDATE_FAILED");
  }
}

/** Test-only schema bootstrap. Production startup must run the shared migration first. */
export async function bootstrapTextAnnotationSchemaForTest(options: { databaseUrl: string }) {
  const sql = postgres(options.databaseUrl, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS highlights (
        id text PRIMARY KEY,
        account_id text NOT NULL,
        book_id text NOT NULL,
        idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
        file_version integer NOT NULL CHECK (file_version > 0),
        section_id text NOT NULL CHECK (char_length(btrim(section_id)) > 0),
        start_offset integer NOT NULL CHECK (start_offset >= 0),
        end_offset integer NOT NULL CHECK (end_offset > start_offset),
        quote text NOT NULL CHECK (char_length(btrim(quote)) > 0 AND char_length(quote) <= 20000),
        thought text CHECK (thought IS NULL OR char_length(thought) <= 20000),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, book_id, idempotency_key),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (account_id, book_id, file_version, section_id)
          REFERENCES book_sections(account_id, book_id, file_version, section_id) ON DELETE RESTRICT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS highlights_book_version_idx
      ON highlights (account_id, book_id, file_version, created_at DESC, id DESC)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS notes (
        id text PRIMARY KEY,
        account_id text NOT NULL,
        book_id text NOT NULL,
        idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
        body text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 100000),
        file_version integer,
        section_id text,
        start_offset integer,
        end_offset integer,
        quote text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, book_id, idempotency_key),
        CHECK (
          (file_version IS NULL AND section_id IS NULL AND start_offset IS NULL AND end_offset IS NULL AND quote IS NULL)
          OR (
            file_version IS NOT NULL AND file_version > 0
            AND section_id IS NOT NULL AND char_length(btrim(section_id)) > 0
            AND start_offset IS NOT NULL AND start_offset >= 0
            AND end_offset IS NOT NULL AND end_offset > start_offset
            AND quote IS NOT NULL AND char_length(btrim(quote)) > 0 AND char_length(quote) <= 20000
          )
        ),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (account_id, book_id, file_version, section_id)
          REFERENCES book_sections(account_id, book_id, file_version, section_id) ON DELETE RESTRICT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS notes_book_idx
      ON notes (account_id, book_id, created_at DESC, id DESC)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS note_update_idempotency (
        idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
        account_id text NOT NULL,
        book_id text NOT NULL,
        note_id text NOT NULL,
        expected_version integer NOT NULL CHECK (expected_version > 0),
        body text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 100000),
        source_payload jsonb,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, idempotency_key),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id) ON DELETE RESTRICT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS note_update_idempotency_account_note_idx
      ON note_update_idempotency (account_id, book_id, note_id, created_at DESC)
    `;
  } finally {
    await sql.end();
  }
}

export class TextAnnotationRuntime extends TextAnnotationService {
  private readonly postgresRepository: PostgresTextAnnotationRepository;

  constructor(
    repository: PostgresTextAnnotationRepository,
    private readonly sql: Sql,
  ) {
    super(repository);
    this.postgresRepository = repository;
  }

  async ready() {
    try {
      await this.postgresRepository.assertSchemaReady();
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.sql.end();
  }
}

export async function createTextAnnotationRuntime(options: { databaseUrl: string }) {
  const sql = postgres(options.databaseUrl, { max: 4 });
  const repository = new PostgresTextAnnotationRepository(sql);
  try {
    await repository.assertSchemaReady();
    return new TextAnnotationRuntime(repository, sql);
  } catch (error) {
    await sql.end();
    throw error;
  }
}

const idempotencyKeySchema = z.string().trim().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH);
const locatorSchema = z.object({
  kind: z.literal("text"),
  fileVersion: z.number().int().positive(),
  sectionId: z.string().min(1).max(MAX_SECTION_ID_LENGTH),
  offset: z.number().int().nonnegative(),
});
const sourceSchema = z.object({
  locator: locatorSchema,
  endOffset: z.number().int().positive(),
  quote: z.string().min(1).max(MAX_QUOTE_LENGTH),
});
const highlightCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  locator: locatorSchema,
  endOffset: z.number().int().positive(),
  quote: z.string().max(MAX_QUOTE_LENGTH).optional(),
  thought: z.string().max(MAX_THOUGHT_LENGTH).nullable().optional(),
});
const highlightUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  thought: z.string().max(MAX_THOUGHT_LENGTH).nullable(),
});
const noteCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  body: z.string().max(MAX_NOTE_BODY_LENGTH),
  source: sourceSchema.nullable().optional(),
});
const noteUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  body: z.string().max(MAX_NOTE_BODY_LENGTH),
  idempotencyKey: idempotencyKeySchema.optional(),
  source: sourceSchema.nullable().optional(),
});
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() });

function sendAnnotationError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED" });
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "STALE_VERSION" || code === "IDEMPOTENCY_KEY_REUSED") return reply.code(409).send({ code });
  if (code === "ACCOUNT_REQUIRED") return reply.code(401).send({ code });
  if (code === "ACCOUNT_FORBIDDEN") return reply.code(403).send({ code });
  if (code.endsWith("_NOT_FOUND") || code === "BOOK_NOT_FOUND") return reply.code(404).send({ code });
  if (code === "TEXT_CONTENT_UNAVAILABLE") return reply.code(409).send({ code });
  if (
    code === "INVALID_VERSION"
    || code === "INVALID_FILE_VERSION"
    || code === "INVALID_LOCATOR"
    || code === "INVALID_HIGHLIGHT_RANGE"
    || code === "INVALID_HIGHLIGHT_QUOTE"
    || code === "NOTE_BODY_REQUIRED"
    || code === "TEXT_TOO_LONG"
    || code === "IDEMPOTENCY_KEY_REQUIRED"
    || code === "IDEMPOTENCY_KEY_TOO_LONG"
  ) return reply.code(400).send({ code });
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}

export function registerTextAnnotationRoutes(
  app: FastifyInstance,
  runtime: Pick<
    TextAnnotationService,
    "list" | "createHighlight" | "updateHighlight" | "deleteHighlight" | "createNote" | "updateNote" | "deleteNote"
  >,
  resolveAccountId = resolveAccountOwner,
) {
  const bookParameters = z.object({ bookId: z.string().min(1).max(256) });
  const highlightParameters = bookParameters.extend({ highlightId: z.string().min(1).max(256) });
  const noteParameters = bookParameters.extend({ noteId: z.string().min(1).max(256) });
  app.get("/api/v1/books/:bookId/annotations", async (request, reply) => {
    try {
      const { bookId } = bookParameters.parse(request.params);
      return await runtime.list(resolveAccountId(request.headers), bookId);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
  app.post("/api/v1/books/:bookId/highlights", async (request, reply) => {
    try {
      const { bookId } = bookParameters.parse(request.params);
      const result = await runtime.createHighlight(
        resolveAccountId(request.headers),
        bookId,
        highlightCreateSchema.parse(request.body),
      );
      return reply.code(result.status === "saved" ? 201 : 503).send(result);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
  app.patch("/api/v1/books/:bookId/highlights/:highlightId", async (request, reply) => {
    try {
      const { bookId, highlightId } = highlightParameters.parse(request.params);
      const result = await runtime.updateHighlight(
        resolveAccountId(request.headers),
        bookId,
        highlightId,
        highlightUpdateSchema.parse(request.body),
      );
      return reply.code(result.status === "saved" ? 200 : 503).send(result);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
  app.delete("/api/v1/books/:bookId/highlights/:highlightId", async (request, reply) => {
    try {
      const { bookId, highlightId } = highlightParameters.parse(request.params);
      const result = await runtime.deleteHighlight(
        resolveAccountId(request.headers),
        bookId,
        highlightId,
        deleteSchema.parse(request.body).expectedVersion,
      );
      return reply.code(result.status === "deleted" ? 200 : 503).send(result);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
  app.post("/api/v1/books/:bookId/notes", async (request, reply) => {
    try {
      const { bookId } = bookParameters.parse(request.params);
      const result = await runtime.createNote(
        resolveAccountId(request.headers),
        bookId,
        noteCreateSchema.parse(request.body),
      );
      return reply.code(result.status === "saved" ? 201 : 503).send(result);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
  app.route({
    method: ["PATCH", "PUT"],
    url: "/api/v1/books/:bookId/notes/:noteId",
    handler: async (request, reply) => {
      try {
        const { bookId, noteId } = noteParameters.parse(request.params);
        const result = await runtime.updateNote(
          resolveAccountId(request.headers),
          bookId,
          noteId,
          noteUpdateSchema.parse(request.body),
        );
        return reply.code(result.status === "saved" ? 200 : 503).send(result);
      } catch (error) {
        return sendAnnotationError(error, reply);
      }
    },
  });
  app.delete("/api/v1/books/:bookId/notes/:noteId", async (request, reply) => {
    try {
      const { bookId, noteId } = noteParameters.parse(request.params);
      const result = await runtime.deleteNote(
        resolveAccountId(request.headers),
        bookId,
        noteId,
        deleteSchema.parse(request.body).expectedVersion,
      );
      return reply.code(result.status === "deleted" ? 200 : 503).send(result);
    } catch (error) {
      return sendAnnotationError(error, reply);
    }
  });
}
