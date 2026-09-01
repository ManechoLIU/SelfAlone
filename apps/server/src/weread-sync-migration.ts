import type { Sql } from "postgres";

export const wereadSyncMigrationName = "20260901_weread_sync_runtime";

export async function migrateWeReadSyncSchema(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`
      CREATE TABLE IF NOT EXISTS weread_sync_runs (
        run_id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        request_id text NOT NULL,
        request_fingerprint text NOT NULL,
        operation text NOT NULL,
        connection_id text NOT NULL,
        account_external_id text NOT NULL,
        book_id text,
        book_external_id text,
        cursor text,
        next_cursor text,
        status text NOT NULL,
        snapshot text NOT NULL,
        retry_count integer NOT NULL DEFAULT 0,
        pause jsonb,
        error jsonb,
        terminal_fingerprint text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        completed_at timestamptz,
        UNIQUE (account_id, request_id),
        CONSTRAINT weread_sync_runs_operation_check
          CHECK (operation IN ('books', 'annotations')),
        CONSTRAINT weread_sync_runs_status_check
          CHECK (status IN ('queued', 'running', 'completed', 'paused', 'failed')),
        CONSTRAINT weread_sync_runs_snapshot_check
          CHECK (snapshot IN ('none', 'fresh', 'last_success')),
        CONSTRAINT weread_sync_runs_retry_check CHECK (retry_count >= 0),
        CONSTRAINT weread_sync_runs_operation_shape_check CHECK (
          (operation = 'books' AND book_id IS NULL AND book_external_id IS NULL)
          OR
          (operation = 'annotations' AND book_id IS NOT NULL AND book_external_id IS NOT NULL)
        ),
        CONSTRAINT weread_sync_runs_terminal_shape_check CHECK (
          (
            status IN ('queued', 'running')
            AND snapshot = 'none'
            AND pause IS NULL
            AND error IS NULL
            AND terminal_fingerprint IS NULL
            AND completed_at IS NULL
          ) OR (
            status = 'completed'
            AND snapshot = 'fresh'
            AND next_cursor IS NULL
            AND pause IS NULL
            AND error IS NULL
            AND terminal_fingerprint IS NOT NULL
            AND completed_at IS NOT NULL
          ) OR (
            status = 'paused'
            AND snapshot = 'last_success'
            AND next_cursor IS NULL
            AND pause IS NOT NULL
            AND error IS NULL
            AND terminal_fingerprint IS NOT NULL
            AND completed_at IS NOT NULL
          ) OR (
            status = 'failed'
            AND snapshot = 'last_success'
            AND next_cursor IS NULL
            AND pause IS NULL
            AND error IS NOT NULL
            AND terminal_fingerprint IS NOT NULL
            AND completed_at IS NOT NULL
          )
        )
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS weread_sync_runs_queue_idx
      ON weread_sync_runs (status, updated_at, created_at)
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS weread_sync_runs_account_idx
      ON weread_sync_runs (account_id, created_at DESC)
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS weread_books (
        account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        book_id text NOT NULL,
        connection_id text NOT NULL,
        account_external_id text NOT NULL,
        external_id text NOT NULL,
        title text NOT NULL,
        author text,
        cover_url text,
        progress_percent integer,
        last_read_at timestamptz,
        visible boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL,
        snapshot_run_id text NOT NULL REFERENCES weread_sync_runs(run_id),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (account_id, book_id),
        UNIQUE (account_id, external_id),
        CONSTRAINT weread_books_progress_check
          CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
        CONSTRAINT weread_books_sort_order_check CHECK (sort_order >= 0)
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS weread_books_visible_idx
      ON weread_books (account_id, visible, sort_order)
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS weread_book_snapshot_state (
        account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        connection_id text NOT NULL,
        account_external_id text NOT NULL,
        cursor text,
        next_cursor text,
        status text NOT NULL,
        pause jsonb,
        error jsonb,
        last_success_run_id text REFERENCES weread_sync_runs(run_id),
        updated_at timestamptz NOT NULL,
        CONSTRAINT weread_book_snapshot_status_check
          CHECK (status IN ('success', 'paused', 'failed')),
        CONSTRAINT weread_book_snapshot_shape_check CHECK (
          (status = 'success' AND pause IS NULL AND error IS NULL)
          OR
          (status = 'paused' AND next_cursor IS NULL AND pause IS NOT NULL AND error IS NULL)
          OR
          (status = 'failed' AND next_cursor IS NULL AND pause IS NULL AND error IS NOT NULL)
        )
      )
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS weread_annotations (
        account_id text NOT NULL,
        book_id text NOT NULL,
        external_id text NOT NULL,
        book_external_id text NOT NULL,
        quote text NOT NULL,
        thought text,
        location text,
        provider_created_at timestamptz NOT NULL,
        provider_updated_at timestamptz NOT NULL,
        visible boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL,
        snapshot_run_id text NOT NULL REFERENCES weread_sync_runs(run_id),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (account_id, book_id, external_id),
        FOREIGN KEY (account_id, book_id)
          REFERENCES weread_books(account_id, book_id) ON DELETE CASCADE,
        CONSTRAINT weread_annotations_sort_order_check CHECK (sort_order >= 0)
      )
    `;
    await transaction`
      CREATE INDEX IF NOT EXISTS weread_annotations_visible_idx
      ON weread_annotations (account_id, book_id, visible, sort_order)
    `;

    await transaction`
      CREATE TABLE IF NOT EXISTS weread_annotation_snapshot_state (
        account_id text NOT NULL,
        book_id text NOT NULL,
        connection_id text NOT NULL,
        account_external_id text NOT NULL,
        book_external_id text NOT NULL,
        status text NOT NULL,
        pause jsonb,
        error jsonb,
        last_success_run_id text REFERENCES weread_sync_runs(run_id),
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (account_id, book_id),
        FOREIGN KEY (account_id, book_id)
          REFERENCES weread_books(account_id, book_id) ON DELETE CASCADE,
        CONSTRAINT weread_annotation_snapshot_status_check
          CHECK (status IN ('success', 'paused', 'failed')),
        CONSTRAINT weread_annotation_snapshot_shape_check CHECK (
          (status = 'success' AND pause IS NULL AND error IS NULL)
          OR
          (status = 'paused' AND pause IS NOT NULL AND error IS NULL)
          OR
          (status = 'failed' AND pause IS NULL AND error IS NOT NULL)
        )
      )
    `;
  });
}
