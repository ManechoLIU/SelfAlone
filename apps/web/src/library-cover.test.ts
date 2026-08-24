import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const expectedAssets = [
  {
    url: "/book-covers/local-default-celadon-ink-v1.png",
    path: new URL("../../../redesign-v2/assets/book-covers/local-default-celadon-ink-v1.png", import.meta.url),
    sha256: "b7c79385b385b404155b89ca685e90ac5e2f6887d7cc10e71d7cc0fb3351eae8",
  },
  {
    url: "/book-covers/local-default-amber-lamp-v1.png",
    path: new URL("../../../redesign-v2/assets/book-covers/local-default-amber-lamp-v1.png", import.meta.url),
    sha256: "dde0cec465fcf131cea06e55f1b22951cc23e2cec4be2774f61f246a2c9fa1d1",
  },
  {
    url: "/book-covers/local-default-indigo-sea-v1.png",
    path: new URL("../../../redesign-v2/assets/book-covers/local-default-indigo-sea-v1.png", import.meta.url),
    sha256: "e539f0db602a10383e0ff86f7b2905708b5c959f5d1f0c4c3440322b61d42d52",
  },
] as const;

async function loadCoverModule() {
  const modulePath = "./library-cover";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

describe("local default cover selection", () => {
  it("ships the three exact user-approved backgrounds", async () => {
    const hashes = await Promise.all(expectedAssets.map(async (asset) => {
      const bytes = await readFile(asset.path);
      return createHash("sha256").update(bytes).digest("hex");
    }));

    expect(hashes).toEqual(expectedAssets.map((asset) => asset.sha256));
  });

  it("selects only by book id and stays stable when the shelf order changes", async () => {
    const coverModule = await loadCoverModule();
    expect(coverModule).not.toBeNull();
    if (!coverModule) return;

    expect(coverModule.LOCAL_COVER_ASSETS).toEqual(expectedAssets.map((asset) => asset.url));
    expect(coverModule.coverAssetForBook("book-1")).toBe(expectedAssets[2].url);
    expect(coverModule.coverAssetForBook("book-2")).toBe(expectedAssets[0].url);
    expect(coverModule.coverAssetForBook("book-3")).toBe(expectedAssets[1].url);

    const ids = ["book-1", "book-2", "book-3"];
    const firstOrder = Object.fromEntries(ids.map((id) => [id, coverModule.coverAssetForBook(id)]));
    const reversedOrder = Object.fromEntries([...ids].reverse().map((id) => [id, coverModule.coverAssetForBook(id)]));
    expect(reversedOrder).toEqual(firstOrder);
  });
});
