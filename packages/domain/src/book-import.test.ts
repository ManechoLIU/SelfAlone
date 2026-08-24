import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { inspectImportedBook } from "./book-import";

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
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 16);
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

describe("local book inspection", () => {
  it("uses the TXT filename as title and reports missing author without inventing metadata", () => {
    expect(
      inspectImportedBook({ filename: "山海札记.txt", bytes: Buffer.from("第一章\n风从海上来。") }),
    ).toEqual({
      format: "txt",
      title: "山海札记",
      author: null,
      parseStatus: "ready_text",
      sectionCount: 1,
      pageCount: null,
      errorCode: null,
    });
  });

  it("extracts EPUB title, author and readable spine count", () => {
    const bytes = storedZip({
      "META-INF/container.xml":
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      "OEBPS/content.opf": `
        <package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:title>远山来信</dc:title><dc:creator>林野</dc:creator></metadata>
          <manifest><item id="chapter" href="chapter.xhtml"/></manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`,
      "OEBPS/chapter.xhtml": "<html><body><h1>第一章</h1><p>雾散以后，亭子显出来。</p></body></html>",
    });

    expect(inspectImportedBook({ filename: "upload.epub", bytes })).toEqual({
      format: "epub",
      title: "远山来信",
      author: "林野",
      parseStatus: "ready_text",
      sectionCount: 1,
      pageCount: null,
      errorCode: null,
    });
  });

  it("distinguishes text PDF from a valid page-only PDF", () => {
    const textPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n2 0 obj<</Type /Page>>endobj\n" +
        "3 0 obj<</Title (Field Notes)>>endobj\n4 0 obj<</Length 30>>stream\nBT (Readable page text) Tj ET\nendstream\n%%EOF",
      "latin1",
    );
    const pagePdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n2 0 obj<</Type /Page /Resources <<>>>>endobj\n%%EOF",
      "latin1",
    );

    expect(inspectImportedBook({ filename: "notes.pdf", bytes: textPdf })).toMatchObject({
      title: "Field Notes",
      parseStatus: "ready_text",
      pageCount: 1,
      errorCode: null,
    });
    expect(inspectImportedBook({ filename: "scan.pdf", bytes: pagePdf })).toMatchObject({
      title: "scan",
      parseStatus: "ready_pages",
      pageCount: 1,
      errorCode: null,
    });
  });

  it("recognizes text stored in a Flate-compressed PDF stream", () => {
    const compressed = deflateSync(Buffer.from("BT (Compressed readable text) Tj ET", "latin1"));
    const bytes = Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n2 0 obj<</Type /Page>>endobj\n3 0 obj<</Filter /FlateDecode /Length ${compressed.length}>>stream\n`,
        "latin1",
      ),
      compressed,
      Buffer.from("\nendstream\n%%EOF", "latin1"),
    ]);

    expect(inspectImportedBook({ filename: "compressed.pdf", bytes })).toMatchObject({
      parseStatus: "ready_text",
      pageCount: 1,
      errorCode: null,
    });
  });

  it("does not mistake binary page data containing operator-like bytes for text", () => {
    const compressed = deflateSync(Buffer.from("image-bytes-BT-random-TJ-more-ET-image-bytes", "latin1"));
    const bytes = Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n2 0 obj<</Type /Page>>endobj\n3 0 obj<</Filter /FlateDecode /Length ${compressed.length}>>stream\n`,
        "latin1",
      ),
      compressed,
      Buffer.from("\nendstream\n%%EOF", "latin1"),
    ]);

    expect(inspectImportedBook({ filename: "scan.pdf", bytes })).toMatchObject({
      parseStatus: "ready_pages",
      pageCount: 1,
      errorCode: null,
    });
  });

  it("keeps encrypted and damaged PDFs as distinct failed parse results", () => {
    const encrypted = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<</Encrypt 4 0 R>>\n%%EOF",
      "latin1",
    );

    expect(inspectImportedBook({ filename: "locked.pdf", bytes: encrypted })).toMatchObject({
      parseStatus: "failed",
      errorCode: "PDF_ENCRYPTED",
    });
    expect(
      inspectImportedBook({ filename: "broken.pdf", bytes: Buffer.from("%PDF-not-complete") }),
    ).toMatchObject({
      parseStatus: "failed",
      errorCode: "PDF_INVALID",
    });
  });
});
