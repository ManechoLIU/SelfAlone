export const QA_REAL_HTTP_STORAGE_KEY = "sa2QaRealHttp";

const QA_LOOPBACK_ORIGINS = new Set(["http://127.0.0.1:4100", "http://localhost:4100"]);

export type MiniappRuntimeConfig = {
  /** Public API origin only; credentials, paths, query strings, and fragments are rejected. */
  apiBaseUrl?: string;
};

export type MiniappRuntimeConfigResolveOptions = {
  /** QA-only: accept http://127.0.0.1:4100 and http://localhost:4100. Default off. */
  allowLoopback?: boolean;
};

export type MiniappQaLocalConfig = {
  sa2QaRealHttp?: unknown;
  apiBaseUrl?: unknown;
};

export type MiniappHostExtConfig = {
  apiBaseUrl?: unknown;
  sa2QaRealHttp?: unknown;
};

export function resolveMiniappRuntimeConfig(
  apiBaseUrl: unknown,
  options?: MiniappRuntimeConfigResolveOptions,
): MiniappRuntimeConfig {
  if (typeof apiBaseUrl !== "string" || !apiBaseUrl.trim()) return {};
  const trimmed = apiBaseUrl.trim();
  if (options?.allowLoopback) {
    const loopback = /^http:\/\/(127\.0\.0\.1|localhost):4100\/?$/i.exec(trimmed);
    if (loopback) {
      const host = loopback[1].toLowerCase() === "localhost" ? "localhost" : "127.0.0.1";
      const origin = `http://${host}:4100`;
      if (QA_LOOPBACK_ORIGINS.has(origin)) return { apiBaseUrl: origin };
    }
  }
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::([1-9][0-9]{0,4}))?\/?$/i
    .exec(trimmed);
  if (!match) return {};
  if (!isPublicDnsHost(match[1])) return {};
  if (match[2] && Number(match[2]) > 65_535) return {};
  return { apiBaseUrl: `https://${match[1]}${match[2] ? `:${match[2]}` : ""}` };
}

export function readHostMiniappExtConfig(): MiniappHostExtConfig {
  const host = globalThis as { wx?: { getExtConfigSync?: () => unknown } };
  try {
    const config = host.wx?.getExtConfigSync?.();
    if (!config || typeof config !== "object") return {};
    const record = config as Record<string, unknown>;
    return {
      apiBaseUrl: record.apiBaseUrl,
      sa2QaRealHttp: record.sa2QaRealHttp,
    };
  } catch {
    return {};
  }
}

export function readHostMiniappRuntimeConfig(
  options?: MiniappRuntimeConfigResolveOptions,
): MiniappRuntimeConfig {
  return resolveMiniappRuntimeConfig(readHostMiniappExtConfig().apiBaseUrl, options);
}

export function parseQaRealHttpFlag(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return undefined;
}

export function resolveQaRealHttpFlag(input: {
  optionValue?: unknown;
  optionProvided?: boolean;
  localConfig?: MiniappQaLocalConfig;
  extConfig?: MiniappHostExtConfig;
  storage?: { get(key: string): unknown } | null;
}): boolean {
  if (input.optionProvided) return parseQaRealHttpFlag(input.optionValue) === true;
  const local = parseQaRealHttpFlag(input.localConfig?.sa2QaRealHttp);
  if (local !== undefined) return local;
  const ext = parseQaRealHttpFlag(input.extConfig?.sa2QaRealHttp);
  if (ext !== undefined) return ext;
  const stored = input.storage
    ? parseQaRealHttpFlag(input.storage.get(QA_REAL_HTTP_STORAGE_KEY))
    : undefined;
  if (stored !== undefined) return stored;
  return false;
}

export function readLocalMiniappRuntimeConfig(): MiniappQaLocalConfig {
  const fromPackage = readOptionalJsonObject("runtime-config.local.json")
    ?? readOptionalJsonObject("src/runtime-config.local.json");
  if (fromPackage) return asLocalConfig(fromPackage);

  const node = nodeFsAndPath();
  if (!node) return {};
  const files = [
    node.resolve(node.cwd, "apps/miniapp/runtime-config.local.json"),
    node.resolve(node.cwd, "apps/miniapp/src/runtime-config.local.json"),
    node.resolve(node.cwd, "runtime-config.local.json"),
    node.resolve(node.cwd, "src/runtime-config.local.json"),
  ];
  for (const file of files) {
    try {
      if (!node.fs.existsSync(file)) continue;
      return asLocalConfig(JSON.parse(node.fs.readFileSync(file, "utf8")));
    } catch {
      // gitignored local file is optional and may be unreadable
    }
  }
  return {};
}

function asLocalConfig(value: unknown): MiniappQaLocalConfig {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    sa2QaRealHttp: record.sa2QaRealHttp,
    apiBaseUrl: record.apiBaseUrl,
  };
}

function readOptionalJsonObject(filePath: string): unknown {
  try {
    const wxHost = globalThis as {
      wx?: {
        getFileSystemManager?: () => {
          readFileSync?: (filePath: string, encoding?: string) => unknown;
        };
      };
    };
    const raw = wxHost.wx?.getFileSystemManager?.().readFileSync?.(filePath, "utf8");
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function nodeFsAndPath(): {
  fs: { existsSync(path: string): boolean; readFileSync(path: string, encoding: string): string };
  resolve: (...parts: string[]) => string;
  cwd: string;
} | undefined {
  const proc = globalThis as {
    process?: {
      cwd?: () => string;
      versions?: { node?: string };
      getBuiltinModule?: (id: string) => unknown;
    };
  };
  const processRef = proc.process;
  if (typeof processRef?.cwd !== "function" || !processRef.versions?.node) return undefined;
  if (typeof processRef.getBuiltinModule !== "function") return undefined;
  try {
    const fs = processRef.getBuiltinModule("fs") as {
      existsSync?: (path: string) => boolean;
      readFileSync?: (path: string, encoding: string) => string;
    } | undefined;
    const path = processRef.getBuiltinModule("path") as { resolve?: (...parts: string[]) => string } | undefined;
    if (typeof fs?.existsSync !== "function" || typeof fs.readFileSync !== "function") return undefined;
    if (typeof path?.resolve !== "function") return undefined;
    return { fs: { existsSync: fs.existsSync, readFileSync: fs.readFileSync }, resolve: path.resolve, cwd: processRef.cwd() };
  } catch {
    return undefined;
  }
}

function isPublicDnsHost(host: string): boolean {
  const labels = host.toLowerCase().split(".");
  return host.length <= 253
    && labels.every((label) => label.length <= 63)
    && !labels.includes("localhost")
    && labels.some((label) => /[a-z]/.test(label));
}
