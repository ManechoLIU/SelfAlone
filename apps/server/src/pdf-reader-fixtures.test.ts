import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = resolve("redesign-v2/output/acceptance/m1-f2-c/fixtures");

const fixtures = [
  ["multi-page-text.pdf", "925853d98d67d5dae7473c635f932958e1695ce1029d23b2ecd2531cb65f1f14"],
  ["scanned-image-only.pdf", "afbed07b9fe25563b2604b81cd7186c91d4356e5428a05322b8b7eae88301e24"],
  ["encrypted-password-protected.pdf", "3c2815853e6fe5c34feb76bb14402cbc46bbd484ecd57b672fc03577d0458ee8"],
  ["truncated.pdf", "570b916bc28474937c555d62a41a10fa175df5a9c12d6d3af454fe210d2a7673"],
] as const;

describe("M1-F2-C real PDF fixture matrix", () => {
  it.each(fixtures)("pins %s by SHA-256 and keeps a real PDF header", async (filename, sha256) => {
    const bytes = await readFile(resolve(fixtureRoot, filename));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it("keeps the truncated case observably incomplete", async () => {
    const bytes = await readFile(resolve(fixtureRoot, "truncated.pdf"));
    expect(bytes.includes(Buffer.from("%%EOF"))).toBe(false);
  });
});
