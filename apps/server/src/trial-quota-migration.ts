import type { Sql, TransactionSql } from "postgres";

export const trialQuotaMigrationName = "20260826_trial_quota";

/** Store one durable claim per account; an absent row is the unclaimed state. */
export async function migrateTrialQuotaSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${trialQuotaMigrationName}))`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const [applied] = await transaction<Array<{ name: string }>>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${trialQuotaMigrationName}
      FOR UPDATE
    `;
    if (applied) {
      await ensureTrialQuotaOwnerConstraint(transaction);
      return;
    }

    await transaction`
      CREATE TABLE IF NOT EXISTS trial_grants (
        account_id text PRIMARY KEY REFERENCES accounts(id),
        status text NOT NULL DEFAULT 'claimed' CHECK (status = 'claimed'),
        claimed_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await ensureTrialQuotaOwnerConstraint(transaction);
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${trialQuotaMigrationName})
    `;
  });
}

async function ensureTrialQuotaOwnerConstraint(sql: TransactionSql) {
  await sql.unsafe(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'trial_grants'::regclass
          AND conname = 'trial_grants_account_id_fkey'
      ) THEN
        ALTER TABLE trial_grants
          ADD CONSTRAINT trial_grants_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id);
      END IF;
    END
    $migration$;
  `);
}
