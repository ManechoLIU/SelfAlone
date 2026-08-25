import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { developmentAccountId } from "./account-migration";
import { createApp } from "./app";
import { createM0Runtime, type M0Runtime } from "./m0-runtime";

describe("health endpoints", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it("reports process liveness", async () => {
    const app = createApp({ readiness: async () => true });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "live" });
  });

  it("does not report ready when persistence is unavailable", async () => {
    const app = createApp({ readiness: async () => false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not_ready" });
  });
});

describe("M0 persisted presentation flow", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  const runtimes: M0Runtime[] = [];
  const temporaryDirectories: string[] = [];
  const databaseSchemas: Array<{ administration: Sql; name: string }> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await Promise.all(
      databaseSchemas.map(async ({ administration, name }) => {
        await administration.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        await administration.end();
      }),
    );
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
    apps.length = 0;
    runtimes.length = 0;
    temporaryDirectories.length = 0;
    databaseSchemas.length = 0;
  });

  it("persists the seed-book flow through a downloadable PPTX", async () => {
    const artifactDirectory = await mkdtemp(join(tmpdir(), "selfalone-artifacts-"));
    temporaryDirectories.push(artifactDirectory);
    const baseDatabaseUrl =
      process.env.DATABASE_URL ??
      "postgres://selfalone:selfalone@127.0.0.1:55432/selfalone";
    const schemaName = `selfalone_test_${randomUUID().replaceAll("-", "")}`;
    const administration = postgres(baseDatabaseUrl, { max: 1 });
    await administration.unsafe(`CREATE SCHEMA "${schemaName}"`);
    databaseSchemas.push({ administration, name: schemaName });
    const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-csearch_path=${schemaName}`);
    const databaseUrl = isolatedDatabaseUrl.toString();
    const runtime = await createM0Runtime({
      databaseUrl,
      artifactDirectory,
      progressDelayMs: 0,
      resetDevelopmentData: true,
    });
    runtimes.push(runtime);
    const app = createApp({ readiness: () => runtime.ready(), m0: runtime });
    apps.push(app);

    const initial = await app.inject({ method: "GET", url: "/api/v1/workspace" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      book: { title: "长安的荔枝", sourceLabel: "开发种子书" },
      draft: { stage: "requirements", version: 1 },
    });
    const draftId = initial.json().draft.id as string;

    const outlined = await app.inject({
      method: "PUT",
      url: `/api/v1/ppt-drafts/${draftId}/requirements`,
      payload: {
        expectedVersion: 1,
        requirements: "为读书会生成三页分享，突出普通人的选择。",
      },
    });
    expect(outlined.statusCode).toBe(200);
    expect(outlined.json()).toMatchObject({
      draft: { stage: "outline", version: 2 },
      outline: [
        { title: "千里转运" },
        { title: "制度之困" },
        { title: "普通人的选择" },
      ],
    });

    const templated = await app.inject({
      method: "PUT",
      url: `/api/v1/ppt-drafts/${draftId}/outline`,
      payload: {
        expectedVersion: 2,
        outline: outlined.json().outline,
      },
    });
    expect(templated.statusCode).toBe(200);
    expect(templated.json()).toMatchObject({ stage: "template", version: 3 });

    const submitted = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 3,
        idempotencyKey: "m0-test-request",
        templateId: "qingci-study",
      },
    });
    expect(submitted.statusCode).toBe(202);
    const taskId = submitted.json().id as string;

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 3,
        idempotencyKey: "m0-test-request",
        templateId: "qingci-study",
      },
    });
    expect(repeated.json().id).toBe(taskId);

    let completedTask: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/ppt-tasks/${taskId}`,
      });
      const task = response.json<Record<string, unknown>>();
      if (task.status === "completed") {
        completedTask = task;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(completedTask).toMatchObject({
      status: "completed",
      completedPages: 3,
      totalPages: 3,
    });

    const revisedRequirements = await app.inject({
      method: "PUT",
      url: `/api/v1/ppt-drafts/${draftId}/requirements`,
      payload: {
        expectedVersion: 4,
        requirements: "返回修改范围后仍要保留本地草稿。",
      },
    });
    expect(revisedRequirements.statusCode).toBe(200);
    expect(revisedRequirements.json()).toMatchObject({ draft: { stage: "outline", version: 5 } });

    const revisedWorkspace = await app.inject({ method: "GET", url: "/api/v1/workspace" });
    expect(revisedWorkspace.json()).toMatchObject({
      draft: { stage: "outline", version: 5 },
      task: null,
      staleTask: { status: "completed", completedPages: 3 },
    });

    const revisedOutline = await app.inject({
      method: "PUT",
      url: `/api/v1/ppt-drafts/${draftId}/outline`,
      payload: {
        expectedVersion: 5,
        outline: revisedRequirements.json().outline.map((page: { title: string; body: string }, index: number) => (
          index === 0 ? { ...page, title: "修改后的第一页" } : page
        )),
      },
    });
    expect(revisedOutline.statusCode).toBe(200);
    expect(revisedOutline.json()).toMatchObject({ stage: "template", version: 6 });
    expect(revisedOutline.json().outline[0]).toMatchObject({ title: "修改后的第一页" });

    const templatedAgain = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 6,
        idempotencyKey: "m0-test-retry-request",
        templateId: "paper-notes",
      },
    });
    expect(templatedAgain.statusCode).toBe(202);
    const retriedTaskId = templatedAgain.json().id as string;
    expect(retriedTaskId).not.toBe(taskId);
    let retriedCompletedTask: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await app.inject({ method: "GET", url: `/api/v1/ppt-tasks/${retriedTaskId}` });
      const task = response.json<Record<string, unknown>>();
      if (task.status === "completed") {
        retriedCompletedTask = task;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/workspace" })).json()).toMatchObject({
      draft: { stage: "submitted", version: 7 },
      task: { id: retriedTaskId, status: "completed" },
    });
    expect(retriedCompletedTask).toMatchObject({ status: "completed", artifactId: expect.any(String) });

    const repeatedRetry = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 6,
        idempotencyKey: "m0-test-retry-request",
        templateId: "paper-notes",
      },
    });
    expect(repeatedRetry.statusCode).toBe(202);
    expect(repeatedRetry.json().id).toBe(retriedTaskId);

    const staleRetry = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 6,
        idempotencyKey: "m0-test-stale-retry-request",
        templateId: "paper-notes",
      },
    });
    expect(staleRetry.statusCode).toBe(409);
    expect(staleRetry.json()).toEqual({ code: "STALE_VERSION" });

    await administration.unsafe(`
      UPDATE "${schemaName}".ppt_tasks
      SET status = 'failed', error = 'PRESENTATION_GENERATION_FAILED'
      WHERE id = '${retriedTaskId}'
    `);
    const failedWorkspace = await app.inject({ method: "GET", url: "/api/v1/workspace" });
    expect(failedWorkspace.json()).toMatchObject({
      draft: { stage: "submitted", version: 7 },
      task: { id: retriedTaskId, status: "failed" },
    });

    const failedRetry = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 7,
        idempotencyKey: "m0-test-failed-retry-request",
        templateId: "ink-minimal",
      },
    });
    expect(failedRetry.statusCode).toBe(202);
    const failedRetryTaskId = failedRetry.json().id as string;
    expect(failedRetryTaskId).not.toBe(retriedTaskId);
    let failedRetryCompletedTask: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await app.inject({ method: "GET", url: `/api/v1/ppt-tasks/${failedRetryTaskId}` });
      const task = response.json<Record<string, unknown>>();
      if (task.status === "completed") {
        failedRetryCompletedTask = task;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(failedRetryCompletedTask).toMatchObject({ status: "completed", artifactId: expect.any(String) });

    const repeatedFailedRetry = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 7,
        idempotencyKey: "m0-test-failed-retry-request",
        templateId: "ink-minimal",
      },
    });
    expect(repeatedFailedRetry.statusCode).toBe(202);
    expect(repeatedFailedRetry.json().id).toBe(failedRetryTaskId);

    const staleFailedRetry = await app.inject({
      method: "POST",
      url: "/api/v1/ppt-tasks",
      payload: {
        draftId,
        expectedVersion: 7,
        idempotencyKey: "m0-test-stale-failed-retry-request",
        templateId: "ink-minimal",
      },
    });
    expect(staleFailedRetry.statusCode).toBe(409);
    expect(staleFailedRetry.json()).toEqual({ code: "STALE_VERSION" });

    expect((await app.inject({ method: "GET", url: "/api/v1/workspace" })).json()).toMatchObject({
      draft: { stage: "submitted", version: 8 },
      task: { id: failedRetryTaskId, status: "completed" },
    });

    const artifactId = completedTask?.artifactId as string;
    const download = await app.inject({
      method: "GET",
      url: `/api/v1/ppt-artifacts/${artifactId}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(download.rawPayload.subarray(0, 2).toString()).toBe("PK");

    for (const [table, expectedRows] of [
      ["books", 1],
      ["conversations", 1],
      ["ppt_drafts", 1],
      ["ppt_tasks", 3],
      ["ppt_pages", 9],
      ["ppt_artifacts", 3],
    ] as const) {
      const [ownership] = await administration.unsafe<
        Array<{ rows: number; developmentRows: number }>
      >(`
        SELECT count(*)::int AS rows,
               count(*) FILTER (WHERE account_id = '${developmentAccountId}')::int
                 AS "developmentRows"
        FROM "${schemaName}".${table}
      `);
      expect(ownership).toEqual({ rows: expectedRows, developmentRows: expectedRows });
    }

    await runtime.close();
    runtimes.length = 0;
    const reconnected = await createM0Runtime({
      databaseUrl,
      artifactDirectory,
      progressDelayMs: 0,
    });
    runtimes.push(reconnected);
    const restored = await reconnected.getWorkspace();
    expect(restored).toMatchObject({
      draft: { stage: "submitted", version: 8 },
      task: { id: failedRetryTaskId, status: "completed", artifactId: failedRetryCompletedTask?.artifactId },
    });
  });
});
