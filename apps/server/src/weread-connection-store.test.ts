import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrateWeReadConnectionSchema } from "./weread-connection-migration";
import { WeReadConnectionStore } from "./weread-connection-store";

const baseDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("WeRead encrypted connection store", () => {
  const databases: Array<{ administration: Sql; schema: string; sql: Sql }> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map(async ({ administration, schema, sql }) => {
      await sql.end();
      await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await administration.end();
    }));
  });

  it("encrypts an account-owned connection, rejects stale replacement, and scrubs on disconnect", async () => {
    const setup = await isolatedDatabase(databases, "weread_connection_store");
    const encryptionKey = Buffer.alloc(32, 7);
    const store = new WeReadConnectionStore(setup.sql, {
      encryptionKey,
      now: () => new Date("2026-09-01T10:00:00.000Z"),
      connectionIdFactory: () => "connection-a",
    });

    await expect(store.replace("account-a", {
      apiKey: "wrk-account-a-secret",
      requestId: "request-connect-a",
      expectedRevision: null,
      accountExternalId: "weread-account-a",
    })).resolves.toEqual({
      connectionId: "connection-a",
      accountExternalId: "weread-account-a",
      apiKeyHint: "••••cret",
      status: "verified",
      verifiedAt: "2026-09-01T10:00:00.000Z",
      revision: "1",
    });
    await expect(store.getCurrent("account-b")).resolves.toBeNull();
    await expect(store.resolveConnection("connection-a")).resolves.toMatchObject({
      apiKey: "wrk-account-a-secret",
      accountExternalId: "weread-account-a",
    });

    const [persisted] = await setup.sql<Array<{
      ciphertext: Buffer;
      nonce: Buffer;
      authTag: Buffer;
      keyHint: string;
    }>>`
      SELECT ciphertext, nonce, auth_tag AS "authTag", key_hint AS "keyHint"
      FROM weread_connections WHERE account_id = 'account-a'
    `;
    expect(persisted?.ciphertext.includes(Buffer.from("wrk-account-a-secret"))).toBe(false);
    expect(persisted?.nonce).toHaveLength(12);
    expect(persisted?.authTag).toHaveLength(16);
    expect(persisted?.keyHint).toBe("••••cret");

    await expect(store.replace("account-a", {
      apiKey: "wrk-new-secret",
      requestId: "request-connect-stale",
      expectedRevision: null,
      accountExternalId: "weread-account-new",
    })).rejects.toThrow("STALE_VERSION");

    await expect(store.disconnect("account-a", { expectedRevision: "1" })).resolves.toEqual({
      status: "disconnected",
    });
    await expect(store.getCurrent("account-a")).resolves.toBeNull();
    await expect(store.resolveConnection("connection-a")).rejects.toThrow(
      "WEREAD_CONNECTION_NOT_FOUND",
    );
    const [disconnected] = await setup.sql<Array<{
      ciphertextLength: number;
      nonceLength: number;
      authTagLength: number;
      status: string;
    }>>`
      SELECT octet_length(ciphertext)::int AS "ciphertextLength",
             octet_length(nonce)::int AS "nonceLength",
             octet_length(auth_tag)::int AS "authTagLength", status
      FROM weread_connections WHERE account_id = 'account-a'
    `;
    expect(disconnected).toEqual({
      ciphertextLength: 0,
      nonceLength: 0,
      authTagLength: 0,
      status: "disconnected",
    });
  });

  it("replays one replacement request and serializes distinct concurrent first writes", async () => {
    const setup = await isolatedDatabase(databases, "weread_connection_idempotency");
    let connectionSequence = 0;
    const store = new WeReadConnectionStore(setup.sql, {
      encryptionKey: Buffer.alloc(32, 8),
      now: () => new Date("2026-09-01T11:00:00.000Z"),
      connectionIdFactory: () => `connection-${++connectionSequence}`,
    });
    const input = {
      apiKey: "wrk-idempotent-secret",
      requestId: "request-idempotent",
      expectedRevision: null,
      accountExternalId: "weread-idempotent",
    } as const;

    const first = await store.replace("account-a", input);
    await expect(store.replace("account-a", input)).resolves.toEqual(first);
    expect(connectionSequence).toBe(1);
    await expect(store.replace("account-a", {
      ...input,
      apiKey: "wrk-conflicting-secret",
    })).rejects.toThrow("CONFLICT");

    const results = await Promise.allSettled([
      store.replace("account-b", {
        apiKey: "wrk-concurrent-a",
        requestId: "request-concurrent-a",
        expectedRevision: null,
        accountExternalId: "weread-concurrent-a",
      }),
      store.replace("account-b", {
        apiKey: "wrk-concurrent-b",
        requestId: "request-concurrent-b",
        expectedRevision: null,
        accountExternalId: "weread-concurrent-b",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: "STALE_VERSION" }),
    });
  });
});

async function isolatedDatabase(
  databases: Array<{ administration: Sql; schema: string; sql: Sql }>,
  prefix: string,
) {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const administration = postgres(baseDatabaseUrl, { max: 1 });
  await administration.unsafe(`CREATE SCHEMA "${schema}"`);
  const databaseUrl = new URL(baseDatabaseUrl);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const sql = postgres(databaseUrl.toString(), { max: 4 });
  databases.push({ administration, schema, sql });
  await sql`CREATE TABLE accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`INSERT INTO accounts (id) VALUES ('account-a'), ('account-b')`;
  await migrateWeReadConnectionSchema(sql);
  return { sql };
}
