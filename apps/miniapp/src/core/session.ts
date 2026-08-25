const sessionKey = "selfalone.miniapp.session.v2";
const emailDraftKey = "selfalone.miniapp.email-draft.v1";

export type Session =
  | { kind: "signed-out" }
  | { kind: "development" }
  | { kind: "authenticated"; token: string };

export type KeyValueStorage = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): unknown;
};

export function createSessionStore(
  storage: KeyValueStorage,
  policy: { developmentAdapter: boolean },
) {
  return {
    restore(): Session {
      const saved = storage.get(sessionKey);
      if (saved === "development" && policy.developmentAdapter) return { kind: "development" };
      if (typeof saved === "object" && saved !== null && "token" in saved) {
        const token = (saved as { token?: unknown }).token;
        if (typeof token === "string" && token.length >= 24) {
          return { kind: "authenticated", token };
        }
      }
      return { kind: "signed-out" };
    },
    startDevelopmentSession(): Session {
      if (!policy.developmentAdapter) throw new Error("DEVELOPMENT_SESSION_DISABLED");
      storage.set(sessionKey, "development");
      return { kind: "development" };
    },
    saveAuthenticatedSession(token: string): Session {
      if (token.length < 24) throw new Error("INVALID_SESSION_TOKEN");
      storage.set(sessionKey, { token });
      return { kind: "authenticated", token };
    },
    clear() {
      storage.remove(sessionKey);
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
