import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migratePptOutlineSchema, pptOutlineMigrationName } from "./ppt-outline-migration";
import {
  migratePptTemplateSchema,
  pptTemplateMigrationName,
} from "./ppt-template-migration";
import {
  migratePptWorkspaceSchema,
  pptWorkspaceMigrationName,
} from "./ppt-workspace-migration";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("PPT template schema migration", () => {
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

  it("adds template_id idempotently without seeding or rewriting legacy M0 IDs", async () => {
    const sql = await isolatedSchema(databases, "ppt_template_add_column");
    await createDraftSchema(sql, { includeTemplateId: false });
    await migratePptWorkspaceSchema(sql);
    await migratePptOutlineSchema(sql);

    const [missingColumn] = await sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'ppt_drafts'
          AND column_name = 'template_id'
      ) AS exists
    `;
    expect(missingColumn?.exists).toBe(false);

    await migratePptTemplateSchema(sql);
    await migratePptTemplateSchema(sql);

    const [column] = await sql<Array<{ dataType: string; isNullable: string }>>`
      SELECT data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ppt_drafts'
        AND column_name = 'template_id'
    `;
    expect(column).toEqual({ dataType: "text", isNullable: "YES" });

    const markers = await sql<Array<{ name: string }>>`
      SELECT name FROM schema_migrations
      WHERE name IN (
        ${pptWorkspaceMigrationName},
        ${pptOutlineMigrationName},
        ${pptTemplateMigrationName}
      )
      ORDER BY name
    `;
    expect(markers.map((row) => row.name)).toEqual([
      pptWorkspaceMigrationName,
      pptOutlineMigrationName,
      pptTemplateMigrationName,
    ]);

    const [tasks] = await sql<Array<{ exists: boolean }>>`
      SELECT to_regclass('ppt_tasks') IS NOT NULL AS exists
    `;
    expect(tasks?.exists).toBe(false);
    const seedRows = await sql<Array<{ id: string }>>`SELECT id FROM ppt_drafts`;
    expect(seedRows.map((row) => row.id)).toEqual(["draft-legacy"]);
  });

  it("keeps existing template_id values including legacy M0 IDs", async () => {
    const sql = await isolatedSchema(databases, "ppt_template_keep_legacy");
    await createDraftSchema(sql, { includeTemplateId: true });
    await sql`
      INSERT INTO ppt_drafts (
        id, account_id, conversation_id, stage, version, requirements, outline, template_id
      ) VALUES
        ('draft-legacy', 'account-a', 'conversation-a', 'template', 3, '', '[]'::jsonb, 'qingci-study'),
        ('draft-modern', 'account-a', 'conversation-a', 'template', 3, '', '[]'::jsonb, 'celadon-reading')
    `;
    await migratePptWorkspaceSchema(sql);
    await migratePptTemplateSchema(sql);
    await migratePptTemplateSchema(sql);

    const rows = await sql<Array<{ id: string; templateId: string | null }>>`
      SELECT id, template_id AS "templateId"
      FROM ppt_drafts
      ORDER BY id
    `;
    expect(rows).toEqual([
      { id: "draft-legacy", templateId: "qingci-study" },
      { id: "draft-modern", templateId: "celadon-reading" },
    ]);
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

async function createDraftSchema(sql: Sql, options: { includeTemplateId: boolean }) {
  await sql`CREATE TABLE accounts (id text PRIMARY KEY)`;
  await sql`
    CREATE TABLE books (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
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
  await sql.unsafe(`
    CREATE TABLE ppt_drafts (
      id text PRIMARY KEY,
      account_id text NOT NULL REFERENCES accounts(id),
      conversation_id text NOT NULL,
      stage text NOT NULL,
      version integer NOT NULL,
      requirements text NOT NULL DEFAULT '',
      outline jsonb NOT NULL DEFAULT '[]'::jsonb
      ${options.includeTemplateId ? ", template_id text" : ""},
      UNIQUE (account_id, id),
      FOREIGN KEY (account_id, conversation_id)
        REFERENCES conversations(account_id, id)
    )
  `);
  await sql`INSERT INTO accounts (id) VALUES ('account-a')`;
  await sql`
    INSERT INTO conversations (id, account_id)
    VALUES ('conversation-a', 'account-a')
  `;
  if (!options.includeTemplateId) {
    await sql`
      INSERT INTO ppt_drafts (
        id, account_id, conversation_id, stage, version, requirements, outline
      ) VALUES (
        'draft-legacy', 'account-a', 'conversation-a', 'requirements', 1, '', '[]'::jsonb
      )
    `;
  }
}
