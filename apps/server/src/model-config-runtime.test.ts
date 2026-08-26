import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import type { TextModelAdapter, TextModelCredentialInput } from "@selfalone/domain";
import { TextModelConfigurationError } from "@selfalone/domain";
import { createApp } from "./app";
import { createAuthRuntime, createTestPasswordHasher, type AuthRuntime } from "./auth-runtime";
import {
  createModelConfigRuntime,
  parseModelEncryptionKey,
  type ModelConfigRuntime,
} from "./model-config-runtime";

const TEST_MASTER_KEY = Buffer.alloc(32, 7);

describe("account-scoped model credential runtime", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  const auths: AuthRuntime[] = [];
  const runtimes: ModelConfigRuntime[] = [];
  const resources: Array<{ admin: Sql; db: Sql; schema: string }> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await Promise.all(auths.map((auth) => auth.close()));
    await Promise.all(resources.map(async ({ admin, db, schema }) => {
      await db.end();
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }));
    apps.length = 0;
    auths.length = 0;
    runtimes.length = 0;
    resources.length = 0;
  });

  async function database() {
    const base = process.env.DATABASE_URL ?? "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
    const schema = `model_runtime_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(base, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(base);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const db = postgres(url.toString(), { max: 2 });
    resources.push({ admin, db, schema });
    return url.toString();
  }

  async function setup(validator: TextModelAdapter = acceptingValidator()) {
    const databaseUrl = await database();
    const auth = await createAuthRuntime({
      databaseUrl,
      appEnv: "development",
      passwordHasher: createTestPasswordHasher(),
    });
    auths.push(auth);
    const runtime = await createModelConfigRuntime({
      databaseUrl,
      appEnv: "development",
      encryptionKey: TEST_MASTER_KEY,
      validator,
    });
    runtimes.push(runtime);
    const app = createApp({ readiness: async () => true, auth, modelConfig: runtime });
    apps.push(app);
    return { app, databaseUrl, runtime, auth };
  }

  async function register(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/register",
      payload: { email, password: "correct horse battery" },
    });
    expect(response.statusCode).toBe(201);
    return {
      accountId: response.json<{ account: { id: string } }>().account.id,
      cookie: response.headers["set-cookie"] as string,
    };
  }

  function put(app: ReturnType<typeof createApp>, cookie: string, payload: TextModelCredentialInput) {
    return app.inject({
      method: "PUT",
      url: "/api/v1/model-credentials/text",
      headers: { cookie },
      payload,
    });
  }

  it("fails closed when the deployment key or provider validator is not injected", async () => {
    expect(() => parseModelEncryptionKey(undefined, "production"))
      .toThrow("MODEL_ENCRYPTION_KEY_REQUIRED");
    await expect(createModelConfigRuntime({
      databaseUrl: "postgres://unused",
      appEnv: "production",
      encryptionKey: TEST_MASTER_KEY,
    })).rejects.toMatchObject({ code: "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE" });
  });

  it("validates before the atomic write and returns only masked status", async () => {
    let shouldFail = false;
    const validator: TextModelAdapter = {
      async validateCredential(input) {
        if (shouldFail) throw new TextModelConfigurationError("MODEL_CREDENTIAL_VALIDATION_FAILED");
        expect(input.provider).toBe("deepseek");
      },
    };
    const harness = await setup(validator);
    const account = await register(harness.app, "model-runtime@example.com");
    const secret = "deepseek-secret-1234";
    const saved = await put(harness.app, account.cookie, { provider: "deepseek", apiKey: secret });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      status: "verified",
      provider: "deepseek",
      maskedApiKey: "••••••••1234",
    });
    expect(JSON.stringify(saved.json())).not.toContain(secret);
    const [envelope] = await resources[0]!.db<Array<{
      ciphertextBytes: number;
      nonceBytes: number;
      authTagBytes: number;
      keyVersion: string;
      keyHint: string;
    }>>`
      SELECT octet_length(ciphertext) AS "ciphertextBytes",
             octet_length(nonce) AS "nonceBytes",
             octet_length(auth_tag) AS "authTagBytes",
             key_version AS "keyVersion",
             key_hint AS "keyHint"
      FROM model_credentials
      WHERE account_id = ${account.accountId}
    `;
    expect(envelope).toMatchObject({
      nonceBytes: 12,
      authTagBytes: 16,
      keyVersion: "v1",
      keyHint: "••••••••1234",
    });
    expect(envelope?.ciphertextBytes).toBeGreaterThan(0);
    expect(JSON.stringify(envelope)).not.toContain(secret);

    shouldFail = true;
    const failed = await put(harness.app, account.cookie, { provider: "deepseek", apiKey: "replacement-secret" });
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toEqual({ code: "MODEL_CREDENTIAL_VALIDATION_FAILED" });
    const status = await harness.app.inject({
      method: "GET",
      url: "/api/v1/model-credentials/text",
      headers: { cookie: account.cookie },
    });
    expect(status.json()).toMatchObject({ provider: "deepseek", maskedApiKey: "••••••••1234" });
    expect(JSON.stringify(status.json())).not.toContain(secret);
  });

  it("isolates accounts and keeps revoke idempotent", async () => {
    const harness = await setup();
    const first = await register(harness.app, "first-model@example.com");
    const second = await register(harness.app, "second-model@example.com");
    await put(harness.app, first.cookie, { provider: "deepseek", apiKey: "first-secret-1234" });
    const secondStatus = await harness.app.inject({
      method: "GET",
      url: "/api/v1/model-credentials/text",
      headers: { cookie: second.cookie },
    });
    expect(secondStatus.json()).toBeNull();
    expect((await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/model-credentials/text",
      headers: { cookie: first.cookie },
    })).statusCode).toBe(204);
    expect((await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/model-credentials/text",
      headers: { cookie: first.cookie },
    })).statusCode).toBe(204);
    expect((await harness.app.inject({
      method: "GET",
      url: "/api/v1/model-credentials/text",
      headers: { cookie: first.cookie },
    })).json()).toBeNull();
  });

  it("increments a persisted bigint revision numerically when replacing a credential", async () => {
    const harness = await setup();
    const account = await register(harness.app, "revision-model@example.com");
    await put(harness.app, account.cookie, { provider: "deepseek", apiKey: "first-secret-1234" });
    await resources[0]!.db`
      UPDATE model_credentials
      SET revision = 9
      WHERE account_id = ${account.accountId}
    `;

    const replaced = await put(harness.app, account.cookie, {
      provider: "deepseek",
      apiKey: "replacement-secret-5678",
    });
    expect(replaced.statusCode).toBe(200);
    const [row] = await resources[0]!.db<Array<{ revision: string }>>`
      SELECT revision
      FROM model_credentials
      WHERE account_id = ${account.accountId}
    `;
    expect(row?.revision).toBe("10");
  });

  it("preserves prototype-backed account settings methods when adding the model overview", async () => {
    const harness = await setup();
    const account = await register(harness.app, "settings-model@example.com");
    const calls = { email: 0 };
    class ExistingSettings {
      async getOverview(accountId: string) {
        return {
          account: { id: accountId, email: "settings-model@example.com" },
          loginMethods: {
            email: { connected: true as const, label: "settings-model@example.com" },
            wechat: { connected: false, label: null },
          },
        };
      }

      async requestEmailChange(_accountId: string, _currentPassword: string, _newEmail: string) {
        calls.email += 1;
      }

      async confirmEmailChange(_token: string) {}
      async changePassword(_accountId: string, _currentPassword: string, _newPassword: string) {}
      async requestPasswordReset(_email: string) {}
      async confirmPasswordReset(_token: string, _password: string) {}
    }
    const settings = new ExistingSettings();
    const decoratedApp = createApp({
      readiness: async () => true,
      auth: harness.auth,
      accountSettings: settings,
      modelConfig: harness.runtime,
    });
    apps.push(decoratedApp);

    const overview = await decoratedApp.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { cookie: account.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ services: { textModel: { label: "未配置" } } });

    const emailChange = await decoratedApp.inject({
      method: "POST",
      url: "/api/v1/settings/email",
      headers: { cookie: account.cookie },
      payload: { currentPassword: "current", newEmail: "next@example.com" },
    });
    expect(emailChange.statusCode).toBe(202);
    expect(calls.email).toBe(1);
  });
});

function acceptingValidator(): TextModelAdapter {
  return { validateCredential: async () => undefined };
}
