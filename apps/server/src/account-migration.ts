import type { Sql, TransactionSql } from "postgres";

export const developmentAccountId = "account-development-local";

const ownedTables = [
  "books",
  "conversations",
  "ppt_drafts",
  "ppt_tasks",
  "ppt_pages",
  "ppt_artifacts",
] as const;

type OwnedTable = (typeof ownedTables)[number];

async function ensureConstraint(
  sql: TransactionSql,
  table: OwnedTable,
  name: string,
  definition: string,
) {
  await sql.unsafe(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass AND conname = '${name}'
      ) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition};
      END IF;
    END
    $migration$;
  `);
}

export async function migrateM0AccountOwnership(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await transaction`
      CREATE TABLE IF NOT EXISTS login_identities (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id),
        provider text NOT NULL CHECK (provider IN ('email', 'wechat_web', 'wechat_miniapp')),
        provider_subject text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject)
      )
    `;
    await transaction`
      INSERT INTO accounts (id)
      VALUES (${developmentAccountId})
      ON CONFLICT (id) DO NOTHING
    `;

    for (const table of ownedTables) {
      await transaction.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS account_id text`);
    }

    await transaction`
      UPDATE books
      SET account_id = ${developmentAccountId}
      WHERE account_id IS NULL
    `;
    await transaction.unsafe(`
      UPDATE conversations AS child
      SET account_id = parent.account_id
      FROM books AS parent
      WHERE child.book_id = parent.id AND child.account_id IS NULL
    `);
    await transaction.unsafe(`
      UPDATE ppt_drafts AS child
      SET account_id = parent.account_id
      FROM conversations AS parent
      WHERE child.conversation_id = parent.id AND child.account_id IS NULL
    `);
    await transaction.unsafe(`
      UPDATE ppt_tasks AS child
      SET account_id = parent.account_id
      FROM ppt_drafts AS parent
      WHERE child.draft_id = parent.id AND child.account_id IS NULL
    `);
    await transaction.unsafe(`
      UPDATE ppt_pages AS child
      SET account_id = parent.account_id
      FROM ppt_tasks AS parent
      WHERE child.task_id = parent.id AND child.account_id IS NULL
    `);
    await transaction.unsafe(`
      UPDATE ppt_artifacts AS child
      SET account_id = parent.account_id
      FROM ppt_tasks AS parent
      WHERE child.task_id = parent.id AND child.account_id IS NULL
    `);

    const [unknownOwner] = await transaction.unsafe<Array<{ accountId: string }>>(`
      SELECT DISTINCT existing_owners.account_id AS "accountId"
      FROM (
        SELECT account_id FROM books
        UNION ALL SELECT account_id FROM conversations
        UNION ALL SELECT account_id FROM ppt_drafts
        UNION ALL SELECT account_id FROM ppt_tasks
        UNION ALL SELECT account_id FROM ppt_pages
        UNION ALL SELECT account_id FROM ppt_artifacts
      ) AS existing_owners
      LEFT JOIN accounts ON accounts.id = existing_owners.account_id
      WHERE existing_owners.account_id IS NOT NULL AND accounts.id IS NULL
      LIMIT 1
    `);
    if (unknownOwner) {
      throw new Error("UNKNOWN_ACCOUNT_OWNER");
    }

    await transaction`ALTER TABLE ppt_tasks DROP CONSTRAINT IF EXISTS ppt_tasks_idempotency_key_key`;
    await transaction`
      CREATE UNIQUE INDEX IF NOT EXISTS ppt_tasks_account_idempotency_key_unique
      ON ppt_tasks (account_id, idempotency_key)
    `;

    for (const table of ownedTables) {
      await transaction.unsafe(`ALTER TABLE ${table} ALTER COLUMN account_id SET NOT NULL`);
      await transaction.unsafe(
        `CREATE INDEX IF NOT EXISTS ${table}_account_id_idx ON ${table} (account_id)`,
      );
      await transaction.unsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_account_id_id_key ON ${table} (account_id, id)`,
      );
      await ensureConstraint(
        transaction,
        table,
        `${table}_account_id_fkey`,
        "FOREIGN KEY (account_id) REFERENCES accounts(id)",
      );
    }

    await ensureConstraint(
      transaction,
      "conversations",
      "conversations_account_book_fkey",
      "FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id)",
    );
    await ensureConstraint(
      transaction,
      "ppt_drafts",
      "ppt_drafts_account_conversation_fkey",
      "FOREIGN KEY (account_id, conversation_id) REFERENCES conversations(account_id, id)",
    );
    await ensureConstraint(
      transaction,
      "ppt_tasks",
      "ppt_tasks_account_draft_fkey",
      "FOREIGN KEY (account_id, draft_id) REFERENCES ppt_drafts(account_id, id)",
    );
    await ensureConstraint(
      transaction,
      "ppt_pages",
      "ppt_pages_account_task_fkey",
      "FOREIGN KEY (account_id, task_id) REFERENCES ppt_tasks(account_id, id)",
    );
    await ensureConstraint(
      transaction,
      "ppt_artifacts",
      "ppt_artifacts_account_task_fkey",
      "FOREIGN KEY (account_id, task_id) REFERENCES ppt_tasks(account_id, id)",
    );
  });
}
