import type { Sql, TransactionSql } from "postgres";

export const modelConfigMigrationName = "20260826_model_credentials";

/** Creates the account-owned encrypted envelope used by text model settings. */
export async function migrateModelConfigSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS model_credentials (
        account_id text PRIMARY KEY,
        provider text,
        ciphertext bytea NOT NULL,
        nonce bytea NOT NULL,
        auth_tag bytea NOT NULL,
        key_version text NOT NULL,
        key_hint text,
        workspace_id text,
        catalog_version text NOT NULL,
        verified_at timestamptz,
        status text NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT model_credentials_provider_check
          CHECK (provider IS NULL OR provider IN ('deepseek', 'kimi', 'glm', 'qwen')),
        CONSTRAINT model_credentials_status_check
          CHECK (status IN ('verified', 'revoked'))
      )
    `;
    await ensureModelCredentialColumns(transaction);
    await ensureModelCredentialOwnerConstraint(transaction);
    await transaction`
      CREATE INDEX IF NOT EXISTS model_credentials_status_idx
      ON model_credentials (account_id, status)
    `;
  });
}

async function ensureModelCredentialColumns(sql: TransactionSql) {
  // Keep restarts safe for an early local candidate that created the table
  // without the migration. These columns never contain the plaintext key.
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS provider text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS ciphertext bytea`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS nonce bytea`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS auth_tag bytea`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS key_version text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS key_hint text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS workspace_id text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS catalog_version text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS verified_at timestamptz`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS status text`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS revision bigint`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS created_at timestamptz`;
  await sql`ALTER TABLE model_credentials ADD COLUMN IF NOT EXISTS updated_at timestamptz`;
}

async function ensureModelCredentialOwnerConstraint(sql: TransactionSql) {
  await sql.unsafe(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'model_credentials'::regclass
          AND conname = 'model_credentials_account_id_fkey'
      ) THEN
        ALTER TABLE model_credentials
          ADD CONSTRAINT model_credentials_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
      END IF;
    END
    $migration$;
  `);
}
