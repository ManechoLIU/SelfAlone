import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "../../../../apps/server/node_modules/postgres/src/index.js";
import { extractTextBook } from "../../../../packages/domain/src/text-reader";
import { createApp } from "../../../../apps/server/src/app";
import { createLibraryRuntime } from "../../../../apps/server/src/library-runtime";
import { createTextReaderRuntime, registerTextReaderRoutes } from "../../../../apps/server/src/text-reader";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
const schema = `acceptance_text_reader_${randomUUID().replaceAll("-", "")}`;
const administration = postgres(baseDatabaseUrl, { max: 1 });
await administration.unsafe(`CREATE SCHEMA "${schema}"`);
const databaseUrl = new URL(baseDatabaseUrl);
databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
const objectDirectory = await mkdtemp(join(tmpdir(), "selfalone-m1-f2-b-"));
const reader = await createTextReaderRuntime({
  databaseUrl: databaseUrl.toString(),
  objectDirectory,
  extractTextBook,
});
const library = await createLibraryRuntime({
  databaseUrl: databaseUrl.toString(),
  objectDirectory,
  parseDelayMs: 0,
  textPublisher: reader,
});
await administration.unsafe(`
  INSERT INTO "${schema}".accounts (id, created_at)
  VALUES ('account-a', now()), ('account-b', now())
`);

function storedZip(entries: Record<string, string>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const body = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, filename);
    localOffset += local.length + filename.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const longParagraphs = Array.from({ length: 9 }, (_, index) =>
  `第${index + 1}段：雨线从屋檐落下，远山在雾气之后慢慢显出轮廓。她沿着石阶向上走，记下路旁每一株松树与每一次停顿。`,
).join("\n\n");
const txtBytes = Buffer.from(
  `序章\n灯塔在傍晚亮起。\n\n第一章 风从海上来\n${longParagraphs}\n\n第二章 靠岸以后\n${longParagraphs}`,
  "utf8",
);
const epubBytes = storedZip({
  "META-INF/container.xml":
    '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
  "OEBPS/content.opf": `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
    <metadata><dc:title>雨后山亭</dc:title><dc:creator>林野</dc:creator></metadata>
    <manifest>
      <item id="nav" href="nav.xhtml" properties="nav"/>
      <item id="one" href="chapters/one.xhtml"/>
      <item id="two" href="chapters/two.xhtml"/>
    </manifest>
    <spine><itemref idref="one"/><itemref idref="two"/></spine>
  </package>`,
  "OEBPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol>
    <li><a href="chapters/one.xhtml">雨停以后</a></li>
    <li><a href="chapters/two.xhtml">山路尽头</a></li>
  </ol></nav></body></html>`,
  "OEBPS/chapters/one.xhtml": `<html><body><h1>第一章</h1><p>${longParagraphs.replaceAll("\n\n", "</p><p>")}</p></body></html>`,
  "OEBPS/chapters/two.xhtml": `<html><body><h1>第二章</h1><p>${longParagraphs.replaceAll("\n\n", "</p><p>")}</p></body></html>`,
});

async function importReady(filename: string, bytes: Buffer) {
  const imported = await library.importBook("account-a", filename, bytes);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const book = await library.getBook("account-a", imported.id);
    if (book.parseStatus === "ready_text") return book;
    if (book.parseStatus === "failed") throw new Error(`ACCEPTANCE_IMPORT_FAILED:${filename}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`ACCEPTANCE_IMPORT_TIMEOUT:${filename}`);
}

const txtBook = await importReady("夜航手记.txt", txtBytes);
const epubBook = await importReady("雨后山亭.epub", epubBytes);
const emptyBook = await importReady("暂未发布正文.txt", Buffer.from("第一章\n正文等待发布。"));
await administration.unsafe(`
  DELETE FROM "${schema}".book_sections
  WHERE account_id = 'account-a' AND book_id = '${emptyBook.id}'
`);
const privateBook = await library.importBook("account-b", "另一个账户.txt", Buffer.from("第一章\n不可跨账户读取。"));
for (let attempt = 0; attempt < 80; attempt += 1) {
  if ((await library.getBook("account-b", privateBook.id)).parseStatus === "ready_text") break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const app = createApp({
  readiness: async () => (await library.ready()) && (await reader.ready()),
  library,
});
registerTextReaderRoutes(app, reader, () => "account-a");
app.get("/api/v1/acceptance/text-books", async () => ({
  txt: txtBook.id,
  epub: epubBook.id,
  empty: emptyBook.id,
  private: privateBook.id,
  missing: "missing-book",
}));
await app.listen({ host: "127.0.0.1", port: 3001 });
console.log(JSON.stringify({ status: "ready", schema, books: { txt: txtBook.id, epub: epubBook.id, empty: emptyBook.id } }));

async function close() {
  await app.close();
  await reader.close();
  await library.close();
  await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await administration.end();
  await rm(objectDirectory, { recursive: true, force: true });
}
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
