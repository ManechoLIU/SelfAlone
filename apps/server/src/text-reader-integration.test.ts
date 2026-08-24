import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { extractTextBook } from "@selfalone/domain";
import { createApp } from "./app";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";
import { createTextReaderRuntime, type TextReaderRuntime } from "./text-reader";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("EXPECTED_STATE_NOT_REACHED");
}

describe("M1-F2-B main integration", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  const libraries: LibraryRuntime[] = [];
  const readers: TextReaderRuntime[] = [];
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(libraries.splice(0).map((runtime) => runtime.close()));
    await Promise.all(readers.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(
      objectDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("exports text extraction through the domain package boundary", async () => {
    const domain = await import("@selfalone/domain") as Record<string, unknown>;

    expect(typeof domain.extractTextBook).toBe("function");
  });

  it("publishes imported TXT sections and restores the saved reading position after restart", async () => {
    const schema = `text_reader_integration_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const isolatedUrl = new URL(baseDatabaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const databaseUrl = isolatedUrl.toString();
    const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-text-reader-integration-"));
    objectDirectories.push(objectDirectory);

    const reader = await createTextReaderRuntime({ databaseUrl, objectDirectory, extractTextBook });
    readers.push(reader);
    const libraryOptions = {
      databaseUrl,
      objectDirectory,
      parseDelayMs: 0,
      onTextReady: (accountId: string, bookId: string) => reader.publishTextBook(accountId, bookId),
    };
    const library = await createLibraryRuntime(libraryOptions);
    libraries.push(library);
    await administration.unsafe(`
      INSERT INTO "${schema}".accounts (id, created_at) VALUES ('account-a', now())
    `);
    const dependencies = {
      readiness: async () => (await library.ready()) && (await reader.ready()),
      library,
      textReader: reader,
    };
    const app = createApp(dependencies);
    apps.push(app);

    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("夜航手记.txt"),
        "x-selfalone-account": "account-a",
      },
      payload: Buffer.from("序章\n灯塔亮了。\n\n第一章 风从海上来\n船离开了港口。"),
    });
    expect(imported.statusCode).toBe(202);
    const bookId = imported.json().id as string;

    const sections = await eventually(
      async () => app.inject({
        method: "GET",
        url: `/api/v1/books/${bookId}/content/sections`,
        headers: { "x-selfalone-account": "account-a" },
      }),
      (response) => response.statusCode === 200 && response.json().sections?.length === 2,
    );
    expect(sections.json()).toMatchObject({
      fileVersion: 1,
      sections: [
        { sectionId: "txt:00000000", order: 0 },
        { sectionId: "txt:00000010", order: 1 },
      ],
    });

    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/books/${bookId}/position`,
      headers: { "x-selfalone-account": "account-a" },
      payload: {
        expectedVersion: 0,
        locator: { kind: "text", fileVersion: 1, sectionId: "txt:00000010", offset: 4 },
        background: "dark",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: 1, background: "dark" });

    await app.close();
    apps.length = 0;
    await library.close();
    libraries.length = 0;
    await reader.close();
    readers.length = 0;

    const restoredReader = await createTextReaderRuntime({
      databaseUrl,
      objectDirectory,
      extractTextBook,
    });
    readers.push(restoredReader);
    const restoredLibraryOptions = {
      databaseUrl,
      objectDirectory,
      parseDelayMs: 0,
      onTextReady: (accountId: string, restoredBookId: string) =>
        restoredReader.publishTextBook(accountId, restoredBookId),
    };
    const restoredLibrary = await createLibraryRuntime(restoredLibraryOptions);
    libraries.push(restoredLibrary);
    const restoredDependencies = {
      readiness: async () => (await restoredLibrary.ready()) && (await restoredReader.ready()),
      library: restoredLibrary,
      textReader: restoredReader,
    };
    const restoredApp = createApp(restoredDependencies);
    apps.push(restoredApp);

    const reading = await restoredApp.inject({
      method: "GET",
      url: `/api/v1/books/${bookId}/reading`,
      headers: { "x-selfalone-account": "account-a" },
    });
    expect(reading.statusCode).toBe(200);
    expect(reading.json()).toMatchObject({
      bookId,
      fileVersion: 1,
      position: {
        locator: { sectionId: "txt:00000010", offset: 4 },
        background: "dark",
        version: 1,
      },
    });
  });
});
