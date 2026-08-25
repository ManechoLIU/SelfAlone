import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { generateDevelopmentPptx } from "@selfalone/presentation-adapter";
import postgres, { type Sql } from "postgres";
import { developmentAccountId, migrateM0AccountOwnership } from "./account-migration";

const seedBookId = "book-development-changan-lychee";
const seedConversationId = "conversation-development-changan-lychee";
const seedDraftId = "draft-development-changan-lychee";

export type OutlineItem = {
  title: string;
  body: string;
};

export type WorkspaceSnapshot = {
  book: { id: string; title: string; sourceLabel: string };
  conversation: { id: string };
  draft: {
    id: string;
    stage: "requirements" | "outline" | "template" | "submitted";
    version: number;
    requirements: string;
    templateId: string | null;
  };
  outline: OutlineItem[];
  task: TaskSnapshot | null;
  staleTask?: TaskSnapshot;
};

export type TaskSnapshot = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string;
  error?: string;
};

type RuntimeOptions = {
  databaseUrl: string;
  artifactDirectory: string;
  progressDelayMs?: number;
  resetDevelopmentData?: boolean;
};

type DraftRow = {
  id: string;
  stage: WorkspaceSnapshot["draft"]["stage"];
  version: number;
  requirements: string;
  outline: OutlineItem[];
  templateId: string | null;
};

type TaskRow = {
  id: string;
  status: TaskSnapshot["status"];
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId: string | null;
  error: string | null;
};

function taskSnapshot(row: TaskRow): TaskSnapshot {
  return {
    id: row.id,
    status: row.status,
    completedPages: row.completedPages,
    totalPages: row.totalPages,
    version: row.version,
    ...(row.artifactId ? { artifactId: row.artifactId } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export class M0Runtime {
  readonly #sql: Sql;
  readonly #artifactDirectory: string;
  readonly #progressDelayMs: number;
  readonly #generationJobs = new Set<Promise<void>>();

  constructor(sql: Sql, artifactDirectory: string, progressDelayMs: number) {
    this.#sql = sql;
    this.#artifactDirectory = artifactDirectory;
    this.#progressDelayMs = progressDelayMs;
  }

  async initialize(resetDevelopmentData: boolean) {
    await mkdir(this.#artifactDirectory, { recursive: true });
    await this.#sql`
      CREATE TABLE IF NOT EXISTS books (
        id text PRIMARY KEY,
        title text NOT NULL,
        source_label text NOT NULL
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id text PRIMARY KEY,
        book_id text NOT NULL REFERENCES books(id)
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS ppt_drafts (
        id text PRIMARY KEY,
        conversation_id text NOT NULL REFERENCES conversations(id),
        stage text NOT NULL,
        version integer NOT NULL,
        requirements text NOT NULL DEFAULT '',
        outline jsonb NOT NULL DEFAULT '[]'::jsonb,
        template_id text
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS ppt_tasks (
        id text PRIMARY KEY,
        draft_id text NOT NULL REFERENCES ppt_drafts(id),
        idempotency_key text NOT NULL UNIQUE,
        status text NOT NULL,
        completed_pages integer NOT NULL,
        total_pages integer NOT NULL,
        version integer NOT NULL,
        artifact_id text,
        error text
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS ppt_pages (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES ppt_tasks(id),
        page_number integer NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        UNIQUE (task_id, page_number)
      )
    `;
    await this.#sql`
      CREATE TABLE IF NOT EXISTS ppt_artifacts (
        id text PRIMARY KEY,
        task_id text NOT NULL UNIQUE REFERENCES ppt_tasks(id),
        file_path text NOT NULL,
        filename text NOT NULL
      )
    `;

    await migrateM0AccountOwnership(this.#sql);

    if (resetDevelopmentData) {
      await this.#sql`
        TRUNCATE ppt_artifacts, ppt_pages, ppt_tasks, ppt_drafts, conversations, books
      `;
    }

    await this.#sql`
      INSERT INTO books (id, account_id, title, source_label)
      VALUES (${seedBookId}, ${developmentAccountId}, ${"长安的荔枝"}, ${"开发种子书"})
      ON CONFLICT (id) DO NOTHING
    `;
    await this.#sql`
      INSERT INTO conversations (id, account_id, book_id)
      VALUES (${seedConversationId}, ${developmentAccountId}, ${seedBookId})
      ON CONFLICT (id) DO NOTHING
    `;
    await this.#sql`
      INSERT INTO ppt_drafts (id, account_id, conversation_id, stage, version)
      VALUES (${seedDraftId}, ${developmentAccountId}, ${seedConversationId}, ${"requirements"}, 1)
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async ready() {
    try {
      const result = await this.#sql`SELECT 1 AS ready`;
      return result[0]?.ready === 1;
    } catch {
      return false;
    }
  }

  async getWorkspace(): Promise<WorkspaceSnapshot> {
    const [book] = await this.#sql<Array<{ id: string; title: string; sourceLabel: string }>>`
      SELECT id, title, source_label AS "sourceLabel"
      FROM books
      WHERE id = ${seedBookId} AND account_id = ${developmentAccountId}
    `;
    const [conversation] = await this.#sql<Array<{ id: string }>>`
      SELECT id FROM conversations
      WHERE id = ${seedConversationId} AND account_id = ${developmentAccountId}
    `;
    const [draft] = await this.#sql<Array<DraftRow>>`
      SELECT id, stage, version, requirements, outline, template_id AS "templateId"
      FROM ppt_drafts
      WHERE id = ${seedDraftId} AND account_id = ${developmentAccountId}
    `;
    const [task] = await this.#sql<Array<TaskRow>>`
      SELECT id, status, completed_pages AS "completedPages", total_pages AS "totalPages",
             version, artifact_id AS "artifactId", error
      FROM ppt_tasks
      WHERE draft_id = ${seedDraftId} AND account_id = ${developmentAccountId}
      ORDER BY version DESC, id DESC
      LIMIT 1
    `;

    if (!book || !conversation || !draft) {
      throw new Error("DEVELOPMENT_SEED_MISSING");
    }

    const currentTask = task ? taskSnapshot(task) : null;
    return {
      book,
      conversation,
      draft: {
        id: draft.id,
        stage: draft.stage,
        version: draft.version,
        requirements: draft.requirements,
        templateId: draft.templateId,
      },
      outline: draft.outline,
      task: draft.stage === "submitted" ? currentTask : null,
      ...(draft.stage !== "submitted" && currentTask ? { staleTask: currentTask } : {}),
    };
  }

  async saveRequirements(draftId: string, expectedVersion: number, requirements: string) {
    const defaultOutline: OutlineItem[] = [
      { title: "千里转运", body: "一颗荔枝如何穿越盛唐" },
      { title: "制度之困", body: "把不可能任务拆成可验证问题" },
      { title: "普通人的选择", body: "在限制中保留善意与担当" },
    ];
    const updated = await this.#sql.begin(async (transaction) => {
      const [draft] = await transaction<Array<DraftRow>>`
        UPDATE ppt_drafts
        SET stage = ${"outline"}, version = version + 1,
            requirements = ${requirements},
            outline = CASE WHEN jsonb_array_length(outline) = 0 THEN ${transaction.json(defaultOutline)} ELSE outline END,
            template_id = NULL
        WHERE id = ${draftId} AND account_id = ${developmentAccountId}
          AND stage IN (${"requirements"}, ${"outline"}, ${"template"}, ${"submitted"})
          AND version = ${expectedVersion}
        RETURNING id, stage, version, requirements, outline, template_id AS "templateId"
      `;
      if (draft) {
        await transaction`
          UPDATE ppt_tasks
          SET status = ${"stopped"}, error = ${"DRAFT_REVISED"}, version = version + 1
          WHERE draft_id = ${draftId} AND account_id = ${developmentAccountId}
            AND status IN (${"queued"}, ${"running"})
        `;
      }
      return draft;
    });
    if (!updated) {
      await this.#throwDraftConflict(draftId, expectedVersion, "requirements");
    }
    return { draft: updated, outline: updated.outline };
  }

  async saveOutline(draftId: string, expectedVersion: number, outline: OutlineItem[]) {
    const updated = await this.#sql.begin(async (transaction) => {
      const [draft] = await transaction<Array<DraftRow>>`
        UPDATE ppt_drafts
        SET stage = ${"template"}, version = version + 1,
            outline = ${transaction.json(outline)}, template_id = NULL
        WHERE id = ${draftId} AND account_id = ${developmentAccountId}
          AND stage IN (${"outline"}, ${"template"}, ${"submitted"})
          AND version = ${expectedVersion}
        RETURNING id, stage, version, requirements, outline, template_id AS "templateId"
      `;
      if (draft) {
        await transaction`
          UPDATE ppt_tasks
          SET status = ${"stopped"}, error = ${"DRAFT_REVISED"}, version = version + 1
          WHERE draft_id = ${draftId} AND account_id = ${developmentAccountId}
            AND status IN (${"queued"}, ${"running"})
        `;
      }
      return draft;
    });
    if (!updated) {
      await this.#throwDraftConflict(draftId, expectedVersion, "outline");
    }
    return updated;
  }

  async createTask(input: {
    draftId: string;
    expectedVersion: number;
    idempotencyKey: string;
    templateId: string;
  }) {
    const [existing] = await this.#sql<Array<TaskRow>>`
      SELECT id, status, completed_pages AS "completedPages", total_pages AS "totalPages",
             version, artifact_id AS "artifactId", error
      FROM ppt_tasks
      WHERE account_id = ${developmentAccountId}
        AND idempotency_key = ${input.idempotencyKey}
    `;
    if (existing) {
      return taskSnapshot(existing);
    }

    const taskId = randomUUID();
    const result = await this.#sql.begin(async (transaction) => {
      const [latestTask] = await transaction<Array<{ status: TaskSnapshot["status"] }>>`
        SELECT status
        FROM ppt_tasks
        WHERE draft_id = ${input.draftId} AND account_id = ${developmentAccountId}
        ORDER BY version DESC, id DESC
        LIMIT 1
      `;
      const [draft] = await transaction<Array<DraftRow>>`
        UPDATE ppt_drafts
        SET stage = ${"submitted"}, version = version + 1, template_id = ${input.templateId}
        WHERE id = ${input.draftId} AND account_id = ${developmentAccountId}
          AND (
            stage = ${"template"}
            OR (stage = ${"submitted"} AND ${latestTask?.status ?? ""} IN (${"failed"}, ${"stopped"}))
          )
          AND version = ${input.expectedVersion}
        RETURNING id, stage, version, requirements, outline, template_id AS "templateId"
      `;
      if (!draft) {
        return null;
      }
      const [nextTaskVersion] = await transaction<Array<{ version: number }>>`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM ppt_tasks
        WHERE draft_id = ${input.draftId} AND account_id = ${developmentAccountId}
      `;
      const [task] = await transaction<Array<TaskRow>>`
        INSERT INTO ppt_tasks (
          id, account_id, draft_id, idempotency_key, status,
          completed_pages, total_pages, version
        ) VALUES (
          ${taskId}, ${developmentAccountId}, ${input.draftId}, ${input.idempotencyKey},
          ${"queued"}, 0, ${draft.outline.length}, ${nextTaskVersion?.version ?? 1}
        )
        RETURNING id, status, completed_pages AS "completedPages", total_pages AS "totalPages",
                  version, artifact_id AS "artifactId", error
      `;
      return task;
    });

    if (!result) {
      return this.#throwDraftConflict(input.draftId, input.expectedVersion, "template");
    }

    const job = this.#generateTask(taskId).finally(() => this.#generationJobs.delete(job));
    this.#generationJobs.add(job);
    return taskSnapshot(result);
  }

  async getTask(taskId: string) {
    const [task] = await this.#sql<Array<TaskRow>>`
      SELECT id, status, completed_pages AS "completedPages", total_pages AS "totalPages",
             version, artifact_id AS "artifactId", error
      FROM ppt_tasks WHERE id = ${taskId} AND account_id = ${developmentAccountId}
    `;
    if (!task) {
      throw new Error("TASK_NOT_FOUND");
    }
    return taskSnapshot(task);
  }

  async stopTask(taskId: string, expectedVersion: number) {
    const [task] = await this.#sql<Array<TaskRow>>`
      UPDATE ppt_tasks
      SET status = ${"stopped"}, version = version + 1
      WHERE id = ${taskId} AND account_id = ${developmentAccountId}
        AND version = ${expectedVersion}
        AND status IN (${"queued"}, ${"running"})
      RETURNING id, status, completed_pages AS "completedPages", total_pages AS "totalPages",
                version, artifact_id AS "artifactId", error
    `;
    if (!task) {
      const current = await this.getTask(taskId);
      if (current.version !== expectedVersion) {
        throw new Error("STALE_VERSION");
      }
      return current;
    }
    return taskSnapshot(task);
  }

  async getArtifact(artifactId: string) {
    const [artifact] = await this.#sql<
      Array<{ filePath: string; filename: string }>
    >`
      SELECT file_path AS "filePath", filename
      FROM ppt_artifacts
      WHERE id = ${artifactId} AND account_id = ${developmentAccountId}
    `;
    if (!artifact) {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
    return artifact;
  }

  async close() {
    await Promise.allSettled(this.#generationJobs);
    await this.#sql.end({ timeout: 2 });
  }

  async #generateTask(taskId: string) {
    try {
      await this.#sql`
        UPDATE ppt_tasks SET status = ${"running"}, version = version + 1
        WHERE id = ${taskId} AND account_id = ${developmentAccountId}
          AND status = ${"queued"}
      `;
      const [draft] = await this.#sql<Array<DraftRow>>`
        SELECT draft.id, draft.stage, draft.version, draft.requirements, draft.outline,
               draft.template_id AS "templateId"
        FROM ppt_drafts AS draft
        JOIN ppt_tasks AS task
          ON task.draft_id = draft.id AND task.account_id = draft.account_id
        WHERE task.id = ${taskId} AND task.account_id = ${developmentAccountId}
      `;
      if (!draft) {
        throw new Error("DRAFT_NOT_FOUND");
      }

      for (const [index, page] of draft.outline.entries()) {
        if (this.#progressDelayMs > 0) {
          await delay(this.#progressDelayMs);
        }
        const current = await this.getTask(taskId);
        if (current.status === "stopped") {
          return;
        }
        await this.#sql.begin(async (transaction) => {
          await transaction`
            INSERT INTO ppt_pages (id, account_id, task_id, page_number, title, body)
            VALUES (
              ${randomUUID()}, ${developmentAccountId}, ${taskId}, ${index + 1},
              ${page.title}, ${page.body}
            )
            ON CONFLICT (task_id, page_number) DO UPDATE
            SET title = EXCLUDED.title, body = EXCLUDED.body
          `;
          await transaction`
            UPDATE ppt_tasks
            SET completed_pages = ${index + 1}, version = version + 1
            WHERE id = ${taskId} AND account_id = ${developmentAccountId}
              AND status = ${"running"}
          `;
        });
      }

      const current = await this.getTask(taskId);
      if (current.status === "stopped") {
        return;
      }
      const [book] = await this.#sql<Array<{ title: string }>>`
        SELECT book.title
        FROM books AS book
        JOIN conversations AS conversation
          ON conversation.book_id = book.id AND conversation.account_id = book.account_id
        JOIN ppt_drafts AS draft
          ON draft.conversation_id = conversation.id
          AND draft.account_id = conversation.account_id
        JOIN ppt_tasks AS task
          ON task.draft_id = draft.id AND task.account_id = draft.account_id
        WHERE task.id = ${taskId} AND task.account_id = ${developmentAccountId}
      `;
      const artifactId = randomUUID();
      const filename = "selfalone-development.pptx";
      const filePath = resolve(join(this.#artifactDirectory, `${artifactId}.pptx`));
      await generateDevelopmentPptx(
        { title: `《${book?.title ?? "开发种子书"}》读书分享`, pages: draft.outline },
        filePath,
      );
      await this.#sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO ppt_artifacts (id, account_id, task_id, file_path, filename)
          VALUES (
            ${artifactId}, ${developmentAccountId}, ${taskId}, ${filePath}, ${filename}
          )
        `;
        await transaction`
          UPDATE ppt_tasks
          SET status = ${"completed"}, artifact_id = ${artifactId}, version = version + 1
          WHERE id = ${taskId} AND account_id = ${developmentAccountId}
            AND status = ${"running"}
        `;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PRESENTATION_GENERATION_FAILED";
      await this.#sql`
        UPDATE ppt_tasks
        SET status = ${"failed"}, error = ${message}, version = version + 1
        WHERE id = ${taskId} AND account_id = ${developmentAccountId}
          AND status <> ${"stopped"}
      `;
    }
  }

  async #throwDraftConflict(
    draftId: string,
    expectedVersion: number,
    expectedStage: string,
  ): Promise<never> {
    const [draft] = await this.#sql<Array<{ stage: string; version: number }>>`
      SELECT stage, version FROM ppt_drafts
      WHERE id = ${draftId} AND account_id = ${developmentAccountId}
    `;
    if (!draft) {
      throw new Error("DRAFT_NOT_FOUND");
    }
    if (draft.version !== expectedVersion) {
      throw new Error("STALE_VERSION");
    }
    if (draft.stage !== expectedStage) {
      throw new Error("INVALID_STAGE_TRANSITION");
    }
    throw new Error("DRAFT_UPDATE_FAILED");
  }
}

export async function createM0Runtime(options: RuntimeOptions) {
  const sql = postgres(options.databaseUrl, { max: 4 });
  const runtime = new M0Runtime(
    sql,
    resolve(options.artifactDirectory),
    options.progressDelayMs ?? 350,
  );
  await runtime.initialize(options.resetDevelopmentData ?? false);
  return runtime;
}
