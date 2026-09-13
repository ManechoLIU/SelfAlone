export type MiniappRuntimeConfig = {
  /** Public API origin only; credentials, paths, query strings, and fragments are rejected. */
  apiBaseUrl?: string;
};

export function resolveMiniappRuntimeConfig(apiBaseUrl: unknown): MiniappRuntimeConfig {
  if (typeof apiBaseUrl !== "string" || !apiBaseUrl.trim()) return {};
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::([1-9][0-9]{0,4}))?\/?$/i
    .exec(apiBaseUrl.trim());
  if (!match) return {};
  if (!isPublicDnsHost(match[1])) return {};
  if (match[2] && Number(match[2]) > 65_535) return {};
  return { apiBaseUrl: `https://${match[1]}${match[2] ? `:${match[2]}` : ""}` };
}

export function readHostMiniappRuntimeConfig(): MiniappRuntimeConfig {
  const host = globalThis as { wx?: { getExtConfigSync?: () => unknown } };
  try {
    const config = host.wx?.getExtConfigSync?.();
    if (!config || typeof config !== "object") return {};
    return resolveMiniappRuntimeConfig((config as { apiBaseUrl?: unknown }).apiBaseUrl);
  } catch {
    return {};
  }
}

function isPublicDnsHost(host: string): boolean {
  const labels = host.toLowerCase().split(".");
  return !labels.includes("localhost") && labels.some((label) => /[a-z]/.test(label));
}
