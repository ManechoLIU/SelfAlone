CREATE TABLE highlights (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  book_id text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
  file_version integer NOT NULL CHECK (file_version > 0),
  section_id text NOT NULL CHECK (char_length(btrim(section_id)) > 0 AND char_length(section_id) <= 512),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  quote text NOT NULL CHECK (char_length(btrim(quote)) > 0 AND char_length(quote) <= 20000),
  thought text CHECK (thought IS NULL OR char_length(thought) <= 20000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, book_id, idempotency_key),
  FOREIGN KEY (account_id, book_id)
    REFERENCES books(account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, book_id, file_version, section_id)
    REFERENCES book_sections(account_id, book_id, file_version, section_id) ON DELETE RESTRICT
);

CREATE INDEX highlights_book_version_idx
  ON highlights (account_id, book_id, file_version, created_at DESC, id DESC);

CREATE TABLE notes (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  book_id text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (char_length(btrim(idempotency_key)) > 0 AND char_length(idempotency_key) <= 128),
  body text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 100000),
  file_version integer,
  section_id text,
  start_offset integer,
  end_offset integer,
  quote text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, book_id, idempotency_key),
  CHECK (
    (file_version IS NULL AND section_id IS NULL AND start_offset IS NULL AND end_offset IS NULL AND quote IS NULL)
    OR (
      file_version IS NOT NULL AND file_version > 0
      AND section_id IS NOT NULL AND char_length(btrim(section_id)) > 0 AND char_length(section_id) <= 512
      AND start_offset IS NOT NULL AND start_offset >= 0
      AND end_offset IS NOT NULL AND end_offset > start_offset
      AND quote IS NOT NULL AND char_length(btrim(quote)) > 0 AND char_length(quote) <= 20000
    )
  ),
  FOREIGN KEY (account_id, book_id)
    REFERENCES books(account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, book_id, file_version, section_id)
    REFERENCES book_sections(account_id, book_id, file_version, section_id) ON DELETE RESTRICT
);

CREATE INDEX notes_book_version_idx
  ON notes (account_id, book_id, file_version, created_at DESC, id DESC);
