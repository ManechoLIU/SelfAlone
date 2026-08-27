import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  maskTextModelApiKey,
  normalizeTextModelCredentialInput,
  TEXT_MODEL_CATALOG_VERSION,
  type NormalizedTextModelCredentialInput,
  type TextModelAdapter,
  type TextModelCredentialInput,
  TextModelConfigurationError,
} from "@selfalone/domain";
import type { TextModelCredentialResponse } from "@selfalone/contracts";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { migrateModelConfigSchema } from "./model-config-migration";

export const MODEL_CREDENTIALS_ENCRYPTION_KEY_ENV = "MODEL_CREDENTIALS_ENCRYPTION_KEY";
export const MODEL_ENCRYPTION_KEY_VERSION = "v1";
export const MODEL_CREDENTIAL_NOT_CONFIGURED = "MODEL_CREDENTIAL_NOT_CONFIGURED" as const;
export const MODEL_CREDENTIAL_UNAVAILABLE = "MODEL_CREDENTIAL_UNAVAILABLE" as const;

export type VerifiedTextModelCredential = {
  readonly provider: "deepseek";
  readonly apiKey: string;
  readonly workspaceId?: string;
};

export type ModelConfigRuntimeOptions = {
  databaseUrl: string;
  appEnv?: string;
  /** A 32-byte Buffer or 64-character hexadecimal deployment key. */
  encryptionKey?: string | Buffer;
  /** Explicit provider seam. Missing provider wiring fails closed. */
  validator?: TextModelAdapter;
};

type RuntimeConstructorOptions = {
  encryptionKey: Buffer;
  validator: TextModelAdapter;
};

type ModelCredentialRow = {
  provider: string | null;
  keyHint: string | null;
  workspaceId: string | null;
  catalogVersion: string;
  verifiedAt: Date | null;
  status: "verified" | "revoked";
};

type ModelCredentialSecretRow = {
  provider: string | null;
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  authTag: Buffer | null;
  keyVersion: string | null;
  workspaceId: string | null;
  status: "verified" | "revoked";
};

export function parseModelEncryptionKey(value: string | Buffer | undefined, _appEnv = "production") {
  if (value === undefined) {
    throw new TextModelConfigurationError("MODEL_ENCRYPTION_KEY_REQUIRED");
  }
  if (Buffer.isBuffer(value)) {
    if (value.byteLength === 32) return Buffer.from(value);
    throw new TextModelConfigurationError("MODEL_ENCRYPTION_KEY_REQUIRED");
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  throw new TextModelConfigurationError("MODEL_ENCRYPTION_KEY_REQUIRED");
}

export class ModelConfigRuntime {
  readonly #sql: Sql;
  readonly #encryptionKey: Buffer;
  readonly #validator: TextModelAdapter;

  constructor(sql: Sql, options: RuntimeConstructorOptions) {
    this.#sql = sql;
    this.#encryptionKey = Buffer.from(options.encryptionKey);
    this.#validator = options.validator;
    if (this.#encryptionKey.byteLength !== 32) {
      throw new TextModelConfigurationError("MODEL_ENCRYPTION_KEY_REQUIRED");
    }
  }

  async initialize() {
    await migrateModelConfigSchema(this.#sql);
  }

  async ready() {
    try {
      const [row] = await this.#sql<Array<{ ready: number }>>`
        SELECT 1 AS ready
        FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'model_credentials'
      `;
      return row?.ready === 1;
    } catch {
      return false;
    }
  }

  async getStatus(accountId: string): Promise<TextModelCredentialResponse> {
    assertAccountId(accountId);
    const [row] = await this.#sql<ModelCredentialRow[]>`
      SELECT provider,
             key_hint AS "keyHint",
             workspace_id AS "workspaceId",
             catalog_version AS "catalogVersion",
             verified_at AS "verifiedAt",
             status
      FROM model_credentials
      WHERE account_id = ${accountId}
      LIMIT 1
    `;
    if (!row || row.status !== "verified" || !row.provider || !row.verifiedAt || !row.keyHint) return null;
    if (!isProvider(row.provider)) return null;
    return {
      status: "verified",
      provider: row.provider,
      maskedApiKey: row.keyHint,
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      verifiedAt: row.verifiedAt.toISOString(),
      catalogVersion: row.catalogVersion,
    };
  }

  /**
   * Resolve one verified account credential for one operation. The decrypted
   * value never leaves this callback boundary and is cleared as soon as the
   * consumer settles.
   */
  async withVerifiedTextModelCredential<T>(
    accountId: string,
    consume: (credential: VerifiedTextModelCredential) => Promise<T>,
  ): Promise<T> {
    assertAccountId(accountId);
    const [row] = await this.#sql<ModelCredentialSecretRow[]>`
     SELECT provider,
            ciphertext,
            nonce,
            auth_tag AS "authTag",
            key_version AS "keyVersion",
            workspace_id AS "workspaceId",
            status
     FROM model_credentials
      WHERE account_id = ${accountId}
     LIMIT 1
    `;
    if (
      !row
      || row.status !== "verified"
      || row.provider !== "deepseek"
      || row.keyVersion !== MODEL_ENCRYPTION_KEY_VERSION
      || !row.ciphertext
      || !row.nonce
      || !row.authTag
      || row.nonce.byteLength !== 12
      || row.authTag.byteLength !== 16
    ) {
      throw new Error(MODEL_CREDENTIAL_NOT_CONFIGURED);
    }

    let plaintext: Buffer | undefined;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#encryptionKey,
        Buffer.from(row.nonce),
      );
      decipher.setAAD(Buffer.from(accountId + ":" + row.keyVersion, "utf8"));
      decipher.setAuthTag(Buffer.from(row.authTag));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final(),
      ]);
      const apiKey = plaintext.toString("utf8");
      if (!apiKey.trim() || apiKey.length > 4_096) {
        throw new Error(MODEL_CREDENTIAL_UNAVAILABLE);
      }
      return await consume({
        provider: "deepseek",
        apiKey,
        ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === MODEL_CREDENTIAL_NOT_CONFIGURED
          || error.message === MODEL_CREDENTIAL_UNAVAILABLE
          || error.message.startsWith("DEEPSEEK_")
        )
      ) {
        throw error;
      }
      throw new Error(MODEL_CREDENTIAL_UNAVAILABLE);
    } finally {
      plaintext?.fill(0);
    }
  }

  /** Validate first, then replace the account's envelope in one transaction. */
  async configure(accountId: string, input: TextModelCredentialInput) {
    assertAccountId(accountId);
    const normalized = normalizeTextModelCredentialInput(input);
    const expectedRevision = await this.#readRevision(accountId);
    await this.#validate(normalized);
    const encrypted = encryptApiKey(normalized.apiKey, this.#encryptionKey, accountId);
    const now = new Date();

    await this.#sql.begin(async (transaction) => {
      const [current] = await transaction<Array<{ revision: string }>>`
        SELECT revision
        FROM model_credentials
        WHERE account_id = ${accountId}
        FOR UPDATE
      `;
      const currentRevision = current?.revision ?? "0";
      if (currentRevision !== expectedRevision) {
        throw new TextModelConfigurationError("STALE_VERSION");
      }
      if (current) {
        const nextRevision = (BigInt(currentRevision) + 1n).toString();
        await updateCredential(transaction, accountId, normalized, encrypted, nextRevision, now);
      } else {
        const inserted = await transaction<Array<{ revision: number }>>`
          INSERT INTO model_credentials (
            account_id, provider, ciphertext, nonce, auth_tag, key_version,
            key_hint, workspace_id, catalog_version, verified_at, status, revision,
            created_at, updated_at
          ) VALUES (
            ${accountId}, ${normalized.provider}, ${encrypted.ciphertext}, ${encrypted.nonce},
            ${encrypted.authTag}, ${MODEL_ENCRYPTION_KEY_VERSION},
            ${maskTextModelApiKey(normalized.apiKey)}, ${normalized.workspaceId ?? null},
            ${TEXT_MODEL_CATALOG_VERSION}, ${now}, 'verified', 1, ${now}, ${now}
          )
          ON CONFLICT (account_id) DO NOTHING
          RETURNING revision
        `;
        if (!inserted[0]) throw new TextModelConfigurationError("STALE_VERSION");
      }
    });
    return this.getStatus(accountId);
  }

  /** Revoke is a tombstone update so an in-flight first save cannot resurrect it. */
  async revoke(accountId: string) {
    assertAccountId(accountId);
    await this.#sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO model_credentials (
          account_id, provider, ciphertext, nonce, auth_tag, key_version,
          key_hint, workspace_id, catalog_version, verified_at, status, revision,
          created_at, updated_at
        ) VALUES (
          ${accountId}, NULL, ${Buffer.alloc(0)}, ${Buffer.alloc(0)}, ${Buffer.alloc(0)},
          ${MODEL_ENCRYPTION_KEY_VERSION}, NULL, NULL, ${TEXT_MODEL_CATALOG_VERSION},
          NULL, 'revoked', 1, now(), now()
        )
        ON CONFLICT (account_id) DO UPDATE
        SET provider = NULL,
            ciphertext = ${Buffer.alloc(0)},
            nonce = ${Buffer.alloc(0)},
            auth_tag = ${Buffer.alloc(0)},
            key_hint = NULL,
            workspace_id = NULL,
            catalog_version = ${TEXT_MODEL_CATALOG_VERSION},
            verified_at = NULL,
            status = 'revoked',
            revision = model_credentials.revision + 1,
            updated_at = now()
      `;
    });
  }

  async close() {
    await this.#sql.end({ timeout: 2 });
  }

  async #readRevision(accountId: string) {
    const [row] = await this.#sql<Array<{ revision: string }>>`
      SELECT revision FROM model_credentials WHERE account_id = ${accountId}
    `;
    return row?.revision ?? "0";
  }

  async #validate(input: NormalizedTextModelCredentialInput) {
    try {
      await this.#validator.validateCredential(input);
    } catch (error) {
      if (
        error instanceof TextModelConfigurationError
        && (
          error.code === "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE"
          || error.code === "MODEL_CREDENTIALS_INVALID_REQUEST"
        )
      ) {
        throw error;
      }
      throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_FAILED");
    }
  }
}

async function updateCredential(
  transaction: TransactionSql,
  accountId: string,
  normalized: NormalizedTextModelCredentialInput,
  encrypted: EncryptedApiKey,
  revision: string,
  now: Date,
) {
  await transaction`
    UPDATE model_credentials
    SET provider = ${normalized.provider},
        ciphertext = ${encrypted.ciphertext},
        nonce = ${encrypted.nonce},
        auth_tag = ${encrypted.authTag},
        key_version = ${MODEL_ENCRYPTION_KEY_VERSION},
        key_hint = ${maskTextModelApiKey(normalized.apiKey)},
        workspace_id = ${normalized.workspaceId ?? null},
        catalog_version = ${TEXT_MODEL_CATALOG_VERSION},
        verified_at = ${now},
        status = 'verified',
        revision = ${revision},
        updated_at = ${now}
    WHERE account_id = ${accountId}
  `;
}

type EncryptedApiKey = { ciphertext: Buffer; nonce: Buffer; authTag: Buffer };

function encryptApiKey(apiKey: string, key: Buffer, accountId: string): EncryptedApiKey {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${accountId}:${MODEL_ENCRYPTION_KEY_VERSION}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function isProvider(value: string): value is "deepseek" | "kimi" | "glm" | "qwen" {
  return value === "deepseek" || value === "kimi" || value === "glm" || value === "qwen";
}

function assertAccountId(accountId: string) {
  if (!accountId.trim()) throw new Error("ACCOUNT_REQUIRED");
}

export async function createModelConfigRuntime(options: ModelConfigRuntimeOptions) {
  const appEnv = options.appEnv ?? process.env.APP_ENV ?? "production";
  const encryptionKey = parseModelEncryptionKey(
    options.encryptionKey ?? process.env[MODEL_CREDENTIALS_ENCRYPTION_KEY_ENV],
    appEnv,
  );
  if (!options.validator) {
    throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE");
  }
  const sql = postgres(options.databaseUrl, { max: 4 });
  try {
    const runtime = new ModelConfigRuntime(sql, { encryptionKey, validator: options.validator });
    await runtime.initialize();
    return runtime;
  } catch (error) {
    await sql.end({ timeout: 2 });
    throw error;
  }
}
