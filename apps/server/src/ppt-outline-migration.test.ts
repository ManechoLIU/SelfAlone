import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import {
  migratePptOutlineSchema,
  pptOutlineMigrationName,
} from "./ppt-outline-migration";
import {
  migratePptWorkspaceSchema,
  pptWorkspaceMigrationName,
} from "./ppt-workspace-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("PPT outline schema migration", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema, sql }) => {
        await sql.end();
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
  });

  it("applies an independent marker after the M1-F5-A workspace marker already exists", async () => {
    const sql = await isolatedSchema(databases, "ppt_outline_after_a");
    await createLegacySchema(sql);
    await migratePptWorkspaceSchema(sql);

    const [workspaceMarker] = await sql<Array<{ name: string }>>`
      SELECT name FROM schema_migrations WHERE name = ${pptWorkspaceMigrationName}
    `;
    expect(workspaceMarker?.name).toBe(pptWorkspaceMigrationName);
    const [missingOutlineMarker] = await sql<Array<{ name: string }>>`
      SELECT name FROM schema_migrations WHERE name = ${pptOutlineMigrationName}
    `;
    expect(missingOutlineMarker).toBeUndefined();
    const [missingOutlineTable] = await sql<Array<{ exists: boolean }>>`
      SELECT to_regclass('ppt_outline_nodes') IS NOT NULL AS exists
    `;
    expect(missingOutlineTable?.exists).toBe(false);

    await migratePptOutlineSchema(sql);
    await migratePptOutlineSchema(sql);

    const markers = await sql<Array<{ name: string }>>`
      SELECT name FROM schema_migrations
      WHERE name IN (${pptWorkspaceMigrationName}, ${pptOutlineMigrationName})
      ORDER BY name
    `;
    expect(markers.map((row) => row.name)).toEqual([
      pptWorkspaceMigrationName,
      pptOutlineMigrationName,
    ]);

    const [outlineFk] = await sql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'ppt_outline_nodes'::regclass
        AND conname = 'ppt_outline_nodes_draft_fkey'
    `;
    expect(outlineFk?.definition).toContain("FOREIGN KEY (account_id, draft_id)");
    expect(outlineFk?.definition).toContain("REFERENCES ppt_drafts(account_id, id)");
    expect(outlineFk?.definition).toContain("ON DELETE CASCADE");

    const [publicFk] = await sql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'ppt_public_sources'::regclass
        AND conname = 'ppt_public_sources_draft_fkey'
    `;
    expect(publicFk?.definition).toContain("FOREIGN KEY (account_id, draft_id)");
    expect(publicFk?.definition).toContain("ON DELETE CASCADE");
  });

  it("adds draft ownership FKs when leftover outline tables already exist without them", async () => {
    const sql = await isolatedSchema(databases, "ppt_outline_upgrade_fk");
    await createLegacySchema(sql);
    await migratePptWorkspaceSchema(sql);
    await sql`
      CREATE TABLE ppt_outline_nodes (
        account_id text NOT NULL,
        draft_id text NOT NULL,
        node_id text NOT NULL,
        node_order integer NOT NULL CHECK (node_order >= 0),
        level integer NOT NULL CHECK (level BETWEEN 1 AND 3),
        body text NOT NULL,
        PRIMARY KEY (account_id, draft_id, node_id),
        UNIQUE (account_id, draft_id, node_order)
      )
    `;
    await sql`
      CREATE TABLE ppt_public_sources (
        account_id text NOT NULL,
        draft_id text NOT NULL,
        url text NOT NULL,
        title text NOT NULL,
        published_at timestamptz,
        fetched_at timestamptz NOT NULL,
        usage_scope text NOT NULL,
        PRIMARY KEY (account_id, draft_id, url)
      )
    `;

    await migratePptOutlineSchema(sql);

    await expect(sql`
      INSERT INTO ppt_outline_nodes (
        account_id, draft_id, node_id, node_order, level, body
      ) VALUES (
        'account-b', 'draft-legacy', 'page-1', 0, 1, '串号节点'
      )
    `).rejects.toMatchObject({ code: "23503" });
    await expect(sql`
      INSERT INTO ppt_public_sources (
        account_id, draft_id, url, title, fetched_at, usage_scope
      ) VALUES (
        'account-a', 'missing-draft', 'https://example.invalid/a', '丢失草稿',
        '2026-09-06T00:00:00Z', 'outline'
      )
    `).rejects.toMatchObject({ code: "23503" });

    await sql`
      INSERT INTO ppt_outline_nodes (
        account_id, draft_id, node_id, node_order, level, body
      ) VALUES (
        'account-a', 'draft-legacy', 'page-1', 0, 1, '第一章'
      )
    `;
    await sql`
      INSERT INTO ppt_public_sources (
        account_id, draft_id, url, title, fetched_at, usage_scope
      ) VALUES (
        'account-a', 'draft-legacy', 'https://publisher.example.invalid/a',
        '出版社公开目录', '2026-09-06T00:00:00Z', 'outline'
      )
    `;
    await sql`DELETE FROM ppt_drafts WHERE account_id = 'account-a' AND id = 'draft-legacy'`;
    const leftoverNodes = await sql<Array<{ nodeId: string }>>`
      SELECT node_id AS "nodeId" FROM ppt_outline_nodes
    `;
    const leftoverSources = await sql<Array<{ url: string }>>`
      SELECT url FROM ppt_public_sources
    `;
    expect(leftoverNodes).toEqual([]);
    expect(leftoverSources).toEqual([]);
  });
});

async function isolatedSchema(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 1 });
  databases.push({ administration, schema, sql });
  return sql;
}

async function createLegacySchema(sql: Sql) {
  await sql`
    CREATE TABLE accounts (
      id text PRIMARY KEY
    )
  `;
  await sql`
    CREATE TABLE books (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      title text NOT NULL,
      source_label text NOT NULL,
      author text,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE conversations (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      book_id text,
      revision integer NOT NULL DEFAULT 0,
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      deleted boolean NOT NULL DEFAULT false,
      UNIQUE (account_id, id)
    )
  `;
  await sql`
    CREATE TABLE ppt_drafts (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      conversation_id text NOT NULL,
      stage text NOT NULL,
      version integer NOT NULL,
      requirements text NOT NULL DEFAULT '',
      outline jsonb NOT NULL DEFAULT '[]'::jsonb,
      template_id text,
      UNIQUE (account_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await sql`
    INSERT INTO books (id, account_id, title, source_label)
    VALUES ('book-a', 'account-a', '第一本书', '本地')
  `;
  await sql`
    INSERT INTO conversations (id, account_id, book_id)
    VALUES ('conversation-a', 'account-a', 'book-a')
  `;
  await sql`
    INSERT INTO ppt_drafts (
      id, account_id, conversation_id, stage, version, requirements, outline
    ) VALUES (
      'draft-legacy', 'account-a', 'conversation-a', 'requirements', 1, '', '[]'::jsonb
    )
  `;
}
