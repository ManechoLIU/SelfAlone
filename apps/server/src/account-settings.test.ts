import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@selfalone/domain";
import {
  AccountSettingsRuntime,
  type AccountSettingsStore,
  type EmailDelivery,
  type StoredAccountToken,
} from "./account-settings";

type MutableClock = { now: Date };

function createClock(start = "2026-08-25T00:00:00.000Z"): MutableClock {
  return { now: new Date(start) };
}

function createHasher(): PasswordHasher {
  return {
    algorithm: "test",
    async hash(password) {
      return `test$${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `test$${password}`;
    },
  };
}

function createStore(): AccountSettingsStore & {
  tokens: StoredAccountToken[];
  revokedAccounts: string[];
  account: { id: string; email: string; passwordHash: string; wechatConnected: boolean };
} {
  const account = {
    id: "account-1",
    email: "reader@example.com",
    passwordHash: "test$current password",
    wechatConnected: false,
  };
  const tokens: StoredAccountToken[] = [];
  const revokedAccounts: string[] = [];
  return {
    account,
    tokens,
    revokedAccounts,
    async findAccount(accountId) {
      return accountId === account.id ? { ...account } : null;
    },
    async findEmailAccount(email) {
      return email === account.email ? { id: account.id, email: account.email } : null;
    },
    async insertToken(token) {
      tokens.push({ ...token });
    },
    async findActiveToken(digest, kind, now) {
      const token = tokens.find((candidate) =>
        candidate.digest === digest
        && candidate.kind === kind
        && candidate.usedAt === null
        && candidate.expiresAt > now,
      );
      return token ? { ...token } : null;
    },
    async markTokenUsed(digest, usedAt) {
      const token = tokens.find((candidate) => candidate.digest === digest);
      if (token) token.usedAt = usedAt;
    },
    async updateEmail(accountId, email) {
      if (accountId === account.id) account.email = email;
    },
    async updatePassword(accountId, passwordHash) {
      if (accountId === account.id) account.passwordHash = passwordHash;
    },
    async revokeSessions(accountId) {
      revokedAccounts.push(accountId);
    },
  };
}

function createDelivery() {
  const messages: Array<{ kind: string; to: string; token: string }> = [];
  const delivery: EmailDelivery = {
    async send(message) {
      messages.push({ ...message });
    },
  };
  return { delivery, messages };
}

describe("M1-F1-B account settings runtime", () => {
  it("fails closed before writing a reset token when real email delivery is not authorized", async () => {
    const store = createStore();
    const runtime = new AccountSettingsRuntime({
      store,
      passwordHasher: createHasher(),
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    await expect(runtime.requestPasswordReset("reader@example.com")).rejects.toThrow(
      "EMAIL_DELIVERY_UNAVAILABLE",
    );
    expect(store.tokens).toEqual([]);
  });

  it("allows one password reset token, rejects replay, expires old tokens, and revokes sessions", async () => {
    const store = createStore();
    const { delivery, messages } = createDelivery();
    const clock = createClock();
    const runtime = new AccountSettingsRuntime({
      store,
      passwordHasher: createHasher(),
      emailDelivery: delivery,
      now: () => clock.now,
      tokenTtlMs: 15 * 60 * 1_000,
    });

    await runtime.requestPasswordReset(" reader@example.com ");
    const token = messages.at(-1)?.token;
    expect(token).toBeTruthy();
    await runtime.confirmPasswordReset(token ?? "", "new password");
    expect(store.account.passwordHash).toBe("test$new password");
    expect(store.revokedAccounts).toEqual(["account-1"]);
    await expect(runtime.confirmPasswordReset(token ?? "", "another password")).rejects.toThrow(
      "INVALID_EMAIL_TOKEN",
    );

    await runtime.requestPasswordReset("reader@example.com");
    const expiredToken = messages.at(-1)?.token ?? "";
    clock.now = new Date(clock.now.getTime() + 15 * 60 * 1_000 + 1);
    await expect(runtime.confirmPasswordReset(expiredToken, "expired password")).rejects.toThrow(
      "INVALID_EMAIL_TOKEN",
    );
  });

  it("requires current identity proof, verifies a new email before replacement, and retains old data on failure", async () => {
    const store = createStore();
    const { delivery, messages } = createDelivery();
    const runtime = new AccountSettingsRuntime({
      store,
      passwordHasher: createHasher(),
      emailDelivery: delivery,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    await expect(
      runtime.requestEmailChange("account-1", "wrong current password", "new@example.com"),
    ).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(store.account.email).toBe("reader@example.com");

    await runtime.requestEmailChange("account-1", "current password", "New@Example.com");
    expect(store.account.email).toBe("reader@example.com");
    const message = messages.at(-1);
    expect(message?.kind).toBe("email_change");
    await runtime.confirmEmailChange(message?.token ?? "");
    expect(store.account.email).toBe("new@example.com");
  });

  it("changes a password only after current identity proof and keeps it unchanged on failure", async () => {
    const store = createStore();
    const runtime = new AccountSettingsRuntime({
      store,
      passwordHasher: createHasher(),
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    await expect(
      runtime.changePassword("account-1", "wrong current password", "new password"),
    ).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(store.account.passwordHash).toBe("test$current password");
    await runtime.changePassword("account-1", "current password", "new password");
    expect(store.account.passwordHash).toBe("test$new password");
    expect(store.revokedAccounts).toEqual(["account-1"]);
  });
});
