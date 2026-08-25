import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import {
  createArgon2idPasswordHasher,
  createAuthRuntime,
  createTestPasswordHasher,
  type AuthRuntime,
} from "./auth-runtime";
import { createLibraryRuntime, type LibraryRuntime } from "./library-runtime";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";

describe("M1-F1-A email authentication", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  const authRuntimes: AuthRuntime[] = [];
  const libraries: LibraryRuntime[] = [];
  const databases: Array<{ administration: Sql; schema: string }> = [];
  const objectDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(authRuntimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(libraries.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
      databases.splice(0).map(async ({ administration, schema }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await administration.end();
      }),
    );
  });

  async function isolatedDatabase() {
    const schema = `auth_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schema}"`);
    databases.push({ administration, schema });
    const url = new URL(baseDatabaseUrl);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    return url.toString();
  }

  async function setup() {
    const databaseUrl = await isolatedDatabase();
    const auth = await createAuthRuntime({
      databaseUrl,
      appEnv: "development",
      passwordHasher: createTestPasswordHasher(),
    });
    authRuntimes.push(auth);
    const app = createApp({ readiness: () => auth.ready(), auth });
    apps.push(app);
    return app;
  }

  it("uses Argon2id with the required parameters and verifies the digest", async () => {
    const hasher = createArgon2idPasswordHasher();
    const digest = await hasher.hash("correct horse battery");

    expect(hasher.algorithm).toBe("argon2id");
    expect(digest).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
    await expect(hasher.verify("correct horse battery", digest)).resolves.toBe(true);
    await expect(hasher.verify("incorrect password", digest)).resolves.toBe(false);
  });

  it("extends a legacy identity table before creating email indexes", async () => {
    const databaseUrl = await isolatedDatabase();
    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    await database.administration.unsafe(`
      CREATE TABLE "${database.schema}".accounts (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${database.schema}".login_identities (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES "${database.schema}".accounts(id),
        provider text NOT NULL,
        provider_subject text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject)
      );
    `);

    const auth = await createAuthRuntime({
      databaseUrl,
      appEnv: "development",
      passwordHasher: createTestPasswordHasher(),
    });
    authRuntimes.push(auth);
    const app = createApp({ readiness: () => auth.ready(), auth });
    apps.push(app);

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "legacy@example.com", password: "correct horse battery" },
    });
    expect(registered.statusCode).toBe(201);
  });

  it("registers with an HttpOnly cookie, rejects duplicate email, and does not disclose login identity", async () => {
    const app = await setup();
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "Reader@Example.com", password: "correct horse battery" },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().account.email).toBe("reader@example.com");
    const cookie = registered.headers["set-cookie"] as string;
    expect(cookie).toContain("selfalone_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: " reader@example.com ", password: "another password" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ code: "EMAIL_ALREADY_REGISTERED" });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/login",
      payload: { email: "reader@example.com", password: "wrong password" },
    });
    const missingEmail = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/login",
      payload: { email: "missing@example.com", password: "wrong password" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(missingEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({ code: "INVALID_CREDENTIALS" });
    expect(missingEmail.json()).toEqual({ code: "INVALID_CREDENTIALS" });
  });

  it("refreshes a session, revokes the old cookie on logout, and rejects it afterward", async () => {
    const app = await setup();
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "refresh@example.com", password: "correct horse battery" },
    });
    const firstCookie = registered.headers["set-cookie"] as string;
    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: firstCookie },
    });
    expect(refreshed.statusCode).toBe(200);
    const refreshedCookie = refreshed.headers["set-cookie"] as string;
    expect(refreshedCookie).not.toBe(firstCookie);

    const oldAccount = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { cookie: firstCookie },
    });
    expect(oldAccount.statusCode).toBe(401);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: refreshedCookie },
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(loggedOut.headers["set-cookie"]).toContain("Max-Age=0");

    const rejected = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { cookie: refreshedCookie },
    });
    expect(rejected.statusCode).toBe(401);
  });

  it("isolates library data by authenticated account and ignores a legacy development header", async () => {
    const databaseUrl = await isolatedDatabase();
    const auth = await createAuthRuntime({
      databaseUrl,
      appEnv: "development",
      passwordHasher: createTestPasswordHasher(),
    });
    authRuntimes.push(auth);
    const library = await createLibraryRuntime({
      databaseUrl,
      objectDirectory: `/tmp/selfalone-auth-${randomUUID()}`,
      parseDelayMs: 0,
    });
    libraries.push(library);
    const app = createApp({ readiness: () => Promise.resolve(true), auth, library });
    apps.push(app);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "first@example.com", password: "correct horse battery" },
    });
    const firstCookie = first.headers["set-cookie"] as string;
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/books/import",
      headers: {
        cookie: firstCookie,
        "x-selfalone-account": "attacker-selected-account",
        "content-type": "application/octet-stream",
        "x-file-name": "notes.txt",
      },
      payload: Buffer.from("first account book"),
    });
    expect(imported.statusCode).toBe(202);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "second@example.com", password: "correct horse battery" },
    });
    const secondCookie = second.headers["set-cookie"] as string;
    const secondBooks = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { cookie: secondCookie, "x-selfalone-account": "attacker-selected-account" },
    });
    expect(secondBooks.statusCode).toBe(200);
    expect(secondBooks.json()).toEqual({ books: [] });

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: { "x-selfalone-account": "attacker-selected-account" },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: "AUTH_REQUIRED" });
  });
});
