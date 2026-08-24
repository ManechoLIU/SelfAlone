import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inflateLimits = vi.hoisted(() => [] as Array<number | undefined>);

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    inflateRawSync: (_bytes: Buffer, options?: { maxOutputLength?: number }) => {
      inflateLimits.push(options?.maxOutputLength);
      throw Object.assign(new RangeError("output exceeds configured limit"), {
        code: "ERR_BUFFER_TOO_LARGE",
      });
    },
  };
});

import { extractTextBook } from "./text-reader";

const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;

function singleEntryZip(input: {
  method: 0 | 8;
  compressed: Buffer;
  declaredUncompressedSize: number;
}) {
  const filename = Buffer.from("bomb.xhtml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(input.method, 8);
  local.writeUInt32LE(input.compressed.length, 18);
  local.writeUInt32LE(input.declaredUncompressedSize, 22);
  local.writeUInt16LE(filename.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(input.method, 10);
  central.writeUInt32LE(input.compressed.length, 20);
  central.writeUInt32LE(input.declaredUncompressedSize, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + filename.length + input.compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, filename, input.compressed, central, filename, end]);
}

describe("M1-F2-B EPUB extraction limits", () => {
  beforeEach(() => {
    inflateLimits.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a declared compressed bomb before asking zlib to allocate output", () => {
    const bytes = singleEntryZip({
      method: 8,
      compressed: Buffer.from([0x03, 0x00]),
      declaredUncompressedSize: MAX_EXTRACTED_BYTES + 1,
    });

    expect(() => extractTextBook({ filename: "bomb.epub", bytes, fileVersion: 1 })).toThrow(
      "EPUB_INVALID",
    );
    expect(inflateLimits).toEqual([]);
  });

  it("bounds a deflate stream whose central size is falsely small and normalizes zlib failure", () => {
    const bytes = singleEntryZip({
      method: 8,
      compressed: Buffer.from([0xed, 0xc1, 0x01, 0x01]),
      declaredUncompressedSize: 1,
    });

    expect(() => extractTextBook({ filename: "lying-bomb.epub", bytes, fileVersion: 1 })).toThrow(
      "EPUB_INVALID",
    );
    expect(inflateLimits).toEqual([MAX_EXTRACTED_BYTES]);
  });

  it("rejects an oversized stored entry before copying its bytes", () => {
    const oversizedMarker = Buffer.from([0x7f]);
    const bytes = singleEntryZip({
      method: 0,
      compressed: oversizedMarker,
      declaredUncompressedSize: MAX_EXTRACTED_BYTES + 1,
    });
    const originalFrom = Buffer.from.bind(Buffer);
    vi.spyOn(Buffer, "from").mockImplementation(((value: unknown, ...args: unknown[]) => {
      if (Buffer.isBuffer(value) && value.length === 1 && value[0] === 0x7f) {
        throw new Error("OVERSIZED_STORED_ENTRY_WAS_COPIED");
      }
      return originalFrom(value as never, ...(args as never[]));
    }) as typeof Buffer.from);

    expect(() => extractTextBook({ filename: "stored-bomb.epub", bytes, fileVersion: 1 })).toThrow(
      "EPUB_INVALID",
    );
  });
});
