import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LibraryBookSummary } from "@selfalone/contracts";
import { inspectImportedBook } from "@selfalone/domain";
import postgres, { type Sql } from "postgres";
import type { PreparedTextBookPublication, TextReaderRuntime } from "./text-reader";

export type LibraryBook = LibraryBookSummary;

type BookRow = Omit<LibraryBook, "sourceLabel" | "createdAt" | "progressPercent"> & { createdAt: Date };

type ProgressSectionRow = {
  bookId: string;
  fileVersion: number;
  sectionId: string;
  length: number;
};

type ProgressFileRow = {
  bookId: string;
  fileVersion: number;
};

type StoredPositionRow = {
  locator: unknown;
};

type ProcessingFile = {
  bookId: string;
  accountId: string;
  originalFilename: string;
  objectKey: string;
};

type TextPublisher = Pick<
  TextReaderRuntime,
  "prepareTextBook" | "publishPreparedTextBook"
>;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fallbackTitle(filename: string) {
  return filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "").trim() || "未命名书籍";
}

function bookSummary(row: BookRow, progressPercent: number | null = null): LibraryBook {
  return {
    ...row,
    sourceLabel: "本地",
    progressPercent,
    createdAt: row.createdAt.toISOString(),
  };
}

function storedTextLocator(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const locator = value as Record<string, unknown>;
  const fileVersion = locator.fileVersion;
  const offset = locator.offset;
  if (
    locator.kind !== "text"
    || typeof fileVersion !== "number"
    || !Number.isSafeInteger(fileVersion)
    || fileVersion <= 0
    || typeof locator.sectionId !== "string"
    || locator.sectionId.length === 0
    || typeof offset !== "number"
    || !Number.isSafeInteger(offset)
    || offset < 0
  ) return null;
  return {
    fileVersion,
    sectionId: locator.sectionId,
    offset,
  };
}

export class LibraryRuntime {
  private readonly parseJobs = new Set<Promise<void>>();

  constructor(
    private readonly sql: Sql,
    private readonly objectDirectory: string,
    private readonly parseDelayMs: number,
    private readonly textPublisher?: TextPublisher,
  ) {}

  async initialize() {
    await mkdir(this.objectDirectory, { recursive: true });
    await this.sql`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS books (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id),
        title text NOT NULL,
        source_label text NOT NULL DEFAULT '本地'
      )
    `;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS author text`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS local_format text`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS parse_status text`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS parse_error_code text`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS section_count integer NOT NULL DEFAULT 0`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS page_count integer`;
    await this.sql`ALTER TABLE books ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
    await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS books_account_id_id_key ON books (account_id, id)`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS book_files (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id),
        book_id text NOT NULL,
        object_key text NOT NULL,
        original_filename text NOT NULL,
        byte_size integer NOT NULL,
        sha256 text NOT NULL,
        parse_result jsonb,
        version integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, book_id, version),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id)
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS book_sections (
        account_id text NOT NULL,
        book_id text NOT NULL,
        file_version integer NOT NULL,
        section_id text NOT NULL,
        section_order integer NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        PRIMARY KEY (account_id, book_id, file_version, section_id),
        UNIQUE (account_id, book_id, file_version, section_order),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id),
        FOREIGN KEY (account_id, book_id, file_version)
          REFERENCES book_files(account_id, book_id, version)
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS reading_positions (
        account_id text NOT NULL,
        book_id text NOT NULL,
        locator jsonb NOT NULL,
        background text NOT NULL CHECK (background IN ('light', 'dark')),
        version integer NOT NULL CHECK (version > 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, book_id),
        FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id)
      )
    `;

    const pending = await this.sql<Array<ProcessingFile>>`
      SELECT file.book_id AS "bookId", file.account_id AS "accountId",
             file.original_filename AS "originalFilename", file.object_key AS "objectKey"
      FROM book_files AS file
      JOIN books AS book ON book.id = file.book_id AND book.account_id = file.account_id
      WHERE book.parse_status = 'processing'
    `;
    pending.forEach((file) => this.scheduleParse(file));
  }

  async ready() {
    try {
      const [result] = await this.sql<Array<{ ready: number }>>`SELECT 1 AS ready`;
      return result?.ready === 1;
    } catch {
      return false;
    }
  }

  async listBooks(accountId: string, query = ""): Promise<LibraryBook[]> {
    await this.assertAccount(accountId);
    const search = `%${query.trim()}%`;
    const rows = await this.sql<Array<BookRow>>`
      SELECT book.id, book.title, book.author, book.local_format AS format,
             book.parse_status AS "parseStatus", book.parse_error_code AS "errorCode",
             book.section_count AS "sectionCount", book.page_count AS "pageCount",
             book.created_at AS "createdAt"
      FROM books AS book
      WHERE book.account_id = ${accountId}
        AND EXISTS (
          SELECT 1 FROM book_files AS file
          WHERE file.account_id = book.account_id AND file.book_id = book.id
        )
        AND (${query.trim()} = '' OR book.title ILIKE ${search} OR coalesce(book.author, '') ILIKE ${search})
      ORDER BY book.created_at DESC, book.id DESC
    `;
    const progress = await this.readingProgress(accountId, rows);
    return rows.map((row) => bookSummary(row, progress.get(row.id) ?? null));
  }

  async getBook(accountId: string, bookId: string): Promise<LibraryBook> {
    const [row] = await this.sql<Array<BookRow>>`
      SELECT id, title, author, local_format AS format, parse_status AS "parseStatus",
             parse_error_code AS "errorCode", section_count AS "sectionCount",
             page_count AS "pageCount", created_at AS "createdAt"
      FROM books WHERE id = ${bookId} AND account_id = ${accountId}
        AND EXISTS (
          SELECT 1 FROM book_files AS file
          WHERE file.account_id = ${accountId} AND file.book_id = ${bookId}
        )
    `;
    if (!row) throw new Error("BOOK_NOT_FOUND");
    const progress = await this.readingProgress(accountId, [row]);
    return bookSummary(row, progress.get(row.id) ?? null);
  }

  private async readingProgress(
    accountId: string,
    books: Array<Pick<BookRow, "id" | "parseStatus">>,
  ): Promise<Map<string, number | null>> {
    const progress = new Map<string, number | null>(
      books.map((book) => [book.id, book.parseStatus === "ready_text" ? 0 : null]),
    );
    const readyBookIds = books
      .filter((book) => book.parseStatus === "ready_text")
      .map((book) => book.id);
    if (readyBookIds.length === 0) return progress;

    const files = await this.sql<Array<ProgressFileRow>>`
      SELECT book_id AS "bookId", max(version)::integer AS "fileVersion"
      FROM book_files
      WHERE account_id = ${accountId} AND book_id = ANY(${this.sql.array(readyBookIds)})
      GROUP BY book_id
    `;
    // TextLocator offsets are JavaScript UTF-16 code units. PostgreSQL char_length counts
    // code points, so add one unit for every non-BMP code point without returning body text.
    const sections = await this.sql<Array<ProgressSectionRow>>`
      WITH current_files AS (
        SELECT book_id, max(version)::integer AS file_version
        FROM book_files
        WHERE account_id = ${accountId} AND book_id = ANY(${this.sql.array(readyBookIds)})
        GROUP BY book_id
      )
      SELECT section.book_id AS "bookId", section.file_version AS "fileVersion",
             section.section_id AS "sectionId",
             (
               char_length(section.body)
               + regexp_count(section.body, U&'[\\+010000-\\+10FFFF]')
             )::integer AS length
      FROM book_sections AS section
      JOIN current_files AS file
        ON file.book_id = section.book_id AND file.file_version = section.file_version
      WHERE section.account_id = ${accountId}
      ORDER BY section.book_id ASC, section.section_order ASC
    `;
    const positions = await this.sql<Array<StoredPositionRow & { bookId: string }>>`
      SELECT book_id AS "bookId", locator
      FROM reading_positions
      WHERE account_id = ${accountId} AND book_id = ANY(${this.sql.array(readyBookIds)})
    `;

    const fileByBook = new Map(files.map((file) => [file.bookId, file]));
    const sectionsByBook = new Map<string, ProgressSectionRow[]>();
    for (const section of sections) {
      const bookSections = sectionsByBook.get(section.bookId) ?? [];
      bookSections.push(section);
      sectionsByBook.set(section.bookId, bookSections);
    }
    const positionByBook = new Map(positions.map((position) => [position.bookId, position]));

    for (const bookId of readyBookIds) {
      const file = fileByBook.get(bookId);
      const bookSections = file
        ? (sectionsByBook.get(bookId) ?? []).filter((section) => section.fileVersion === file.fileVersion)
        : [];
      const locator = storedTextLocator(positionByBook.get(bookId)?.locator);
      if (!file || !Number.isSafeInteger(file.fileVersion) || file.fileVersion <= 0) {
        progress.set(bookId, 0);
        continue;
      }
      if (!locator || locator.fileVersion !== file.fileVersion) {
        progress.set(bookId, 0);
        continue;
      }

      let precedingLength = 0;
      let currentSection: ProgressSectionRow | undefined;
      let invalidSection = false;
      for (const section of bookSections) {
        if (!Number.isSafeInteger(section.length) || section.length < 0) {
          invalidSection = true;
          break;
        }
        if (section.sectionId === locator.sectionId) {
          currentSection = section;
          break;
        }
        precedingLength += section.length;
      }
      if (invalidSection || !currentSection || locator.offset > currentSection.length) {
        progress.set(bookId, 0);
        continue;
      }

      const totalLength = bookSections.reduce((total, section) => total + section.length, 0);
      if (!Number.isSafeInteger(totalLength) || totalLength <= 0) {
        progress.set(bookId, 0);
        continue;
      }

      // The contract exposes whole percentages; Math.round gives nearest integer, ties up.
      const rounded = Math.round(((precedingLength + locator.offset) * 100) / totalLength);
      progress.set(bookId, Math.max(0, Math.min(100, rounded)));
    }
    return progress;
  }

  async importBook(accountId: string, originalFilename: string, bytes: Buffer) {
    await this.assertAccount(accountId);
    const extension = originalFilename.split(".").at(-1)?.toLowerCase();
    if (extension !== "epub" && extension !== "txt" && extension !== "pdf") {
      throw new Error("UNSUPPORTED_BOOK_FORMAT");
    }
    if (bytes.length === 0) throw new Error("EMPTY_BOOK_FILE");
    if (bytes.length > 50 * 1024 * 1024) throw new Error("BOOK_FILE_TOO_LARGE");

    const bookId = randomUUID();
    const fileId = randomUUID();
    const objectKey = `${accountId}/${bookId}/original/1/original.${extension}`;
    const objectPath = join(this.objectDirectory, ...objectKey.split("/"));
    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, bytes, { flag: "wx" });
    try {
      const [row] = await this.sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO books (
            id, account_id, title, author, source_label, local_format, parse_status,
            parse_error_code, section_count, page_count
          ) VALUES (
            ${bookId}, ${accountId}, ${fallbackTitle(originalFilename)}, NULL, '本地',
            ${extension}, 'processing', NULL, 0, NULL
          )
        `;
        await transaction`
          INSERT INTO book_files (
            id, account_id, book_id, object_key, original_filename, byte_size,
            sha256, version
          ) VALUES (
            ${fileId}, ${accountId}, ${bookId}, ${objectKey}, ${originalFilename},
            ${bytes.length}, ${createHash("sha256").update(bytes).digest("hex")}, 1
          )
        `;
        return transaction<Array<BookRow>>`
          SELECT id, title, author, local_format AS format, parse_status AS "parseStatus",
                 parse_error_code AS "errorCode", section_count AS "sectionCount",
                 page_count AS "pageCount", created_at AS "createdAt"
          FROM books WHERE id = ${bookId} AND account_id = ${accountId}
        `;
      });
      if (!row) throw new Error("BOOK_IMPORT_FAILED");
      this.scheduleParse({ bookId, accountId, originalFilename, objectKey });
      return bookSummary(row);
    } catch (error) {
      await rm(objectPath, { force: true });
      throw error;
    }
  }

  private async assertAccount(accountId: string) {
    const [account] = await this.sql<Array<{ id: string }>>`
      SELECT id FROM accounts WHERE id = ${accountId}
    `;
    if (!account) throw new Error("ACCOUNT_FORBIDDEN");
  }

  private scheduleParse(file: ProcessingFile) {
    const job = this.parseFile(file).finally(() => this.parseJobs.delete(job));
    this.parseJobs.add(job);
  }

  private async parseFile(file: ProcessingFile) {
    if (this.parseDelayMs > 0) await delay(this.parseDelayMs);
    const bytes = await readFile(join(this.objectDirectory, ...file.objectKey.split("/")));
    const result = inspectImportedBook({ filename: file.originalFilename, bytes });
    let publicationError = "";
    let prepared: PreparedTextBookPublication | undefined;
    if (result.parseStatus === "ready_text" && !this.textPublisher) {
      publicationError = "TEXT_PUBLISHER_UNAVAILABLE";
    }
    if (result.parseStatus === "ready_text" && this.textPublisher) {
      try {
        prepared = await this.textPublisher.prepareTextBook(file.accountId, file.bookId);
      } catch (error) {
        publicationError = error instanceof Error ? error.message : "TEXT_PARSE_FAILED";
      }
    }
    if (prepared && this.textPublisher) {
      const publisher = this.textPublisher;
      try {
        await this.sql.begin(async (transaction) => {
          await publisher.publishPreparedTextBook(prepared, transaction);
          const ready = await transaction<Array<{ id: string }>>`
            UPDATE books
            SET parse_status = 'ready_text', parse_error_code = NULL
            WHERE id = ${file.bookId} AND account_id = ${file.accountId}
              AND parse_status = 'processing'
            RETURNING id
          `;
          if (!ready[0]) throw new Error("TEXT_PUBLICATION_STALE");
          await transaction`
            UPDATE book_files
            SET parse_result = ${transaction.json(result)}
            WHERE book_id = ${file.bookId} AND account_id = ${file.accountId}
              AND version = ${prepared.extracted.fileVersion}
          `;
        });
        return;
      } catch (error) {
        publicationError = error instanceof Error ? error.message : "TEXT_PARSE_FAILED";
      }
    }
    await this.sql.begin(async (transaction) => {
      await transaction`
        UPDATE books
        SET title = ${result.title}, author = ${result.author},
            parse_status = ${publicationError ? "failed" : result.parseStatus},
            parse_error_code = ${publicationError || result.errorCode},
            section_count = ${result.sectionCount}, page_count = ${result.pageCount}
        WHERE id = ${file.bookId} AND account_id = ${file.accountId}
          AND parse_status = 'processing'
      `;
      await transaction`
        UPDATE book_files
        SET parse_result = ${transaction.json(result)}
        WHERE book_id = ${file.bookId} AND account_id = ${file.accountId} AND version = 1
      `;
    });
  }

  async close() {
    await Promise.all(this.parseJobs);
    await this.sql.end();
  }
}

export async function createLibraryRuntime(options: {
  databaseUrl: string;
  objectDirectory: string;
  parseDelayMs?: number;
  textPublisher?: TextPublisher;
}) {
  const sql = postgres(options.databaseUrl, { max: 4 });
  const runtime = new LibraryRuntime(
    sql,
    options.objectDirectory,
    options.parseDelayMs ?? 20,
    options.textPublisher,
  );
  await runtime.initialize();
  return runtime;
}
