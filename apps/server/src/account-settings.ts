import postgres, { type Sql } from "postgres";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail, validatePassword, type PasswordHasher } from "@selfalone/domain";
import { createArgon2idPasswordHasher } from "./auth-runtime";

export const ACCOUNT_SETTINGS_TOKEN_TTL_MS = 15 * 60 * 1_000;

export type AccountTokenKind = "password_reset" | "email_change";

export type StoredAccountToken = {
  id: string;
  accountId: string;
  kind: AccountTokenKind;
  email: string;
  digest: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type AccountSettingsAccount = {
  id: string;
  email: string;
  passwordHash: string;
  wechatConnected: boolean;
};

export type AccountEmailIdentity = {
  id: string;
  email: string;
};

/**
 * The settings runtime depends on a narrow persistence boundary so its token
 * rules can be verified without coupling the account flow to HTTP routing.
 * The PostgreSQL adapter can implement this contract behind the migration in
 * `account-settings-migration.ts`.
 */
export type AccountSettingsStore = {
  findAccount(accountId: string): Promise<AccountSettingsAccount | null>;
  findEmailAccount(email: string): Promise<AccountEmailIdentity | null>;
  insertToken(token: StoredAccountToken): Promise<void>;
  findActiveToken(
    digest: string,
    kind: AccountTokenKind,
    now: Date,
  ): Promise<StoredAccountToken | null>;
  markTokenUsed(digest: string, usedAt: Date): Promise<void>;
  updateEmail(accountId: string, email: string, changedAt?: Date): Promise<void>;
  updatePassword(accountId: string, passwordHash: string, changedAt?: Date): Promise<void>;
  revokeSessions(accountId: string, revokedAt?: Date): Promise<void>;
};

export type EmailDeliveryMessage = {
  kind: AccountTokenKind;
  to: string;
  token: string;
};

export type EmailDelivery = {
  send(message: EmailDeliveryMessage): Promise<void>;
};

export type AccountSettingsRuntimeOptions = {
  store: AccountSettingsStore;
  passwordHasher: PasswordHasher;
  emailDelivery?: EmailDelivery;
  now?: () => Date;
  tokenTtlMs?: number;
};

export type AccountSettingsRuntimeFactoryOptions = {
  databaseUrl: string;
  passwordHasher?: PasswordHasher;
  emailDelivery?: EmailDelivery;
  now?: () => Date;
  tokenTtlMs?: number;
};

export type AccountSettingsOverview = {
  account: { id: string; email: string };
  loginMethods: {
    email: { connected: true; label: string };
    wechat: { connected: boolean; label: string | null };
  };
};

function invalidToken(token: string) {
  if (token.length === 0 || token.length > 512) throw new Error("INVALID_EMAIL_TOKEN");
}

export class AccountSettingsRuntime {
  readonly #store: AccountSettingsStore;
  readonly #passwordHasher: PasswordHasher;
  readonly #emailDelivery: EmailDelivery | undefined;
  readonly #now: () => Date;
  readonly #tokenTtlMs: number;

  constructor(options: AccountSettingsRuntimeOptions) {
    this.#store = options.store;
    this.#passwordHasher = options.passwordHasher;
    this.#emailDelivery = options.emailDelivery;
    this.#now = options.now ?? (() => new Date());
    this.#tokenTtlMs = options.tokenTtlMs ?? ACCOUNT_SETTINGS_TOKEN_TTL_MS;
    if (!Number.isSafeInteger(this.#tokenTtlMs) || this.#tokenTtlMs <= 0) {
      throw new Error("INVALID_TOKEN_TTL");
    }
  }

  async getOverview(accountId: string): Promise<AccountSettingsOverview> {
    const account = await this.#requireAccount(accountId);
    return {
      account: { id: account.id, email: account.email },
      loginMethods: {
        email: { connected: true, label: account.email },
        wechat: {
          connected: account.wechatConnected,
          label: account.wechatConnected ? "已连接" : null,
        },
      },
    };
  }

  /**
   * Delivers no account-specific response for unknown addresses. For a known
   * address, an absent provider fails before a token is written, so local or
   * unauthorized deployments cannot pretend that email verification happened.
   */
  async requestPasswordReset(emailInput: string): Promise<void> {
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch {
      return;
    }
    const identity = await this.#store.findEmailAccount(email);
    if (!identity) return;
    await this.#sendToken(identity.id, "password_reset", email);
  }

  async confirmPasswordReset(token: string, password: string): Promise<void> {
    invalidToken(token);
    validatePassword(password);
    const now = this.#now();
    const stored = await this.#activeToken(token, "password_reset", now);
    const passwordHash = await this.#passwordHasher.hash(password);
    await this.#store.updatePassword(stored.accountId, passwordHash, now);
    await this.#store.markTokenUsed(stored.digest, now);
    await this.#store.revokeSessions(stored.accountId, now);
  }

  async requestEmailChange(
    accountId: string,
    currentPassword: string,
    newEmailInput: string,
  ): Promise<void> {
    const account = await this.#requireAccount(accountId);
    if (!await this.#passwordHasher.verify(currentPassword, account.passwordHash)) {
      throw new Error("REAUTHENTICATION_REQUIRED");
    }
    const newEmail = normalizeEmail(newEmailInput);
    if (newEmail === account.email) throw new Error("EMAIL_UNCHANGED");
    const existing = await this.#store.findEmailAccount(newEmail);
    if (existing && existing.id !== accountId) throw new Error("EMAIL_ALREADY_REGISTERED");
    await this.#sendToken(accountId, "email_change", newEmail);
  }

  async confirmEmailChange(token: string): Promise<void> {
    invalidToken(token);
    const now = this.#now();
    const stored = await this.#activeToken(token, "email_change", now);
    const existing = await this.#store.findEmailAccount(stored.email);
    if (existing && existing.id !== stored.accountId) throw new Error("EMAIL_ALREADY_REGISTERED");
    await this.#store.updateEmail(stored.accountId, stored.email, now);
    await this.#store.markTokenUsed(stored.digest, now);
    await this.#store.revokeSessions(stored.accountId, now);
  }

  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const account = await this.#requireAccount(accountId);
    if (!await this.#passwordHasher.verify(currentPassword, account.passwordHash)) {
      throw new Error("REAUTHENTICATION_REQUIRED");
    }
    validatePassword(newPassword);
    const now = this.#now();
    const passwordHash = await this.#passwordHasher.hash(newPassword);
    await this.#store.updatePassword(accountId, passwordHash, now);
    await this.#store.revokeSessions(accountId, now);
  }

  async #sendToken(accountId: string, kind: AccountTokenKind, email: string) {
    if (!this.#emailDelivery) throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
    const token = createOpaqueToken();
    const now = this.#now();
    await this.#emailDelivery.send({ kind, to: email, token });
    await this.#store.insertToken({
      id: createOpaqueToken(),
      accountId,
      kind,
      email,
      digest: hashOpaqueToken(token),
      expiresAt: new Date(now.getTime() + this.#tokenTtlMs),
      usedAt: null,
      createdAt: now,
    });
  }

  async #activeToken(token: string, kind: AccountTokenKind, now: Date) {
    const digest = hashOpaqueToken(token);
    const stored = await this.#store.findActiveToken(digest, kind, now);
    if (!stored) throw new Error("INVALID_EMAIL_TOKEN");
    return stored;
  }

  async #requireAccount(accountId: string) {
    const account = await this.#store.findAccount(accountId);
    if (!account) throw new Error("ACCOUNT_NOT_FOUND");
    return account;
  }
}

function createPostgresAccountSettingsStore(sql: Sql): AccountSettingsStore {
  return {
    async findAccount(accountId) {
      const [row] = await sql<Array<AccountSettingsAccount>>`
        SELECT
          account.id,
          email_identity.email,
          email_identity.password_hash AS "passwordHash",
          EXISTS (
            SELECT 1
            FROM login_identities AS wechat_identity
            WHERE wechat_identity.account_id = account.id
              AND wechat_identity.provider IN ('wechat_web', 'wechat_miniapp')
          ) AS "wechatConnected"
        FROM accounts AS account
        JOIN login_identities AS email_identity
          ON email_identity.account_id = account.id
          AND email_identity.provider = 'email'
        WHERE account.id = ${accountId}
        LIMIT 1
      `;
      return row ?? null;
    },

    async findEmailAccount(email) {
      const [row] = await sql<Array<AccountEmailIdentity>>`
        SELECT account_id AS id, email
        FROM login_identities
        WHERE provider = 'email' AND email = ${email}
        LIMIT 1
      `;
      return row ?? null;
    },

    async insertToken(token) {
      await sql`
        INSERT INTO email_tokens (
          id, account_id, kind, email, token_digest, expires_at, used_at, created_at
        ) VALUES (
          ${token.id}, ${token.accountId}, ${token.kind}, ${token.email},
          ${token.digest}, ${token.expiresAt}, ${token.usedAt}, ${token.createdAt}
        )
      `;
    },

    async findActiveToken(digest, kind, now) {
      const [row] = await sql<Array<StoredAccountToken>>`
        SELECT
          id,
          account_id AS "accountId",
          kind,
          email,
          token_digest AS digest,
          expires_at AS "expiresAt",
          used_at AS "usedAt",
          created_at AS "createdAt"
        FROM email_tokens
        WHERE token_digest = ${digest}
          AND kind = ${kind}
          AND used_at IS NULL
          AND expires_at > ${now}
        LIMIT 1
      `;
      return row ?? null;
    },

    async markTokenUsed(digest, usedAt) {
      await sql`
        UPDATE email_tokens
        SET used_at = ${usedAt}
        WHERE token_digest = ${digest} AND used_at IS NULL
      `;
    },

    async updateEmail(accountId, email) {
      await sql`
        UPDATE login_identities
        SET email = ${email}, provider_subject = ${email}
        WHERE account_id = ${accountId} AND provider = 'email'
      `;
    },

    async updatePassword(accountId, passwordHash) {
      await sql`
        UPDATE login_identities
        SET password_hash = ${passwordHash}
        WHERE account_id = ${accountId} AND provider = 'email'
      `;
    },

    async revokeSessions(accountId, revokedAt) {
      await sql`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ${revokedAt ?? new Date()})
        WHERE account_id = ${accountId} AND revoked_at IS NULL
      `;
    },
  };
}

/**
 * Production wiring for the settings runtime. Email delivery is intentionally
 * absent until an authorized provider is supplied, so reset and email-change
 * requests remain fail-closed while account reads and password changes use the
 * same PostgreSQL account/session tables as AuthRuntime.
 */
export async function createAccountSettingsRuntime(
  options: AccountSettingsRuntimeFactoryOptions,
) {
  const sql = postgres(options.databaseUrl, { max: 4 });
  const runtime = new AccountSettingsRuntime({
    store: createPostgresAccountSettingsStore(sql),
    passwordHasher: options.passwordHasher ?? createArgon2idPasswordHasher(),
    emailDelivery: options.emailDelivery,
    now: options.now,
    tokenTtlMs: options.tokenTtlMs,
  });
  return Object.assign(runtime, { close: () => sql.end() });
}
