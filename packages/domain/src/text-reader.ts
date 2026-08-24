import { posix } from "node:path";
import { inflateRawSync } from "node:zlib";

export type TextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

export type TextSection = {
  sectionId: string;
  title: string;
  order: number;
  text: string;
};

export type ExtractedTextBook = {
  format: "epub" | "txt";
  fileVersion: number;
  title: string;
  author: string | null;
  sections: TextSection[];
};

type ZipEntry = { path: string; bytes: Buffer };

const MAX_ZIP_ENTRIES = 10_000;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;

function fallbackTitle(filename: string) {
  return filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "").trim() || "未命名书籍";
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return entities[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function xmlText(value: string) {
  return decodeEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstTag(value: string, localName: string) {
  const match = value.match(
    new RegExp(
      `<(?:(?:[\\w-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${localName}>`,
      "i",
    ),
  );
  return match ? xmlText(match[1] ?? "") : null;
}

function attributes(value: string) {
  const result = new Map<string, string>();
  for (const match of value.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    const name = match[1]?.toLowerCase();
    if (name) result.set(name, decodeEntities(match[2] ?? ""));
  }
  return result;
}

function safeArchivePath(base: string, href: string) {
  const decoded = decodeURIComponent(href.split("#", 1)[0] ?? href);
  const joined = posix.normalize(posix.join(base, decoded));
  if (joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined)) {
    throw new Error("EPUB_INVALID");
  }
  return joined;
}

function readZipEntries(bytes: Buffer) {
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) endOffset = offset;
  }
  if (endOffset < 0) throw new Error("EPUB_INVALID");

  const entryCount = bytes.readUInt16LE(endOffset + 10);
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) throw new Error("EPUB_INVALID");
  let centralOffset = bytes.readUInt32LE(endOffset + 16);
  let extractedBytes = 0;
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > bytes.length || bytes.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("EPUB_INVALID");
    }
    const method = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const uncompressedSize = bytes.readUInt32LE(centralOffset + 24);
    const filenameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("EPUB_INVALID");
    }
    const filename = bytes.subarray(centralOffset + 46, centralOffset + 46 + filenameLength).toString();
    const normalized = posix.normalize(filename);
    if (normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
      throw new Error("EPUB_INVALID");
    }
    const localFilenameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new Error("EPUB_INVALID");
    const remaining = MAX_EXTRACTED_BYTES - extractedBytes;
    if (remaining <= 0 || uncompressedSize > remaining) throw new Error("EPUB_INVALID");
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let body: Buffer | null = null;
    if (method === 0) {
      body = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        body = inflateRawSync(compressed, { maxOutputLength: remaining });
      } catch {
        throw new Error("EPUB_INVALID");
      }
    }
    if (!body || body.length !== uncompressedSize) throw new Error("EPUB_INVALID");
    extractedBytes += body.length;
    entries.set(normalized, body);
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function parseEpub(input: { filename: string; bytes: Buffer; fileVersion: number }): ExtractedTextBook {
  const entries = readZipEntries(input.bytes);
  const container = entries.get("META-INF/container.xml")?.toString("utf8");
  const rootfile = container?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  const rootPath = rootfile ? safeArchivePath("", rootfile) : null;
  const opf = rootPath ? entries.get(rootPath)?.toString("utf8") : undefined;
  if (!rootPath || !opf) throw new Error("EPUB_INVALID");

  const directory = posix.dirname(rootPath);
  const manifest = new Map<string, { path: string; properties: string }>();
  for (const item of opf.matchAll(/<item\b([^>]+?)\/?\s*>/gi)) {
    const values = attributes(item[1] ?? "");
    const id = values.get("id");
    const href = values.get("href");
    if (id && href) {
      manifest.set(id, {
        path: safeArchivePath(directory, href),
        properties: values.get("properties") ?? "",
      });
    }
  }

  const tocTitles = new Map<string, string>();
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const nav = navItem ? entries.get(navItem.path)?.toString("utf8") : undefined;
  if (nav && navItem) {
    const navDirectory = posix.dirname(navItem.path);
    for (const anchor of nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attributes(anchor[1] ?? "").get("href");
      const title = xmlText(anchor[2] ?? "");
      if (href && title) tocTitles.set(safeArchivePath(navDirectory, href), title);
    }
  }

  const sections: TextSection[] = [];
  for (const itemref of opf.matchAll(/<itemref\b([^>]+?)\/?\s*>/gi)) {
    const id = attributes(itemref[1] ?? "").get("idref");
    const item = id ? manifest.get(id) : undefined;
    const markup = item ? entries.get(item.path)?.toString("utf8") : undefined;
    const text = markup ? xmlText(markup.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? markup) : "";
    if (!id || !item || !markup || !text) continue;
    sections.push({
      sectionId: `epub:${id}`,
      title: tocTitles.get(item.path) || firstTag(markup, "h1") || firstTag(markup, "h2") || `第 ${sections.length + 1} 节`,
      order: sections.length,
      text,
    });
  }
  if (sections.length === 0) throw new Error("BOOK_TEXT_MISSING");
  return {
    format: "epub",
    fileVersion: input.fileVersion,
    title: firstTag(opf, "title") || fallbackTitle(input.filename),
    author: firstTag(opf, "creator"),
    sections,
  };
}

function isTxtHeading(line: string) {
  const value = line.trim();
  return /^(?:#{1,6}\s+\S|序章$|引言$|前言$|后记$|第[^\s]{1,12}[章节卷篇部](?:\s+.*)?$)/.test(value);
}

function parseTxt(input: { filename: string; bytes: Buffer; fileVersion: number }): ExtractedTextBook {
  const source = input.bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!source) throw new Error("BOOK_TEXT_MISSING");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of source.split("\n")) {
    if (isTxtHeading(line)) starts.push(cursor);
    cursor += line.length + 1;
  }
  if (starts[0] !== 0) starts.unshift(0);

  const sections = starts.map((start, index) => {
    const end = starts[index + 1] ?? source.length;
    const text = source.slice(start, end).trim();
    const firstLine = text.split("\n", 1)[0]?.replace(/^#{1,6}\s+/, "").trim();
    return {
      sectionId: `txt:${String(start).padStart(8, "0")}`,
      title: firstLine || (index === 0 ? fallbackTitle(input.filename) : `第 ${index + 1} 节`),
      order: index,
      text,
    };
  }).filter((section) => section.text);

  return {
    format: "txt",
    fileVersion: input.fileVersion,
    title: fallbackTitle(input.filename),
    author: null,
    sections,
  };
}

export function extractTextBook(input: {
  filename: string;
  bytes: Buffer;
  fileVersion: number;
}): ExtractedTextBook {
  const extension = input.filename.split(".").at(-1)?.toLowerCase();
  if (!Number.isInteger(input.fileVersion) || input.fileVersion < 1) throw new Error("INVALID_FILE_VERSION");
  if (extension === "txt") return parseTxt(input);
  if (extension === "epub") return parseEpub(input);
  throw new Error("UNSUPPORTED_TEXT_FORMAT");
}

export function resolveTextLocation(book: ExtractedTextBook, locator: TextLocator | null) {
  if (book.sections.length === 0) throw new Error("BOOK_TEXT_MISSING");
  if (locator && locator.fileVersion !== book.fileVersion) throw new Error("STALE_VERSION");
  const section = locator
    ? book.sections.find((candidate) => candidate.sectionId === locator.sectionId)
    : book.sections[0];
  if (!section) throw new Error("SECTION_NOT_FOUND");
  const offset = Math.max(0, Math.min(locator?.offset ?? 0, section.text.length));
  const before = book.sections
    .filter((candidate) => candidate.order < section.order)
    .reduce((total, candidate) => total + candidate.text.length, 0);
  const total = book.sections.reduce((sum, candidate) => sum + candidate.text.length, 0);
  return {
    locator: {
      kind: "text" as const,
      fileVersion: book.fileVersion,
      sectionId: section.sectionId,
      offset,
    },
    progress: total === 0 ? 0 : (before + offset) / total,
  };
}
