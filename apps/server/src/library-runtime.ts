import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LibraryBookSummary } from "@selfalone/contracts";
import { inspectImportedBook } from "@selfalone/domain";
import postgres, { type Sql } from "postgres";

export type LibraryBook = LibraryBookSummary;

type BookRow = Omit<LibraryBook, "sourceLabel" | "createdAt"> & { createdAt: Date };

type ProcessingFile = {
  bookId: string;
  accountId: string;
  originalFilename: string;
  objectKey: string;
};

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fallbackTitle(filename: string) {
  return filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "").trim() || "未命名书籍";
}

function bookSummary(row: BookRow): LibraryBook {
  return {
    ...row,
    sourceLabel: "本地",
    createdAt: row.createdAt.toISOString(),
  };
}

export class LibraryRuntime {
  private readonly parseJobs = new Set<Promise<void>>();

  constructor(
    private readonly sql: Sql,
    private readonly objectDirectory: string,
    private readonly parseDelayMs: number,
    private readonly onTextReady?: (accountId: string, bookId: string) => Promise<unknown>,
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
    return rows.map(bookSummary);
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
    return bookSummary(row);
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
    if (result.parseStatus === "ready_text" && this.onTextReady) {
      try {
        await this.onTextReady(file.accountId, file.bookId);
      } catch (error) {
        publicationError = error instanceof Error ? error.message : "TEXT_PARSE_FAILED";
      }
    }
    await this.sql.begin(async (transaction) => {
      if (result.parseStatus === "ready_text" && this.onTextReady && !publicationError) {
        await transaction`
          UPDATE books
          SET parse_status = 'ready_text', parse_error_code = NULL
          WHERE id = ${file.bookId} AND account_id = ${file.accountId}
            AND parse_status = 'processing'
        `;
      } else {
        await transaction`
          UPDATE books
          SET title = ${result.title}, author = ${result.author},
              parse_status = ${publicationError ? "failed" : result.parseStatus},
              parse_error_code = ${publicationError || result.errorCode},
              section_count = ${result.sectionCount}, page_count = ${result.pageCount}
          WHERE id = ${file.bookId} AND account_id = ${file.accountId}
            AND parse_status = 'processing'
        `;
      }
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
  onTextReady?: (accountId: string, bookId: string) => Promise<unknown>;
}) {
  const sql = postgres(options.databaseUrl, { max: 4 });
  const runtime = new LibraryRuntime(
    sql,
    options.objectDirectory,
    options.parseDelayMs ?? 20,
    options.onTextReady,
  );
  await runtime.initialize();
  return runtime;
}
