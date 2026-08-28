CREATE TABLE note_update_idempotency (
  idempotency_key text NOT NULL
    CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
  account_id text NOT NULL,
  book_id text NOT NULL,
  note_id text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version > 0),
  body text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 100000),
  source_payload jsonb,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, idempotency_key),
  FOREIGN KEY (account_id, book_id)
    REFERENCES books(account_id, id) ON DELETE RESTRICT
);

CREATE INDEX note_update_idempotency_account_note_idx
  ON note_update_idempotency (account_id, book_id, note_id, created_at DESC);
