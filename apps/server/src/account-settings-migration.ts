import type { Sql } from "postgres";

/** Creates the one-time, digest-only email token storage used by settings. */
export async function migrateAccountSettingsSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS email_tokens (
        id text PRIMARY KEY,
        account_id text NOT NULL,
        kind text NOT NULL,
        email text NOT NULL,
        token_digest text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT email_tokens_account_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT email_tokens_kind_check
          CHECK (kind IN ('password_reset', 'email_change'))
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS email_tokens_active_idx
      ON email_tokens (account_id, kind, expires_at)
      WHERE used_at IS NULL
    `;
  });
}
