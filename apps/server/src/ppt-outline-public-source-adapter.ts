import type {
  BookSourceQuery,
  PptPublicSource,
  PptPublicSourceAdapter,
} from "./ppt-outline-adapters";

export const PPT_OUTLINE_ABORTED = "PPT_OUTLINE_ABORTED" as const;

/** Stable code for callers that want explicit "insufficient / unavailable" semantics. */
export const PPT_PUBLIC_SOURCE_INSUFFICIENT = "PPT_PUBLIC_SOURCE_INSUFFICIENT" as const;

const DEFAULT_BODY_SUFFICIENT_MIN_CHARS = 2_000;
const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_FETCH_TIMEOUT_MS = 4_000;

export type PublicSourceHit = {
  url: string;
  title: string;
  publishedAt: string | null;
};

/**
 * Injectable transport so unit tests never hit the network and production can
 * swap providers without forking adapter logic.
 */
export type PublicSourceSearchTransport = {
  search(
    query: { title: string; author: string | null },
    signal: AbortSignal,
  ): Promise<readonly PublicSourceHit[]>;
};

export type RealPptPublicSourceAdapterOptions = {
  transport?: PublicSourceSearchTransport;
  now?: () => Date;
  /** Treat bodyCharCount >= this as sufficient when bodySufficient is unset. */
  bodySufficientMinChars?: number;
  maxResults?: number;
};

/**
 * Real public-source adapter (SA-P2).
 *
 * - Body sufficient → skip networking, return [].
 * - Insufficient → bounded lookup via transport; network/empty → [] (never fabricate).
 * - Never returns example.invalid / placeholder publisher URLs.
 */
export class RealPptPublicSourceAdapter implements PptPublicSourceAdapter {
  private readonly transport: PublicSourceSearchTransport;
  private readonly now: () => Date;
  private readonly bodySufficientMinChars: number;
  private readonly maxResults: number;

  constructor(options: RealPptPublicSourceAdapterOptions = {}) {
    this.transport = options.transport ?? createOpenLibraryPublicSourceTransport();
    this.now = options.now ?? (() => new Date());
    this.bodySufficientMinChars =
      options.bodySufficientMinChars ?? DEFAULT_BODY_SUFFICIENT_MIN_CHARS;
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  }

  async search(input: BookSourceQuery, signal: AbortSignal): Promise<PptPublicSource[]> {
    if (signal.aborted) throw new Error(PPT_OUTLINE_ABORTED);

    if (isBodySufficient(input, this.bodySufficientMinChars)) {
      return [];
    }

    let hits: readonly PublicSourceHit[];
    try {
      hits = await this.transport.search(
        { title: input.title, author: input.author },
        signal,
      );
    } catch {
      if (signal.aborted) throw new Error(PPT_OUTLINE_ABORTED);
      // Degrade: no fabricated "whole book analysis" sources.
      return [];
    }

    if (signal.aborted) throw new Error(PPT_OUTLINE_ABORTED);

    const fetchedAt = this.now().toISOString();
    const accepted: PptPublicSource[] = [];
    for (const hit of hits) {
      if (accepted.length >= this.maxResults) break;
      if (!isCrediblePublicSourceUrl(hit.url)) continue;
      const title = hit.title?.trim();
      if (!title) continue;
      accepted.push({
        url: hit.url,
        title,
        publishedAt: hit.publishedAt,
        fetchedAt,
        usageScope: `outline:${input.draftId}`,
      });
    }
    return accepted;
  }
}

export function createRealPptPublicSourceAdapter(
  options?: RealPptPublicSourceAdapterOptions,
): PptPublicSourceAdapter {
  return new RealPptPublicSourceAdapter(options);
}

export function isBodySufficient(
  input: Pick<BookSourceQuery, "bodySufficient" | "bodyCharCount">,
  minChars: number = DEFAULT_BODY_SUFFICIENT_MIN_CHARS,
): boolean {
  if (input.bodySufficient === true) return true;
  if (input.bodySufficient === false) return false;
  if (typeof input.bodyCharCount === "number" && Number.isFinite(input.bodyCharCount)) {
    return input.bodyCharCount >= minChars;
  }
  return false;
}

/** Reject forged / placeholder research URLs (Fake uses example.invalid). */
export function isCrediblePublicSourceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (host === "example.invalid" || host.endsWith(".example.invalid")) return false;
  if (host === "example.com" || host.endsWith(".example.com")) return false;
  return true;
}

/**
 * Default transport: Open Library search JSON (no API key).
 * Failure / empty is fine — adapter degrades to [].
 */
export function createOpenLibraryPublicSourceTransport(
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    endpoint?: string;
  } = {},
): PublicSourceSearchTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const endpoint = options.endpoint ?? "https://openlibrary.org/search.json";

  return {
    async search(query, signal) {
      const title = query.title.trim();
      if (!title) return [];

      const url = new URL(endpoint);
      url.searchParams.set("title", title);
      if (query.author?.trim()) url.searchParams.set("author", query.author.trim());
      url.searchParams.set("limit", String(DEFAULT_MAX_RESULTS));

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return [];
        const payload = (await response.json()) as {
          docs?: Array<{
            key?: string;
            title?: string;
            first_publish_year?: number;
          }>;
        };
        const docs = Array.isArray(payload.docs) ? payload.docs : [];
        const hits: PublicSourceHit[] = [];
        for (const doc of docs) {
          if (!doc?.key || !doc.title) continue;
          const workPath = doc.key.startsWith("/") ? doc.key : `/${doc.key}`;
          hits.push({
            url: `https://openlibrary.org${workPath}`,
            title: doc.title,
            publishedAt:
              typeof doc.first_publish_year === "number"
                ? `${doc.first_publish_year}-01-01T00:00:00.000Z`
                : null,
          });
        }
        return hits;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
