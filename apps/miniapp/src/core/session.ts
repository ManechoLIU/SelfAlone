const sessionKey = "selfalone.miniapp.session.v2";
const emailDraftKey = "selfalone.miniapp.email-draft.v1";

export type Session =
  | { kind: "signed-out" }
  | { kind: "development" }
  | { kind: "authenticated"; token: string; expiresAt: number };

export type KeyValueStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): unknown;
};

export type SessionStoreOptions = {
  now?: () => number;
};

const MIN_SESSION_TOKEN_LENGTH = 24;

function isValidSessionToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_SESSION_TOKEN_LENGTH;
}

function isValidExpiry(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function createSessionStore(
  storage: KeyValueStorage,
  policy: { developmentAdapter: boolean },
  options: SessionStoreOptions = {},
) {
  const now = options.now ?? (() => Date.now());

  return {
    restore(): Session {
      const saved = storage.get(sessionKey);
      if (saved === "development" && policy.developmentAdapter) return { kind: "development" };
      if (typeof saved === "object" && saved !== null && "token" in saved) {
        const candidate = saved as { token?: unknown; expiresAt?: unknown };
        if (isValidSessionToken(candidate.token) && isValidExpiry(candidate.expiresAt)) {
          if (candidate.expiresAt <= now()) {
            storage.remove(sessionKey);
            return { kind: "signed-out" };
          }
          return { kind: "authenticated", token: candidate.token, expiresAt: candidate.expiresAt };
        }
        storage.remove(sessionKey);
      }
      return { kind: "signed-out" };
    },
    startDevelopmentSession(): Session {
      if (!policy.developmentAdapter) throw new Error("DEVELOPMENT_SESSION_DISABLED");
      storage.set(sessionKey, "development");
      return { kind: "development" };
    },
    saveAuthenticatedSession(token: string, expiresAt: number): Session {
      if (!isValidSessionToken(token)) throw new Error("INVALID_SESSION_TOKEN");
      if (!isValidExpiry(expiresAt) || expiresAt <= now()) throw new Error("INVALID_SESSION_EXPIRY");
      storage.set(sessionKey, { token, expiresAt });
      return { kind: "authenticated", token, expiresAt };
    },
    clear(): Session {
      storage.remove(sessionKey);
      return { kind: "signed-out" };
    },
    clearOnUnauthorized(status: number): boolean {
      if (status !== 401) return false;
      storage.remove(sessionKey);
      return true;
    },
    saveEmailDraft(email: string) {
      storage.set(emailDraftKey, email);
    },
    restoreEmailDraft() {
      const saved = storage.get(emailDraftKey);
      return typeof saved === "string" ? saved : "";
    },
  };
}
