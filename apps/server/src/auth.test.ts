import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { hashOpaqueToken } from "@selfalone/domain";
import type { AuthAccount } from "@selfalone/contracts";
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

  async function setup(options: {
    wechatMiniappCodeExchange?: (code: string) => Promise<string>;
  } = {}) {
    const databaseUrl = await isolatedDatabase();
    const auth = await createAuthRuntime({
      databaseUrl,
      appEnv: "development",
      passwordHasher: createTestPasswordHasher(),
      ...options,
    } as Parameters<typeof createAuthRuntime>[0]);
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

  it("rejects an empty Mini Program code before invoking the provider exchange seam", async () => {
    let exchangeCalls = 0;
    const app = await setup({
      wechatMiniappCodeExchange: async () => {
        exchangeCalls += 1;
        return "wechat-subject-never-used";
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(exchangeCalls).toBe(0);
  });

  it("keeps provider-only accounts compatible with the shared nullable email contract", () => {
    const account: AuthAccount = { id: "wechat-account", email: null };
    expect(account.email).toBeNull();
  });

  it("fails closed with a stable unavailable response when the Mini Program exchange seam is absent", async () => {
    const app = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "mini-code-no-exchange" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "WECHAT_LOGIN_UNAVAILABLE" });
  });

  it("fails closed with the same unavailable response when the provider exchange fails", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => {
        throw new Error("provider network failure");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "mini-code-provider-failure" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "WECHAT_LOGIN_UNAVAILABLE" });
  });

  it("rejects blank or oversized exchanged subjects without creating account or session rows", async () => {
    let exchangedSubject = "   ";
    const app = await setup({
      wechatMiniappCodeExchange: async () => exchangedSubject,
    });

    for (const subject of ["   ", "x".repeat(513)]) {
      exchangedSubject = subject;
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/miniapp",
        payload: { code: `invalid-subject-${subject.length}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: "WECHAT_LOGIN_UNAVAILABLE" });
    }

    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    const [rows] = await database.administration.unsafe<Array<{
      accounts: number;
      identities: number;
      sessions: number;
    }>>(`
      SELECT
        (SELECT count(*)::int FROM "${database.schema}".accounts) AS accounts,
        (SELECT count(*)::int FROM "${database.schema}".login_identities) AS identities,
        (SELECT count(*)::int FROM "${database.schema}".sessions) AS sessions
    `);
    expect(rows).toEqual({ accounts: 0, identities: 0, sessions: 0 });
  });

  it("normalizes unexpected identity failures to the declared internal error contract", async () => {
    const app = createApp({
      readiness: () => Promise.resolve(true),
      auth: {
        isProductionEnvironment: () => false,
        getAccount: async () => null,
        loginWechatMiniapp: async () => {
          throw new Error("AUTH_IDENTITY_UNAVAILABLE");
        },
      },
    } as never);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "mini-code-identity-error" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: "INTERNAL_ERROR" });
  });

  it("creates an independent account for an unknown Mini Program subject and stores only a session digest", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async (code) => `subject:${code}`,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "mini-code-new" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      account: { id: string; email: string | null };
      sessionToken: string;
      expiresAt: string;
    }>();
    expect(body).toMatchObject({
      account: { id: expect.any(String), email: null },
      sessionToken: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);

    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    const [session] = await database.administration.unsafe<Array<{
      accountId: string;
      digest: string;
      expiresAt: Date;
    }>>(`
      SELECT account_id AS "accountId", token_digest AS digest, expires_at AS "expiresAt"
      FROM "${database.schema}".sessions
    `);
    expect(session).toMatchObject({
      accountId: body.account.id,
      digest: hashOpaqueToken(body.sessionToken),
    });
    expect(session?.digest).not.toContain(body.sessionToken);
    expect(session?.expiresAt.toISOString()).toBe(body.expiresAt);

    const account = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${body.sessionToken}` },
    });
    expect(account.statusCode).toBe(200);
    expect(account.json()).toEqual({ account: body.account });
  });

  it("reuses an existing Mini Program subject while issuing a fresh opaque session", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => "wechat-subject-reused",
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "first-code" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "second-code" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().account).toEqual(first.json().account);
    expect(second.json().sessionToken).not.toBe(first.json().sessionToken);

    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    const [identityCount] = await database.administration.unsafe<Array<{ count: number }>>(`
      SELECT count(*)::int AS count
      FROM "${database.schema}".login_identities
      WHERE provider = 'wechat_miniapp'
    `);
    expect(identityCount?.count).toBe(1);
  });

  it("serializes concurrent logins for one subject without leaving a loser account", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => "wechat-subject-concurrent",
    });

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/miniapp",
        payload: { code: "concurrent-code-1" },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/miniapp",
        payload: { code: "concurrent-code-2" },
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().account).toEqual(second.json().account);
    expect(first.json().sessionToken).not.toBe(second.json().sessionToken);

    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    const [identityCount] = await database.administration.unsafe<Array<{ count: number }>>(`
      SELECT count(*)::int AS count
      FROM "${database.schema}".login_identities
      WHERE provider = 'wechat_miniapp'
    `);
    const [accountCount] = await database.administration.unsafe<Array<{ count: number }>>(`
      SELECT count(*)::int AS count
      FROM "${database.schema}".accounts
    `);
    const [sessionCount] = await database.administration.unsafe<Array<{ count: number }>>(`
      SELECT count(*)::int AS count
      FROM "${database.schema}".sessions
      WHERE account_id = '${first.json().account.id}'
        AND revoked_at IS NULL
        AND expires_at > now()
    `);
    expect(identityCount?.count).toBe(1);
    expect(accountCount?.count).toBe(1);
    expect(sessionCount?.count).toBe(2);

    const firstAccount = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${first.json().sessionToken as string}` },
    });
    const secondAccount = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${second.json().sessionToken as string}` },
    });
    expect(firstAccount.statusCode).toBe(200);
    expect(secondAccount.statusCode).toBe(200);
  });

  it("authenticates business routes with Bearer sessions and ignores a forged owner header", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => "wechat-subject-owner",
    });
    const calls: string[] = [];
    const businessApp = createApp({
      readiness: () => Promise.resolve(true),
      auth: authRuntimes.at(-1)!,
      library: {
        async listBooks(accountId: string) {
          calls.push(accountId);
          return [];
        },
      },
    } as never);
    apps.push(businessApp);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "owner-code" },
    });
    const token = login.json().sessionToken as string;
    const books = await businessApp.inject({
      method: "GET",
      url: "/api/v1/books",
      headers: {
        authorization: `Bearer ${token}`,
        "x-selfalone-account": "attacker-selected-account",
      },
    });

    expect(books.statusCode).toBe(200);
    expect(calls).toEqual([login.json().account.id]);
  });

  it("rejects invalid, expired, and revoked Bearer sessions", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => "wechat-subject-revocation",
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "revocation-code" },
    });
    const token = login.json().sessionToken as string;

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: "Bearer forged-token" },
    });
    expect(invalid.statusCode).toBe(401);

    const database = databases.at(-1);
    if (!database) throw new Error("TEST_DATABASE_NOT_READY");
    await database.administration.unsafe(`
      UPDATE "${database.schema}".sessions
      SET expires_at = now() - interval '1 minute'
      WHERE token_digest = '${hashOpaqueToken(token)}'
    `);
    const expired = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(expired.statusCode).toBe(401);

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "revocation-code-2" },
    });
    const secondToken = secondLogin.json().sessionToken as string;
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(logout.statusCode).toBe(204);
    const revoked = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("retains Web cookie auth and rejects an ambiguous cookie-plus-Bearer request", async () => {
    const app = await setup({
      wechatMiniappCodeExchange: async () => "wechat-subject-cookie",
    });
    const email = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email: "cookie-regression@example.com", password: "correct horse battery" },
    });
    const cookie = email.headers["set-cookie"] as string;
    const cookieAccount = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: { cookie },
    });
    expect(cookieAccount.statusCode).toBe(200);
    expect(cookieAccount.json()).toEqual({
      account: { id: email.json().account.id, email: "cookie-regression@example.com" },
    });

    const mini = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/miniapp",
      payload: { code: "cookie-mini-code" },
    });
    const ambiguous = await app.inject({
      method: "GET",
      url: "/api/v1/account",
      headers: {
        cookie,
        authorization: `Bearer ${mini.json().sessionToken as string}`,
      },
    });
    expect(ambiguous.statusCode).toBe(400);
    expect(ambiguous.json()).toEqual({ code: "AUTH_AMBIGUOUS" });
  });
});
