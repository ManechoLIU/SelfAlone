export const LOCAL_COVER_ASSETS = [
  "/book-covers/local-default-celadon-ink-v1.png",
  "/book-covers/local-default-amber-lamp-v1.png",
  "/book-covers/local-default-indigo-sea-v1.png",
] as const;

export function coverAssetForBook(bookId: string): (typeof LOCAL_COVER_ASSETS)[number] {
  let hash = 2166136261;
  for (const character of bookId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return LOCAL_COVER_ASSETS[(hash >>> 0) % LOCAL_COVER_ASSETS.length];
}
