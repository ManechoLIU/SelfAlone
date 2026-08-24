import { describe, expect, it } from "vitest";
import {
  extractTextBook,
  resolveTextLocation,
  type ExtractedTextBook,
} from "./text-reader";

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

function realEpub() {
  return storedZip({
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    "OEBPS/content.opf": `
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>雨后山亭</dc:title><dc:creator>林野</dc:creator></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" properties="nav"/>
          <item id="ending" href="chapters/ending.xhtml"/>
          <item id="opening" href="chapters/opening.xhtml"/>
        </manifest>
        <spine><itemref idref="opening"/><itemref idref="ending"/></spine>
      </package>`,
    "OEBPS/nav.xhtml": `
      <html><body><nav epub:type="toc"><ol>
        <li><a href="chapters/opening.xhtml">雨停以后</a></li>
        <li><a href="chapters/ending.xhtml#last">山路尽头</a></li>
      </ol></nav></body></html>`,
    "OEBPS/chapters/opening.xhtml":
      "<html><body><h1>第一章</h1><p>一阵雨过后，远山重新显出来。</p><p>她沿着石阶向上走。</p></body></html>",
    "OEBPS/chapters/ending.xhtml":
      "<html><body><h1 id='last'>第二章</h1><p>亭中只有风声，和一盏未冷的茶。</p></body></html>",
  });
}

describe("M1-F2-B text extraction and location", () => {
  it("follows the real EPUB spine, uses its table of contents and keeps stable section ids", () => {
    const first = extractTextBook({ filename: "雨后山亭.epub", bytes: realEpub(), fileVersion: 3 });
    const repeated = extractTextBook({ filename: "雨后山亭.epub", bytes: realEpub(), fileVersion: 3 });

    expect(first).toMatchObject({
      format: "epub",
      fileVersion: 3,
      title: "雨后山亭",
      author: "林野",
    });
    expect(first.sections.map(({ sectionId, title, order }) => ({ sectionId, title, order }))).toEqual([
      { sectionId: "epub:opening", title: "雨停以后", order: 0 },
      { sectionId: "epub:ending", title: "山路尽头", order: 1 },
    ]);
    expect(first.sections[0]?.text).toBe("第一章\n\n一阵雨过后，远山重新显出来。\n\n她沿着石阶向上走。");
    expect(first.sections[1]?.text).toContain("亭中只有风声");
    expect(repeated.sections.map((section) => section.sectionId)).toEqual(
      first.sections.map((section) => section.sectionId),
    );
  });

  it("turns a real TXT chapter sequence into a navigable ordered book", () => {
    const book = extractTextBook({
      filename: "夜航手记.txt",
      bytes: Buffer.from("\uFEFF序章\r\n灯塔亮了。\r\n\r\n第一章 风从海上来\r\n船离开了港口。\r\n\r\n第二章 回声\r\n雨落在甲板上。"),
      fileVersion: 1,
    });

    expect(book.sections.map((section) => [section.title, section.text])).toEqual([
      ["序章", "序章\n灯塔亮了。"],
      ["第一章 风从海上来", "第一章 风从海上来\n船离开了港口。"],
      ["第二章 回声", "第二章 回声\n雨落在甲板上。"],
    ]);
    expect(book.sections.map((section) => section.sectionId)).toEqual([
      "txt:00000000",
      "txt:00000010",
      "txt:00000029",
    ]);
  });

  it("maintains one whole-book position and rejects a locator from an old file version", () => {
    const book: ExtractedTextBook = {
      format: "txt",
      fileVersion: 4,
      title: "位置测试",
      author: null,
      sections: [
        { sectionId: "txt:a", title: "甲", order: 0, text: "12345" },
        { sectionId: "txt:b", title: "乙", order: 1, text: "abcdef" },
      ],
    };

    expect(resolveTextLocation(book, null)).toEqual({
      locator: { kind: "text", fileVersion: 4, sectionId: "txt:a", offset: 0 },
      progress: 0,
    });
    expect(
      resolveTextLocation(book, { kind: "text", fileVersion: 4, sectionId: "txt:b", offset: 3 }),
    ).toEqual({
      locator: { kind: "text", fileVersion: 4, sectionId: "txt:b", offset: 3 },
      progress: 8 / 11,
    });
    expect(() =>
      resolveTextLocation(book, { kind: "text", fileVersion: 3, sectionId: "txt:b", offset: 3 }),
    ).toThrow("STALE_VERSION");
  });
});
