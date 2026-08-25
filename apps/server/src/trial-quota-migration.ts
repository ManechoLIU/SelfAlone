import type { Sql } from "postgres";

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
    if (applied) return;

    await transaction`
      CREATE TABLE IF NOT EXISTS trial_grants (
        account_id text PRIMARY KEY,
        status text NOT NULL DEFAULT 'claimed' CHECK (status = 'claimed'),
        claimed_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await transaction`
      INSERT INTO schema_migrations (name) VALUES (${trialQuotaMigrationName})
    `;
  });
}
