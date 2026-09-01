import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type {
  WeReadConnectionDeleteResponse,
  WeReadConnectionProjection,
} from "@selfalone/contracts";
import type { WeReadGatewayConnectionContext } from "./weread-gateway-adapter";
import { WeReadAdapterError } from "./weread-adapter";

const KEY_VERSION = "v1";

export type WeReadConnectionStoreOptions = {
  encryptionKey: Buffer;
  now?: () => Date;
  connectionIdFactory?: () => string;
};

export class WeReadConnectionStore {
  readonly #sql: Sql;
  readonly #encryptionKey: Buffer;
  readonly #now: () => Date;
  readonly #connectionIdFactory: () => string;

  constructor(sql: Sql, options: WeReadConnectionStoreOptions) {
    if (!Buffer.isBuffer(options.encryptionKey) || options.encryptionKey.byteLength !== 32) {
      throw new Error("WEREAD_ENCRYPTION_KEY_REQUIRED");
    }
    this.#sql = sql;
    this.#encryptionKey = Buffer.from(options.encryptionKey);
    this.#now = options.now ?? (() => new Date());
    this.#connectionIdFactory = options.connectionIdFactory ?? randomUUID;
  }

  async replace(accountIdInput: string, input: {
    apiKey: string;
    requestId: string;
    expectedRevision: string | null;
    accountExternalId: string;
  }): Promise<WeReadConnectionProjection> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const apiKey = validApiKey(input.apiKey);
    const requestId = required(input.requestId, "WEREAD_REQUEST_REQUIRED");
    const accountExternalId = required(
      input.accountExternalId,
      "WEREAD_ACCOUNT_EXTERNAL_ID_REQUIRED",
    );
    const expectedRevision = optionalRevision(input.expectedRevision);
    const requestFingerprint = fingerprintReplacement({
      accountId,
      apiKey,
      accountExternalId,
      expectedRevision,
    });
    let encrypted: ReturnType<typeof encrypt> | undefined;

    try {
      return await this.#sql.begin(async (transaction) => {
        await lockAccount(transaction, accountId);
        const current = await findByAccount(transaction, accountId);
        if (current?.lastRequestId === requestId) {
          if (
            current.lastRequestFingerprint === requestFingerprint
            && current.status !== "disconnected"
          ) {
            return toProjection(current);
          }
          throw new Error("CONFLICT");
        }
        const visibleRevision = current && current.status !== "disconnected"
          ? String(current.revision)
          : null;
        if (visibleRevision !== expectedRevision) throw new Error("STALE_VERSION");
        const connectionId = required(
          this.#connectionIdFactory(),
          "WEREAD_CONNECTION_ID_REQUIRED",
        );
        const verifiedAt = validNow(this.#now());
        encrypted = encrypt(apiKey, this.#encryptionKey, accountId);
        const nextRevision = current ? BigInt(current.revision) + 1n : 1n;
        const [stored] = await transaction<ConnectionRow[]>`
          INSERT INTO weread_connections (
            account_id, connection_id, account_external_id,
            ciphertext, nonce, auth_tag, key_version, key_hint,
            status, verified_at, revision, last_request_id,
            last_request_fingerprint, created_at, updated_at
          ) VALUES (
            ${accountId}, ${connectionId}, ${accountExternalId},
            ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.authTag},
            ${KEY_VERSION}, ${maskApiKey(apiKey)}, 'verified', ${verifiedAt},
            ${nextRevision.toString()}, ${requestId}, ${requestFingerprint},
            ${verifiedAt}, ${verifiedAt}
          )
          ON CONFLICT (account_id) DO UPDATE
          SET connection_id = EXCLUDED.connection_id,
              account_external_id = EXCLUDED.account_external_id,
              ciphertext = EXCLUDED.ciphertext,
              nonce = EXCLUDED.nonce,
              auth_tag = EXCLUDED.auth_tag,
              key_version = EXCLUDED.key_version,
              key_hint = EXCLUDED.key_hint,
              status = EXCLUDED.status,
              verified_at = EXCLUDED.verified_at,
              revision = EXCLUDED.revision,
              last_request_id = EXCLUDED.last_request_id,
              last_request_fingerprint = EXCLUDED.last_request_fingerprint,
              updated_at = EXCLUDED.updated_at
          RETURNING connection_id AS "connectionId",
            account_external_id AS "accountExternalId",
            ciphertext, nonce, auth_tag AS "authTag", key_version AS "keyVersion",
            key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision,
            last_request_id AS "lastRequestId",
            last_request_fingerprint AS "lastRequestFingerprint"
        `;
        if (!stored) throw new Error("WEREAD_CONNECTION_NOT_FOUND");
        return toProjection(stored);
      });
    } finally {
      encrypted?.ciphertext.fill(0);
      encrypted?.nonce.fill(0);
      encrypted?.authTag.fill(0);
    }
  }

  async getCurrent(accountIdInput: string): Promise<WeReadConnectionProjection | null> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const [row] = await this.#sql<ConnectionRow[]>`
      SELECT connection_id AS "connectionId",
        account_external_id AS "accountExternalId",
        ciphertext, nonce, auth_tag AS "authTag", key_version AS "keyVersion",
        key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision
      FROM weread_connections
      WHERE account_id = ${accountId} AND status IN ('verified', 'paused')
    `;
    return row ? toProjection(row) : null;
  }

  async resolveConnection(connectionIdInput: string): Promise<WeReadGatewayConnectionContext> {
    const connectionId = required(connectionIdInput, "WEREAD_CONNECTION_NOT_FOUND");
    const [row] = await this.#sql<ConnectionRow[]>`
      SELECT account_id AS "accountId", connection_id AS "connectionId",
        account_external_id AS "accountExternalId",
        ciphertext, nonce, auth_tag AS "authTag", key_version AS "keyVersion",
        key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision
      FROM weread_connections
      WHERE connection_id = ${connectionId} AND status IN ('verified', 'paused')
    `;
    if (!row?.accountId) throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
    let plaintext: Buffer | undefined;
    try {
      plaintext = decrypt(row, this.#encryptionKey, row.accountId);
      const apiKey = plaintext.toString("utf8");
      validApiKey(apiKey);
      return { apiKey, accountExternalId: row.accountExternalId };
    } catch (error) {
      if (error instanceof WeReadAdapterError) throw error;
      throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
    } finally {
      plaintext?.fill(0);
    }
  }

  async disconnect(
    accountIdInput: string,
    input: { expectedRevision: string },
  ): Promise<WeReadConnectionDeleteResponse> {
    const accountId = required(accountIdInput, "ACCOUNT_REQUIRED");
    const expectedRevision = required(input.expectedRevision, "STALE_VERSION");
    await this.#sql.begin(async (transaction) => {
      await lockAccount(transaction, accountId);
      const current = await findByAccount(transaction, accountId);
      if (!current || current.status === "disconnected") {
        throw new WeReadAdapterError("WEREAD_CONNECTION_NOT_FOUND");
      }
      if (String(current.revision) !== expectedRevision) throw new Error("STALE_VERSION");
      await transaction`
        UPDATE weread_connections
        SET ciphertext = ${Buffer.alloc(0)},
            nonce = ${Buffer.alloc(0)},
            auth_tag = ${Buffer.alloc(0)},
            key_hint = NULL,
            status = 'disconnected',
            verified_at = NULL,
            revision = revision + 1,
            updated_at = ${validNow(this.#now())}
        WHERE account_id = ${accountId}
      `;
    });
    return { status: "disconnected" };
  }
}

type ConnectionRow = {
  accountId?: string;
  connectionId: string;
  accountExternalId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
  keyHint: string | null;
  status: "verified" | "paused" | "disconnected";
  verifiedAt: Date | null;
  revision: number | string;
  lastRequestId?: string;
  lastRequestFingerprint?: string;
};

async function lockAccount(transaction: TransactionSql, accountId: string) {
  const [account] = await transaction<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE
  `;
  if (!account) throw new Error("ACCOUNT_REQUIRED");
}

async function findByAccount(transaction: TransactionSql, accountId: string) {
  const [row] = await transaction<ConnectionRow[]>`
    SELECT connection_id AS "connectionId",
      account_external_id AS "accountExternalId",
      ciphertext, nonce, auth_tag AS "authTag", key_version AS "keyVersion",
      key_hint AS "keyHint", status, verified_at AS "verifiedAt", revision,
      last_request_id AS "lastRequestId",
      last_request_fingerprint AS "lastRequestFingerprint"
    FROM weread_connections WHERE account_id = ${accountId} FOR UPDATE
  `;
  return row;
}

function toProjection(row: ConnectionRow): WeReadConnectionProjection {
  if (
    (row.status !== "verified" && row.status !== "paused")
    || !row.keyHint
    || !row.verifiedAt
  ) {
    throw new Error("WEREAD_CONNECTION_NOT_FOUND");
  }
  return {
    connectionId: row.connectionId,
    accountExternalId: row.accountExternalId,
    apiKeyHint: row.keyHint,
    status: row.status,
    verifiedAt: row.verifiedAt.toISOString(),
    revision: String(row.revision),
  };
}

function required(value: string, code: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) throw new Error(code);
  return value.trim();
}

function optionalRevision(value: string | null) {
  return value === null ? null : required(value, "STALE_VERSION");
}

function validApiKey(value: string) {
  const normalized = required(value, "WEREAD_INVALID_API_KEY");
  if (!/^wrk-\S+$/.test(normalized) || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new WeReadAdapterError("WEREAD_INVALID_API_KEY");
  }
  return normalized;
}

function maskApiKey(apiKey: string) {
  return `••••${apiKey.slice(-4)}`;
}

function validNow(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("WEREAD_CLOCK_INVALID");
  return value;
}

function fingerprintReplacement(input: {
  accountId: string;
  apiKey: string;
  accountExternalId: string;
  expectedRevision: string | null;
}) {
  return createHash("sha256")
    .update(JSON.stringify([
      input.accountId,
      input.apiKey,
      input.accountExternalId,
      input.expectedRevision,
    ]))
    .digest("hex");
}

function encrypt(apiKey: string, key: Buffer, accountId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${accountId}:${KEY_VERSION}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decrypt(row: ConnectionRow, key: Buffer, accountId: string) {
  if (row.keyVersion !== KEY_VERSION || row.nonce.length !== 12 || row.authTag.length !== 16) {
    throw new Error("WEREAD_CONNECTION_NOT_FOUND");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, row.nonce);
  decipher.setAAD(Buffer.from(`${accountId}:${row.keyVersion}`, "utf8"));
  decipher.setAuthTag(row.authTag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
}
