import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import postgres, { type Sql } from "postgres";
import { z } from "zod";
import { developmentAccountId } from "./account-migration";

export type TextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

export type ReaderBackground = "light" | "dark";

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

type SectionRow = {
  sectionId: string;
  title: string;
  order: number;
  text: string;
};

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

  private async currentFile(accountId: string, bookId: string): Promise<FileRow> {
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
    if ((file.format !== "epub" && file.format !== "txt") || file.parseStatus !== "ready_text") {
      throw new Error("TEXT_CONTENT_UNAVAILABLE");
    }
    return file;
  }

  async publishTextBook(accountId: string, bookId: string) {
    const file = await this.currentFile(accountId, bookId);
    const root = resolve(this.objectDirectory);
    const objectPath = resolve(root, ...file.objectKey.split("/"));
    if (objectPath !== root && !objectPath.startsWith(`${root}${sep}`)) throw new Error("OBJECT_KEY_INVALID");
    const extracted = this.extractTextBook({
      filename: file.originalFilename,
      bytes: await readFile(objectPath),
      fileVersion: file.fileVersion,
    });

    await this.sql.begin(async (transaction) => {
      const [current] = await transaction<Array<{ fileVersion: number }>>`
        SELECT version AS "fileVersion"
        FROM book_files
        WHERE account_id = ${accountId} AND book_id = ${bookId}
        ORDER BY version DESC
        LIMIT 1
        FOR UPDATE
      `;
      if (current?.fileVersion !== extracted.fileVersion) throw new Error("STALE_VERSION");
      await transaction`
        DELETE FROM book_sections
        WHERE account_id = ${accountId} AND book_id = ${bookId}
          AND file_version = ${extracted.fileVersion}
      `;
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
    });
    return { fileVersion: extracted.fileVersion, sectionCount: extracted.sections.length };
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
    input: { expectedVersion: number; locator: TextLocator; background: ReaderBackground },
  ) {
    const parsed = positionSchema.parse(input);
    return this.sql.begin(async (transaction) => {
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
        SELECT char_length(body)::integer AS length
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
      if ((existing?.version ?? 0) !== parsed.expectedVersion) throw new Error("STALE_VERSION");
      const version = parsed.expectedVersion + 1;
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
  if (code.endsWith("_NOT_FOUND")) return reply.code(404).send({ code });
  if (code === "TEXT_CONTENT_UNAVAILABLE") return reply.code(409).send({ code });
  return reply.code(500).send({ code: "INTERNAL_ERROR" });
}

export function registerTextReaderRoutes(
  app: FastifyInstance,
  runtime: TextReaderRuntime,
  resolveAccountId = (headers: Record<string, unknown>) => {
    const value = headers["x-selfalone-account"];
    return typeof value === "string" && value.trim() ? value.trim() : developmentAccountId;
  },
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
