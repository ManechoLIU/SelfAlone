import { posix } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

export type ImportedBookInspection = {
  format: "epub" | "txt" | "pdf";
  title: string;
  author: string | null;
  parseStatus: "ready_text" | "ready_pages" | "failed";
  sectionCount: number;
  pageCount: number | null;
  errorCode: "PDF_ENCRYPTED" | "PDF_INVALID" | "BOOK_TEXT_MISSING" | "EPUB_INVALID" | null;
};

export function inspectImportedBook(_input: {
  filename: string;
  bytes: Buffer;
}): ImportedBookInspection {
  const input = _input;
  const extension = input.filename.split(".").at(-1)?.toLowerCase();
  if (extension === "txt") return inspectText(input.filename, input.bytes);
  if (extension === "epub") return inspectEpub(input.filename, input.bytes);
  if (extension === "pdf") return inspectPdf(input.filename, input.bytes);
  throw new Error("UNSUPPORTED_BOOK_FORMAT");
}

function fallbackTitle(filename: string) {
  const basename = filename.split(/[\\/]/).at(-1) ?? filename;
  return basename.replace(/\.[^.]+$/, "").trim() || "未命名书籍";
}

function inspectText(filename: string, bytes: Buffer): ImportedBookInspection {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  return {
    format: "txt",
    title: fallbackTitle(filename),
    author: null,
    parseStatus: text ? "ready_text" : "failed",
    sectionCount: text ? 1 : 0,
    pageCount: null,
    errorCode: text ? null : "BOOK_TEXT_MISSING",
  };
}

function decodeXml(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return entities[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstXmlTag(xml: string, localName: string) {
  const match = xml.match(
    new RegExp(
      `<(?:(?:[\\w-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${localName}>`,
      "i",
    ),
  );
  return match ? decodeXml(match[1] ?? "") : null;
}

function readZipEntries(bytes: Buffer) {
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) endOffset = offset;
  }
  if (endOffset < 0) throw new Error("EPUB_INVALID");

  const entryCount = bytes.readUInt16LE(endOffset + 10);
  let centralOffset = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error("EPUB_INVALID");
    const method = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const filenameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    const filename = bytes.subarray(centralOffset + 46, centralOffset + 46 + filenameLength).toString();
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("EPUB_INVALID");
    const localFilenameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    if (method === 0) entries.set(filename, Buffer.from(compressed));
    else if (method === 8) entries.set(filename, inflateRawSync(compressed));
    else throw new Error("EPUB_INVALID");
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function inspectEpub(filename: string, bytes: Buffer): ImportedBookInspection {
  try {
    const entries = readZipEntries(bytes);
    const container = entries.get("META-INF/container.xml")?.toString("utf8");
    const rootfile = container?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
    const opf = rootfile ? entries.get(rootfile)?.toString("utf8") : undefined;
    if (!rootfile || !opf) throw new Error("EPUB_INVALID");

    const manifest = new Map<string, string>();
    for (const item of opf.matchAll(/<item\b([^>]+?)\/?\s*>/gi)) {
      const attributes = item[1] ?? "";
      const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (id && href) manifest.set(id, href);
    }
    const directory = posix.dirname(rootfile);
    let sectionCount = 0;
    for (const item of opf.matchAll(/<itemref\b([^>]+?)\/?\s*>/gi)) {
      const id = item[1]?.match(/\bidref\s*=\s*["']([^"']+)["']/i)?.[1];
      const href = id ? manifest.get(id) : undefined;
      const path = href
        ? posix.normalize(posix.join(directory, decodeURIComponent(href.split("#")[0] ?? href)))
        : undefined;
      const body = path ? entries.get(path)?.toString("utf8") : undefined;
      if (body && decodeXml(body)) sectionCount += 1;
    }
    if (sectionCount === 0) throw new Error("EPUB_INVALID");
    return {
      format: "epub",
      title: firstXmlTag(opf, "title") || fallbackTitle(filename),
      author: firstXmlTag(opf, "creator"),
      parseStatus: "ready_text",
      sectionCount,
      pageCount: null,
      errorCode: null,
    };
  } catch {
    return {
      format: "epub",
      title: fallbackTitle(filename),
      author: null,
      parseStatus: "failed",
      sectionCount: 0,
      pageCount: null,
      errorCode: "EPUB_INVALID",
    };
  }
}

function decodePdfLiteral(value: string) {
  return value.replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => {
    const mapped: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\",
    };
    return mapped[escaped] ?? escaped;
  });
}

function inspectPdf(filename: string, bytes: Buffer): ImportedBookInspection {
  const title = fallbackTitle(filename);
  const source = bytes.toString("latin1");
  const base = {
    format: "pdf" as const,
    title,
    author: null,
    sectionCount: 0,
  };
  if (!source.startsWith("%PDF-") || !source.includes("%%EOF")) {
    return { ...base, parseStatus: "failed", pageCount: null, errorCode: "PDF_INVALID" };
  }
  const pageCount = [...source.matchAll(/\/Type\s*\/Page\b/g)].length;
  if (pageCount === 0) {
    return { ...base, parseStatus: "failed", pageCount: null, errorCode: "PDF_INVALID" };
  }
  if (/\/Encrypt\b/.test(source)) {
    return { ...base, parseStatus: "failed", pageCount, errorCode: "PDF_ENCRYPTED" };
  }
  const metadataTitle = source.match(/\/Title\s*\(((?:\\.|[^\\)])*)\)/)?.[1];
  const contentStreams: string[] = [];
  for (const match of source.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)) {
    if (/\/FlateDecode\b/.test(match[1] ?? "")) {
      try {
        contentStreams.push(inflateSync(Buffer.from(match[2] ?? "", "latin1")).toString("latin1"));
      } catch {
        // A damaged page stream does not make otherwise enumerable pages disappear.
      }
    } else {
      contentStreams.push(match[2] ?? "");
    }
  }
  const fragments = contentStreams.flatMap((content) =>
    [...content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((match) =>
      decodePdfLiteral(match[1] ?? ""),
    ),
  );
  const textObject = /\bBT\b[\s\S]{0,16384}?(?:\([^)]*\)|<[\da-f\s]+>|\[[\s\S]{0,4096}\])\s*T(?:j|J)\b[\s\S]{0,256}?\bET\b/i;
  const hasText = fragments.join(" ").replace(/[^\p{L}\p{N}]/gu, "").length >= 4
    || contentStreams.some((content) => textObject.test(content));
  return {
    ...base,
    title: metadataTitle ? decodePdfLiteral(metadataTitle) : title,
    parseStatus: hasText ? "ready_text" : "ready_pages",
    pageCount,
    errorCode: null,
  };
}
