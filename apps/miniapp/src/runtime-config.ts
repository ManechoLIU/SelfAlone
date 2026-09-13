export type MiniappRuntimeConfig = {
  /** Public API origin only; credentials, paths, query strings, and fragments are rejected. */
  apiBaseUrl?: string;
};

export function resolveMiniappRuntimeConfig(apiBaseUrl: unknown): MiniappRuntimeConfig {
  if (typeof apiBaseUrl !== "string" || !apiBaseUrl.trim()) return {};
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::([1-9][0-9]{0,4}))?\/?$/i
    .exec(apiBaseUrl.trim());
  if (!match) return {};
  if (match[2] && Number(match[2]) > 65_535) return {};
  return { apiBaseUrl: `https://${match[1]}${match[2] ? `:${match[2]}` : ""}` };
}
