import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { z } from "zod";
import type {
  ReaderBackground,
  SaveTextPositionRequest,
  TextLocator,
  TextReaderSection,
} from "@selfalone/contracts";
import { resolveAccountOwner } from "./account-owner";

export type { ReaderBackground, TextLocator } from "@selfalone/contracts";

type ExtractedTextBook = {
  format: "epub" | "txt";
  fileVersion: number;
  title: string;
  author: string | null;
  sections: Array<{
    sectionId: string;
    title: string;
    order: number;
    text: string;
  }>;
};

export type PreparedTextBookPublication = {
  accountId: string;
  bookId: string;
  extracted: ExtractedTextBook;
};

type ExtractTextBook = (input: {
  filename: string;
  bytes: Buffer;
  fileVersion: number;
}) => ExtractedTextBook;

type FileRow = {
  accountId: string;
  bookId: string;
  objectKey: string;
  originalFilename: string;
  fileVersion: number;
  format: string;
  parseStatus: string;
  title: string;
  author: string | null;
};

type SectionRow = TextReaderSection;

type PositionRow = {
  locator: TextLocator;
  background: ReaderBackground;
  version: number;
};

const locatorSchema = z.object({
  kind: z.literal("text"),
  fileVersion: z.number().int().positive(),
  sectionId: z.string().min(1).max(512),
  offset: z.number().int().nonnegative(),
});

const positionSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  locator: locatorSchema,
  background: z.enum(["light", "dark"]),
});

export class TextReaderRuntime {
  constructor(
    private readonly sql: Sql,
    private readonly objectDirectory: string,
    private readonly extractTextBook: ExtractTextBook,
  ) {}

  async ready() {
    try {
      const [result] = await this.sql<Array<{ ready: number }>>`SELECT 1 AS ready`;
      return result?.ready === 1;
    } catch {
      return false;
    }
  }

  private async currentFile(
    accountId: string,
    bookId: string,
    allowProcessing = false,
  ): Promise<FileRow> {
    const [file] = await this.sql<Array<FileRow>>`
      SELECT file.account_id AS "accountId", file.book_id AS "bookId",
             file.object_key AS "objectKey", file.original_filename AS "originalFilename",
             file.version AS "fileVersion", book.local_format AS format,
             book.parse_status AS "parseStatus", book.title, book.author
      FROM book_files AS file
      JOIN books AS book ON book.account_id = file.account_id AND book.id = file.book_id
      WHERE file.account_id = ${accountId} AND file.book_id = ${bookId}
      ORDER BY file.version DESC
      LIMIT 1
    `;
    if (!file) throw new Error("BOOK_NOT_FOUND");
    const readableStatus = file.parseStatus === "ready_text"
      || (allowProcessing && file.parseStatus === "processing");
    if ((file.format !== "epub" && file.format !== "txt") || !readableStatus) {
      throw new Error("TEXT_CONTENT_UNAVAILABLE");
    }
    return file;
  }

  async prepareTextBook(accountId: string, bookId: string): Promise<PreparedTextBookPublication> {
    const file = await this.currentFile(accountId, bookId, true);
    const root = resolve(this.objectDirectory);
    const objectPath = resolve(root, ...file.objectKey.split("/"));
    if (objectPath !== root && !objectPath.startsWith(`${root}${sep}`)) throw new Error("OBJECT_KEY_INVALID");
    const extracted = this.extractTextBook({
      filename: file.originalFilename,
      bytes: await readFile(objectPath),
      fileVersion: file.fileVersion,
    });
    return { accountId, bookId, extracted };
  }

  async publishPreparedTextBook(
    prepared: PreparedTextBookPublication,
    transaction: TransactionSql,
  ) {
    const { accountId, bookId, extracted } = prepared;
    const [book] = await transaction<Array<{
      id: string;
      sectionCount: number;
      title: string;
      author: string | null;
    }>>`
      SELECT id, title, author, section_count AS "sectionCount"
      FROM books
      WHERE account_id = ${accountId} AND id = ${bookId}
      FOR UPDATE
    `;
    if (!book) throw new Error("BOOK_NOT_FOUND");
    const [current] = await transaction<Array<{ fileVersion: number }>>`
      SELECT version AS "fileVersion"
      FROM book_files
      WHERE account_id = ${accountId} AND book_id = ${bookId}
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE
    `;
    if (current?.fileVersion !== extracted.fileVersion) throw new Error("STALE_VERSION");

    const existing = await transaction<Array<{
      sectionId: string;
      order: number;
      title: string;
      text: string;
    }>>`
      SELECT section_id AS "sectionId", section_order AS "order", title, body AS text
      FROM book_sections
      WHERE account_id = ${accountId} AND book_id = ${bookId}
        AND file_version = ${extracted.fileVersion}
      ORDER BY section_order ASC
    `;
    if (existing.length > 0 || extracted.sections.length === 0) {
      if (
        book.sectionCount !== existing.length
        || book.title !== extracted.title
        || book.author !== extracted.author
      ) throw new Error("TEXT_PUBLICATION_CONFLICT");
      const matches = existing.length === extracted.sections.length
        && existing.every((stored, index) => {
          const incoming = extracted.sections[index];
          return incoming !== undefined
            && stored.sectionId === incoming.sectionId
            && stored.order === incoming.order
            && stored.title === incoming.title
            && stored.text === incoming.text;
        });
      if (!matches) throw new Error("TEXT_PUBLICATION_CONFLICT");
      return { fileVersion: extracted.fileVersion, sectionCount: existing.length };
    }
    if (book.sectionCount !== 0) throw new Error("TEXT_PUBLICATION_CONFLICT");

    for (const section of extracted.sections) {
      await transaction`
        INSERT INTO book_sections (
          account_id, book_id, file_version, section_id, section_order, title, body
        ) VALUES (
          ${accountId}, ${bookId}, ${extracted.fileVersion}, ${section.sectionId},
          ${section.order}, ${section.title}, ${section.text}
        )
      `;
    }
    await transaction`
      UPDATE books
      SET title = ${extracted.title}, author = ${extracted.author},
          section_count = ${extracted.sections.length}
      WHERE account_id = ${accountId} AND id = ${bookId}
    `;
    return { fileVersion: extracted.fileVersion, sectionCount: extracted.sections.length };
  }

  async publishTextBook(accountId: string, bookId: string) {
    const prepared = await this.prepareTextBook(accountId, bookId);
    return this.sql.begin((transaction) => this.publishPreparedTextBook(prepared, transaction));
  }

  async getReading(accountId: string, bookId: string) {
    const file = await this.currentFile(accountId, bookId);
    const [position] = await this.sql<Array<PositionRow>>`
      SELECT locator, background, version
      FROM reading_positions
      WHERE account_id = ${accountId} AND book_id = ${bookId}
    `;
    const currentPosition = position?.locator.fileVersion === file.fileVersion ? position : null;
    return {
      bookId,
      title: file.title,
      author: file.author,
      contentMode: "text" as const,
      fileVersion: file.fileVersion,
      position: currentPosition,
    };
  }

  async listSections(accountId: string, bookId: string) {
    const file = await this.currentFile(accountId, bookId);
    const sections = await this.sql<Array<SectionRow>>`
      SELECT section_id AS "sectionId", title, section_order AS "order", body AS text
      FROM book_sections
      WHERE account_id = ${accountId} AND book_id = ${bookId}
        AND file_version = ${file.fileVersion}
      ORDER BY section_order ASC
    `;
    return { fileVersion: file.fileVersion, sections };
  }

  async savePosition(
    accountId: string,
    bookId: string,
    input: SaveTextPositionRequest,
  ) {
    const parsed = positionSchema.parse(input);
    return this.sql.begin(async (transaction) => {
      const [book] = await transaction<Array<{ id: string }>>`
        SELECT id
        FROM books
        WHERE account_id = ${accountId} AND id = ${bookId}
        FOR UPDATE
      `;
      if (!book) throw new Error("BOOK_NOT_FOUND");
      const [file] = await transaction<Array<{ fileVersion: number }>>`
        SELECT version AS "fileVersion"
        FROM book_files
        WHERE account_id = ${accountId} AND book_id = ${bookId}
        ORDER BY version DESC
        LIMIT 1
        FOR SHARE
      `;
      if (!file) throw new Error("BOOK_NOT_FOUND");
      if (file.fileVersion !== parsed.locator.fileVersion) throw new Error("STALE_VERSION");
      const [section] = await transaction<Array<{ length: number }>>`
        SELECT char_length(body)
          + regexp_count(body, '[' || chr(65536) || '-' || chr(1114111) || ']') AS length
        FROM book_sections
        WHERE account_id = ${accountId} AND book_id = ${bookId}
          AND file_version = ${parsed.locator.fileVersion}
          AND section_id = ${parsed.locator.sectionId}
      `;
      if (!section || parsed.locator.offset > section.length) throw new Error("INVALID_LOCATOR");
      const [existing] = await transaction<Array<PositionRow>>`
        SELECT locator, background, version
        FROM reading_positions
        WHERE account_id = ${accountId} AND book_id = ${bookId}
        FOR UPDATE
      `;
      const baseVersion =
        existing?.locator.fileVersion === parsed.locator.fileVersion ? existing.version : 0;
      if (baseVersion !== parsed.expectedVersion) throw new Error("STALE_VERSION");
      const version = (existing?.version ?? 0) + 1;
      const [saved] = await transaction<Array<PositionRow>>`
        INSERT INTO reading_positions (account_id, book_id, locator, background, version)
        VALUES (
          ${accountId}, ${bookId}, ${transaction.json(parsed.locator)}, ${parsed.background}, ${version}
        )
        ON CONFLICT (account_id, book_id) DO UPDATE
        SET locator = EXCLUDED.locator, background = EXCLUDED.background,
            version = EXCLUDED.version, updated_at = now()
        RETURNING locator, background, version
      `;
      if (!saved) throw new Error("POSITION_SAVE_FAILED");
      return saved;
    });
  }

  async close() {
    await this.sql.end();
  }
}

export async function createTextReaderRuntime(options: {
  databaseUrl: string;
  objectDirectory: string;
  extractTextBook: ExtractTextBook;
}) {
  return new TextReaderRuntime(postgres(options.databaseUrl, { max: 4 }), options.objectDirectory, options.extractTextBook);
}

function sendReaderError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError || (error instanceof Error && error.message === "INVALID_LOCATOR")) {
    return reply.code(400).send({ code: "VALIDATION_FAILED" });
  }
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "STALE_VERSION") return reply.code(409).send({ code });
  if (code === "ACCOUNT_REQUIRED") return reply.code(401).send({ code });
  if (code === "ACCOUNT_FORBIDDEN") return reply.code(403).send({ code });
  if (code.endsWith("_NOT_FOUND")) return reply.code(404).send({ code });
  if (code === "TEXT_CONTENT_UNAVAILABLE") return reply.code(409).send({ code });
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}

export function registerTextReaderRoutes(
  app: FastifyInstance,
  runtime: TextReaderRuntime,
  resolveAccountId = resolveAccountOwner,
) {
  const parametersSchema = z.object({ bookId: z.string().min(1).max(256) });
  app.get("/api/v1/books/:bookId/reading", async (request, reply) => {
    try {
      const { bookId } = parametersSchema.parse(request.params);
      return await runtime.getReading(resolveAccountId(request.headers), bookId);
    } catch (error) {
      return sendReaderError(error, reply);
    }
  });
  app.get("/api/v1/books/:bookId/content/sections", async (request, reply) => {
    try {
      const { bookId } = parametersSchema.parse(request.params);
      return await runtime.listSections(resolveAccountId(request.headers), bookId);
    } catch (error) {
      return sendReaderError(error, reply);
    }
  });
  app.put("/api/v1/books/:bookId/position", async (request, reply) => {
    try {
      const { bookId } = parametersSchema.parse(request.params);
      return await runtime.savePosition(
        resolveAccountId(request.headers),
        bookId,
        positionSchema.parse(request.body),
      );
    } catch (error) {
      return sendReaderError(error, reply);
    }
  });
}
