import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import {
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
  SESSION_TTL_SECONDS,
  validatePassword,
  type PasswordHasher,
} from "@selfalone/domain";
import type { AuthAccount } from "@selfalone/contracts";
import postgres, { type Sql, type TransactionSql } from "postgres";

const EMAIL_PROVIDER = "email";
const DUMMY_PASSWORD = "selfalone-dummy-password-probe";

export const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

type AuthRuntimeOptions = {
  databaseUrl: string;
  appEnv?: string;
  passwordHasher?: PasswordHasher;
  accountInitializer?: (accountId: string) => Promise<void>;
};

type RuntimeConstructorOptions = {
  appEnv: string;
  passwordHasher: PasswordHasher;
  accountInitializer?: (accountId: string) => Promise<void>;
};

type AccountRow = AuthAccount;

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505";
}

export function createArgon2idPasswordHasher(): PasswordHasher {
  return {
    algorithm: "argon2id",
    async hash(password) {
      return argon2.hash(password, ARGON2ID_OPTIONS);
    },
    async verify(password, encodedHash) {
      try {
        return await argon2.verify(encodedHash, password);
      } catch {
        return false;
      }
    },
  };
}

/** Deterministic hasher used only by isolated tests; production always uses Argon2id. */
export function createTestPasswordHasher(): PasswordHasher {
  return {
    algorithm: "test",
    async hash(password) {
      return `test$${Buffer.from(password, "utf8").toString("base64url")}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `test$${Buffer.from(password, "utf8").toString("base64url")}`;
    },
  };
}

export type AuthSessionResult = {
  account: AccountRow;
  sessionToken: string;
};

export class AuthRuntime {
  readonly #sql: Sql;
  readonly #appEnv: string;
  readonly #passwordHasher: PasswordHasher;
  readonly #accountInitializer: ((accountId: string) => Promise<void>) | undefined;
  #dummyPasswordHashPromise: Promise<string> | undefined;

  constructor(sql: Sql, options: RuntimeConstructorOptions) {
    this.#sql = sql;
    this.#appEnv = options.appEnv;
    this.#passwordHasher = options.passwordHasher;
    this.#accountInitializer = options.accountInitializer;
    if (this.#appEnv !== "development" && this.#passwordHasher.algorithm !== "argon2id") {
      throw new Error("ARGON2ID_REQUIRED");
    }
  }

  async initialize() {
    await this.#sql`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS login_identities (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        provider text NOT NULL,
        provider_subject text NOT NULL,
        email text,
        password_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject),
        CONSTRAINT login_identity_email_password CHECK (
          provider <> 'email' OR (email IS NOT NULL AND password_hash IS NOT NULL)
        )
      )
    `;
    // The M0 ownership migration predates email credentials and creates the
    // identity table without these nullable columns. Extend that table before
    // creating the email index so an existing local database can restart safely.
    await this.#sql`ALTER TABLE login_identities ADD COLUMN IF NOT EXISTS email text`;
    await this.#sql`ALTER TABLE login_identities ADD COLUMN IF NOT EXISTS password_hash text`;
    await this.#sql`
      CREATE UNIQUE INDEX IF NOT EXISTS login_identities_email_unique
      ON login_identities (email)
      WHERE provider = 'email' AND email IS NOT NULL
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.#sql`
      CREATE INDEX IF NOT EXISTS sessions_account_active_idx
      ON sessions (account_id, expires_at)
      WHERE revoked_at IS NULL
    `;
    await this.#getDummyPasswordHash();
  }

  async ready() {
    try {
      const [row] = await this.#sql<Array<{ ready: number }>>`SELECT 1 AS ready`;
      return row?.ready === 1;
    } catch {
      return false;
    }
  }

  async register(emailInput: string, passwordInput: string): Promise<AuthSessionResult> {
    const email = normalizeEmail(emailInput);
    const password = validatePassword(passwordInput);
    const passwordHash = await this.#passwordHasher.hash(password);
    const accountId = randomUUID();
    const sessionToken = createOpaqueToken();

    try {
      await this.#sql.begin(async (transaction) => {
        await transaction`INSERT INTO accounts (id) VALUES (${accountId})`;
        await transaction`
          INSERT INTO login_identities (
            id, account_id, provider, provider_subject, email, password_hash
          ) VALUES (
            ${randomUUID()}, ${accountId}, ${EMAIL_PROVIDER}, ${email}, ${email}, ${passwordHash}
          )
        `;
        await this.#insertSession(transaction, accountId, sessionToken);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("EMAIL_ALREADY_REGISTERED");
      throw error;
    }

    try {
      await this.#initializeAccount(accountId);
    } catch (error) {
      await this.logout(sessionToken);
      throw error;
    }

    return { account: { id: accountId, email }, sessionToken };
  }

  async login(emailInput: string, password: string): Promise<AuthSessionResult> {
    const email = normalizeEmail(emailInput);
    const [identity] = await this.#sql<Array<{
      accountId: string;
      email: string;
      passwordHash: string;
    }>>`
      SELECT account_id AS "accountId", email, password_hash AS "passwordHash"
      FROM login_identities
      WHERE provider = ${EMAIL_PROVIDER} AND provider_subject = ${email}
      LIMIT 1
    `;
    const encodedHash = identity?.passwordHash ?? await this.#getDummyPasswordHash();
    const valid = await this.#passwordHasher.verify(password, encodedHash);
    if (!identity || !valid) throw new Error("INVALID_CREDENTIALS");

    const sessionToken = createOpaqueToken();
    await this.#insertSession(this.#sql, identity.accountId, sessionToken);
    try {
      await this.#initializeAccount(identity.accountId);
    } catch (error) {
      await this.logout(sessionToken);
      throw error;
    }
    return {
      account: { id: identity.accountId, email: identity.email },
      sessionToken,
    };
  }

  async refresh(sessionToken: string | undefined): Promise<AuthSessionResult> {
    if (!sessionToken) throw new Error("AUTH_REQUIRED");
    const nextToken = createOpaqueToken();
    const result = await this.#sql.begin(async (transaction) => {
      const [session] = await transaction<Array<AccountRow & { sessionId: string }>>`
        SELECT session.id AS "sessionId", account.id, identity.email
        FROM sessions AS session
        JOIN accounts AS account ON account.id = session.account_id
        JOIN login_identities AS identity
          ON identity.account_id = account.id AND identity.provider = ${EMAIL_PROVIDER}
        WHERE session.token_digest = ${hashOpaqueToken(sessionToken)}
          AND session.revoked_at IS NULL
          AND session.expires_at > now()
        FOR UPDATE OF session
      `;
      if (!session) throw new Error("AUTH_REQUIRED");
      await transaction`
        UPDATE sessions SET revoked_at = now()
        WHERE id = ${session.sessionId} AND revoked_at IS NULL
      `;
      await this.#insertSession(transaction, session.id, nextToken);
      return { account: { id: session.id, email: session.email }, sessionToken: nextToken };
    });
    return result;
  }

  async logout(sessionToken: string | undefined) {
    if (!sessionToken) return;
    await this.#sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE token_digest = ${hashOpaqueToken(sessionToken)}
    `;
  }

  async getAccount(sessionToken: string | undefined): Promise<AccountRow | null> {
    if (!sessionToken) return null;
    const [account] = await this.#sql<AccountRow[]>`
      SELECT account.id, identity.email
      FROM sessions AS session
      JOIN accounts AS account ON account.id = session.account_id
      JOIN login_identities AS identity
        ON identity.account_id = account.id AND identity.provider = ${EMAIL_PROVIDER}
      WHERE session.token_digest = ${hashOpaqueToken(sessionToken)}
        AND session.revoked_at IS NULL
        AND session.expires_at > now()
      LIMIT 1
    `;
    return account ?? null;
  }

  isProductionEnvironment() {
    return this.#appEnv === "production";
  }

  isDevelopmentEnvironment() {
    return this.#appEnv === "development";
  }

  async close() {
    await this.#sql.end();
  }

  async #insertSession(sql: Sql | TransactionSql, accountId: string, token: string) {
    await sql`
      INSERT INTO sessions (id, account_id, token_digest, expires_at)
      VALUES (
        ${randomUUID()},
        ${accountId},
        ${hashOpaqueToken(token)},
        ${new Date(Date.now() + SESSION_TTL_SECONDS * 1_000)}
      )
    `;
  }

  async #getDummyPasswordHash() {
    this.#dummyPasswordHashPromise ??= this.#passwordHasher.hash(DUMMY_PASSWORD);
    return this.#dummyPasswordHashPromise;
  }

  async #initializeAccount(accountId: string) {
    if (this.#appEnv !== "development" || !this.#accountInitializer) return;
    await this.#accountInitializer(accountId);
  }
}

export async function createAuthRuntime(options: AuthRuntimeOptions) {
  const appEnv = options.appEnv ?? process.env.APP_ENV ?? "development";
  const passwordHasher = options.passwordHasher ?? createArgon2idPasswordHasher();
  const sql = postgres(options.databaseUrl, { max: 4 });
  const runtime = new AuthRuntime(sql, {
    appEnv,
    passwordHasher,
    accountInitializer: options.accountInitializer,
  });
  await runtime.initialize();
  return runtime;
}
