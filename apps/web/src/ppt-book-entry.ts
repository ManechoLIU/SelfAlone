export const pptBookIntentDraft = "帮我制作这本书PPT";

export type PptBookEntry = {
  bookId: string;
  draft: typeof pptBookIntentDraft;
};

export function bookPptEntryFromHash(hash: string): PptBookEntry | null {
  const [route, query = ""] = hash.slice(1).split("?");
  if (route !== "/conversation") return null;
  const bookId = new URLSearchParams(query).get("book")?.trim();
  return bookId ? { bookId, draft: pptBookIntentDraft } : null;
}

export function isPositiveBookPptIntent(text: string) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized.includes(pptBookIntentDraft)) return false;
  return !/(?:不要|不想|别).{0,12}帮我制作这本书PPT/.test(normalized);
}
