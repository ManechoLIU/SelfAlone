CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accounts (id)
VALUES ('account-development-local')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS books (
  id text PRIMARY KEY,
  account_id text,
  title text NOT NULL,
  source_label text NOT NULL DEFAULT '本地'
);

CREATE TABLE IF NOT EXISTS book_files (
  id text PRIMARY KEY,
  account_id text,
  book_id text,
  object_key text NOT NULL DEFAULT '',
  original_filename text NOT NULL DEFAULT '',
  byte_size integer NOT NULL DEFAULT 0,
  sha256 text NOT NULL DEFAULT '',
  parse_result jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_sections (
  account_id text,
  book_id text,
  file_version integer,
  section_id text,
  section_order integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reading_positions (
  account_id text,
  book_id text,
  locator jsonb,
  background text NOT NULL DEFAULT 'light',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE books ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE book_files ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE book_files ADD COLUMN IF NOT EXISTS book_id text;
ALTER TABLE book_sections ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE book_sections ADD COLUMN IF NOT EXISTS book_id text;
ALTER TABLE book_sections ADD COLUMN IF NOT EXISTS file_version integer;
ALTER TABLE book_sections ADD COLUMN IF NOT EXISTS section_id text;
ALTER TABLE reading_positions ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE reading_positions ADD COLUMN IF NOT EXISTS book_id text;

UPDATE books
SET account_id = 'account-development-local'
WHERE account_id IS NULL;

UPDATE book_files AS file
SET account_id = book.account_id
FROM books AS book
WHERE file.book_id = book.id
  AND file.account_id IS NULL;

UPDATE book_sections AS section
SET account_id = book.account_id
FROM books AS book
WHERE section.book_id = book.id
  AND section.account_id IS NULL;

UPDATE reading_positions AS position
SET account_id = book.account_id
FROM books AS book
WHERE position.book_id = book.id
  AND position.account_id IS NULL;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM books AS book
    LEFT JOIN accounts ON accounts.id = book.account_id
    WHERE book.account_id IS NULL OR accounts.id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_MIGRATION_UNBOUND_BOOK';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM book_files AS file
    LEFT JOIN accounts ON accounts.id = file.account_id
    WHERE file.account_id IS NULL OR accounts.id IS NULL OR file.book_id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_MIGRATION_UNBOUND_FILE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM book_files AS file
    LEFT JOIN books AS book
      ON book.account_id = file.account_id AND book.id = file.book_id
    WHERE book.id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_MIGRATION_ORPHAN_FILE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM book_sections AS section
    LEFT JOIN accounts ON accounts.id = section.account_id
    WHERE section.account_id IS NULL
      OR accounts.id IS NULL
      OR section.book_id IS NULL
      OR section.file_version IS NULL
      OR section.section_id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_MIGRATION_UNBOUND_SECTION';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM reading_positions AS position
    LEFT JOIN accounts ON accounts.id = position.account_id
    WHERE position.account_id IS NULL OR accounts.id IS NULL OR position.book_id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_MIGRATION_UNBOUND_POSITION';
  END IF;
END
$migration$;

ALTER TABLE books ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE book_files ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE book_files ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE book_sections ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE book_sections ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE book_sections ALTER COLUMN file_version SET NOT NULL;
ALTER TABLE book_sections ALTER COLUMN section_id SET NOT NULL;
ALTER TABLE reading_positions ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE reading_positions ALTER COLUMN book_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS books_account_id_id_key
  ON books (account_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS book_files_account_book_version_key
  ON book_files (account_id, book_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS book_sections_account_book_file_section_key
  ON book_sections (account_id, book_id, file_version, section_id);
CREATE UNIQUE INDEX IF NOT EXISTS book_sections_account_book_file_order_key
  ON book_sections (account_id, book_id, file_version, section_order);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'books'::regclass AND conname = 'books_account_id_fkey'
  ) THEN
    ALTER TABLE books
      ADD CONSTRAINT books_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES accounts(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'book_files'::regclass AND conname = 'book_files_account_book_fkey'
  ) THEN
    ALTER TABLE book_files
      ADD CONSTRAINT book_files_account_book_fkey
      FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'book_sections'::regclass AND conname = 'book_sections_account_book_fkey'
  ) THEN
    ALTER TABLE book_sections
      ADD CONSTRAINT book_sections_account_book_fkey
      FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'book_sections'::regclass AND conname = 'book_sections_account_book_file_fkey'
  ) THEN
    ALTER TABLE book_sections
      ADD CONSTRAINT book_sections_account_book_file_fkey
      FOREIGN KEY (account_id, book_id, file_version)
      REFERENCES book_files(account_id, book_id, version);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reading_positions'::regclass AND conname = 'reading_positions_account_book_fkey'
  ) THEN
    ALTER TABLE reading_positions
      ADD CONSTRAINT reading_positions_account_book_fkey
      FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id);
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'book_files'::regclass AND conname = 'book_files_version_positive'
  ) THEN
    ALTER TABLE book_files
      ADD CONSTRAINT book_files_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'book_sections'::regclass AND conname = 'book_sections_file_version_positive'
  ) THEN
    ALTER TABLE book_sections
      ADD CONSTRAINT book_sections_file_version_positive CHECK (file_version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reading_positions'::regclass AND conname = 'reading_positions_version_positive'
  ) THEN
    ALTER TABLE reading_positions
      ADD CONSTRAINT reading_positions_version_positive CHECK (version > 0);
  END IF;
END
$migration$;
