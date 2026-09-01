import type { Sql } from "postgres";

export const wereadConnectionMigrationName = "20260901_weread_connections";

export async function migrateWeReadConnectionSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS weread_connections (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        connection_id text NOT NULL UNIQUE,
        account_external_id text NOT NULL,
        ciphertext bytea NOT NULL,
        nonce bytea NOT NULL,
        auth_tag bytea NOT NULL,
        key_version text NOT NULL,
        key_hint text,
        status text NOT NULL,
        verified_at timestamptz,
        revision bigint NOT NULL,
        last_request_id text NOT NULL,
        last_request_fingerprint text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT weread_connections_status_check
          CHECK (status IN ('verified', 'paused', 'disconnected')),
        CONSTRAINT weread_connections_revision_check CHECK (revision > 0),
        CONSTRAINT weread_connections_secret_shape_check CHECK (
          (
            status = 'disconnected'
            AND octet_length(ciphertext) = 0
            AND octet_length(nonce) = 0
            AND octet_length(auth_tag) = 0
            AND key_hint IS NULL
            AND verified_at IS NULL
          ) OR (
            status IN ('verified', 'paused')
            AND octet_length(ciphertext) > 0
            AND octet_length(nonce) = 12
            AND octet_length(auth_tag) = 16
            AND key_hint IS NOT NULL
            AND verified_at IS NOT NULL
          )
        )
      )
    `;
    await transaction`
      ALTER TABLE weread_connections
      ADD COLUMN IF NOT EXISTS last_request_fingerprint text
    `;
    await transaction`
      UPDATE weread_connections
      SET last_request_fingerprint = 'legacy:' || account_id || ':' || revision::text
      WHERE last_request_fingerprint IS NULL
    `;
    await transaction`
      ALTER TABLE weread_connections
      ALTER COLUMN last_request_fingerprint SET NOT NULL
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS weread_connections_account_status_idx
      ON weread_connections (account_id, status)
    `;
  });
}
