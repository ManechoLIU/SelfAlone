# M1-F5-A1 PPT Workspace Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不依赖文本模型的真实账号级 PPT 草稿后端闭环：用户消息已发送后，以当前会话和恰好一本自有书创建草稿，持久化用途、受众、页数范围和补充要求，并允许在大纲生成前更换来源书。

**Architecture:** 保留现有 M0 开发种子运行时作为兼容面，新增独立的 `PptWorkspaceStore`、迁移和路由。新写入必须由认证账号、已持久化的用户消息、账号内会话和账号内书籍共同证明；来源使用关联表表达集合，MVP 服务层强制恰好一本书。固定需求保存只更新 `requirements` 阶段和乐观版本，不自动生成大纲，也不调用文本模型、联网或 PPT 生成适配器。

**Tech Stack:** Node.js >=22、TypeScript strict、Fastify、Zod、PostgreSQL、Vitest、pnpm workspace

**Spec:** `redesign-v2/SPEC.md` 第 5.1、5.2 节

## Global Constraints

- 资料来源在数据模型中是集合；MVP 创建和提交校验强制恰好一本书。
- 书籍详情跳转本身不得创建 PPT 草稿；只有用户消息已经真实发送后才能创建。
- 固定表单只包含用途、受众、页数范围和补充要求；内容范围不进入固定字段。
- 填写固定字段不依赖模型；本计划禁止调用文本模型、联网能力和 PPT 生成适配器。
- 更换来源书时保留通用要求；本计划只覆盖尚未生成大纲的 `requirements` 阶段。
- 所有资源按认证账号隔离；跨账号资源统一按不存在处理，不泄露资源存在性。
- 不修改或回收 `/Users/echoman/.codex/worktrees/f312/SelfAlone` 及其小程序现场。
- 不新增生产依赖，不修改 M0 生成、模板或下载行为。

---

## File Map

- Create `apps/server/src/ppt-workspace-migration.ts`: 为现有 `ppt_drafts` 增加触发消息和固定需求列，创建来源关联表与账号级约束。
- Create `apps/server/src/ppt-workspace-migration.test.ts`: 真实隔离 PostgreSQL 迁移、幂等、约束与旧 M0 行兼容测试。
- Create `apps/server/src/ppt-workspace-store.ts`: 账号级创建、读取、保存固定需求和更换单书来源。
- Create `apps/server/src/ppt-workspace-store.test.ts`: 真实 PostgreSQL 行为、并发版本、幂等和跨账号隔离测试。
- Create `apps/server/src/ppt-workspace-routes.ts`: Fastify 请求校验、账号解析和稳定错误映射。
- Create `apps/server/src/ppt-workspace-routes.test.ts`: HTTP 合同测试。
- Modify `packages/contracts/src/index.ts`: 导出 PPT 工作区快照、固定需求和来源类型。
- Modify `apps/server/src/app.ts`: 增加可选 `pptWorkspace` 组合缝；存在新运行时时由新路由拥有固定需求路径，避免与 M0 重复注册。
- Modify `apps/server/src/index.ts`: 运行迁移、创建 Store、注入应用并在关闭时释放连接。
- Modify `TASK_LEDGER.md`: 只在候选通过、合入主线并完成 current-main 验证后写入最终状态和证据。

---

### Task 1: Account-scoped PPT workspace schema

**Files:**
- Create: `apps/server/src/ppt-workspace-migration.ts`
- Create: `apps/server/src/ppt-workspace-migration.test.ts`

**Interfaces:**
- Consumes: 现有 `accounts`、`books`、`conversations`、`messages`、`ppt_drafts` 表及其 `(account_id, id)` 唯一键。
- Produces: `pptWorkspaceMigrationName`、`migratePptWorkspaceSchema(sql: Sql): Promise<void>`；新增草稿列 `intent_request_id`、`purpose`、`audience`、`page_min`、`page_max`、`additional_requirements`、`created_at`、`updated_at`；新增 `ppt_draft_sources`。

- [ ] **Step 1: Write the failing migration test**

  使用隔离 PostgreSQL schema，先创建 M0 运行时和对话 schema，再调用尚不存在的 `migratePptWorkspaceSchema`。断言：

  - 两次运行迁移均成功；
  - 旧 M0 seed 草稿仍存在且新增可空字段不伪造触发消息；
  - `ppt_draft_sources` 以 `(account_id, draft_id, book_id)` 为主键，`(account_id, draft_id, source_order)` 唯一；
  - 来源同时外键到账号内草稿和账号内书籍；
  - `page_min/page_max` 必须同时为空或同时为正数，且 `page_min <= page_max`；
  - 非空 `intent_request_id` 在同账号、同会话内唯一。

- [ ] **Step 2: Run the migration test and verify RED**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-migration.test.ts`

  Expected: FAIL because `ppt-workspace-migration.ts` does not exist.

- [ ] **Step 3: Implement the migration minimally**

  使用 advisory transaction lock 和 `schema_migrations`；对现有表只做兼容式 `ADD COLUMN IF NOT EXISTS`，不回填触发消息、来源或固定需求。来源表结构固定为：

  ```sql
  CREATE TABLE IF NOT EXISTS ppt_draft_sources (
    account_id text NOT NULL,
    draft_id text NOT NULL,
    book_id text NOT NULL,
    source_order integer NOT NULL CHECK (source_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, draft_id, book_id),
    UNIQUE (account_id, draft_id, source_order),
    FOREIGN KEY (account_id, draft_id) REFERENCES ppt_drafts(account_id, id) ON DELETE CASCADE,
    FOREIGN KEY (account_id, book_id) REFERENCES books(account_id, id) ON DELETE RESTRICT
  );
  ```

  为新列建立组合检查和 partial unique index；迁移记录名为 `20260902_ppt_workspace`。

- [ ] **Step 4: Run the migration test and verify GREEN**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-migration.test.ts`

  Expected: PASS with no warnings.

- [ ] **Step 5: Commit the schema checkpoint**

  ```bash
  git add apps/server/src/ppt-workspace-migration.ts apps/server/src/ppt-workspace-migration.test.ts
  git commit -m "feat(server): add PPT workspace schema"
  ```

### Task 2: Persisted single-source draft and fixed requirements

**Files:**
- Create: `apps/server/src/ppt-workspace-store.ts`
- Create: `apps/server/src/ppt-workspace-store.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `migratePptWorkspaceSchema`; a user message in `messages` identified by `(accountId, conversationId, requestId, role='user')`.
- Produces:

  ```ts
  export type PptFixedRequirements = {
    purpose: string | null;
    audience: string | null;
    pageRange: { min: number; max: number } | null;
    additionalRequirements: string;
  };

  export type PptWorkspaceSnapshot = {
    draft: {
      id: string;
      conversationId: string;
      stage: "requirements";
      version: number;
      requirements: PptFixedRequirements;
    };
    sources: readonly [{
      bookId: string;
      title: string;
      author: string | null;
      sourceLabel: string;
    }];
  };
  ```

  ```ts
  export class PptWorkspaceStore {
    createFromSentIntent(input: {
      accountId: string;
      conversationId: string;
      bookId: string;
      requestId: string;
    }): Promise<{ status: "created" | "reused"; workspace: PptWorkspaceSnapshot }>;
    getWorkspace(accountId: string, draftId: string): Promise<PptWorkspaceSnapshot | null>;
    saveRequirements(input: {
      accountId: string;
      draftId: string;
      expectedVersion: number;
      requirements: {
        purpose: string;
        audience: string;
        pageRange: { min: number; max: number };
        additionalRequirements: string;
      };
    }): Promise<PptWorkspaceSnapshot>;
    replaceSource(input: {
      accountId: string;
      draftId: string;
      expectedVersion: number;
      bookId: string;
    }): Promise<PptWorkspaceSnapshot>;
  }
  ```

- [ ] **Step 1: Write the failing create/read integration tests**

  在真实隔离 PostgreSQL 中插入两个账号、各自会话、已发送用户消息和书籍。断言：

  - 已发送消息可创建 `requirements` 草稿，返回恰好一个来源；
  - 相同 request 重试复用同一草稿；
  - 相同 request 改用另一书返回 `PPT_INTENT_CONFLICT`；
  - 没有已发送用户消息返回 `PPT_INTENT_NOT_SENT`；
  - 跨账号会话、消息、书籍或草稿均返回 `PPT_WORKSPACE_NOT_FOUND`，不泄露存在性。

- [ ] **Step 2: Run the create/read tests and verify RED**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-store.test.ts`

  Expected: FAIL because `PptWorkspaceStore` does not exist.

- [ ] **Step 3: Implement create/read minimally**

  在单个 transaction 中锁定账号内会话、验证已发送用户消息和账号内书籍，处理 request 幂等后插入草稿与 `source_order=0` 的来源。所有读取用 `account_id` 和 `draft_id` 联合过滤；快照若不是恰好一个来源则抛 `PPT_SOURCE_CARDINALITY_INVALID`，不降级为任意第一本书。

- [ ] **Step 4: Run create/read tests and verify GREEN**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-store.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing requirements/version tests**

  断言完整四字段保存后：版本精确 `1 -> 2`，阶段仍为 `requirements`，空白被规范化，补充要求允许空字符串；旧版本写入返回 `PPT_WORKSPACE_STALE`；跨账号写入仍返回 `PPT_WORKSPACE_NOT_FOUND`；保存固定字段不会创建 outline、task 或 artifact 行。

- [ ] **Step 6: Run requirements tests and verify RED**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-store.test.ts`

  Expected: FAIL because `saveRequirements` is absent.

- [ ] **Step 7: Implement requirements persistence minimally**

  只允许 `stage='requirements'`；在 SQL update 中同时检查账号、草稿和 expectedVersion。保存 `purpose`、`audience`、`page_min`、`page_max`、`additional_requirements`，版本加一，不写 legacy `requirements` 文本、不写 outline。

- [ ] **Step 8: Write failing source-replacement tests**

  断言同账号另一书替换后来源仍恰好一条、通用要求原样保留、版本加一；同一本书重试返回同版本快照；旧版本或跨账号书籍失败；非 `requirements` 阶段返回 `PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION`，不修改原来源。

- [ ] **Step 9: Run source tests and verify RED**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-store.test.ts`

  Expected: FAIL because `replaceSource` is absent.

- [ ] **Step 10: Implement source replacement minimally**

  在 transaction 内锁定草稿，检查账号、版本、阶段和目标书；同书直接返回现状，异书删除旧来源后插入 `source_order=0`，更新草稿版本。任何失败均回滚。

- [ ] **Step 11: Run store tests and commit**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-store.test.ts`

  Expected: PASS.

  ```bash
  git add packages/contracts/src/index.ts apps/server/src/ppt-workspace-store.ts apps/server/src/ppt-workspace-store.test.ts
  git commit -m "feat(server): persist PPT workspace requirements"
  ```

### Task 3: Authenticated HTTP contract and application composition

**Files:**
- Create: `apps/server/src/ppt-workspace-routes.ts`
- Create: `apps/server/src/ppt-workspace-routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: Task 2 `PptWorkspaceStore` methods and `resolveAccountOwner`.
- Produces:

  - `POST /api/v1/conversations/:conversationId/ppt-drafts`
  - `GET /api/v1/ppt-drafts/:draftId/workspace`
  - `PUT /api/v1/ppt-drafts/:draftId/requirements`
  - `PUT /api/v1/ppt-drafts/:draftId/source`

- [ ] **Step 1: Write failing route contract tests**

  使用 Fastify 与完整形状的窄 fake runtime，验证账号 ID 被传入，创建返回 `201`、幂等复用返回 `200`、读取和更新返回 `200`。验证请求：所有 ID trim 后非空且不超过 256；`expectedVersion` 为正整数；用途和受众 trim 后 1–120 字符；补充要求最多 2,000 字符；页数为正安全整数且 `min <= max`；body 使用 strict schema 拒绝未知字段。规格未定义自定义页数上限，本包不得擅自新增用户可见上限。

- [ ] **Step 2: Run route tests and verify RED**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-routes.test.ts`

  Expected: FAIL because route registration does not exist.

- [ ] **Step 3: Implement routes and stable error mapping**

  将 `PPT_WORKSPACE_NOT_FOUND` 映射 404，`PPT_WORKSPACE_STALE`、`PPT_INTENT_CONFLICT`、`PPT_SOURCE_CHANGE_REQUIRES_CONFIRMATION` 映射 409，`PPT_INTENT_NOT_SENT` 映射 422，请求校验映射 400，其余返回 500 且不暴露内部信息。

- [ ] **Step 4: Run route tests and verify GREEN**

  Run: `pnpm vitest run apps/server/src/ppt-workspace-routes.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing application composition test**

  在 `pptWorkspace` 与 `m0` 同时注入时，断言应用能启动且 `PUT /api/v1/ppt-drafts/:id/requirements` 只命中新 runtime；M0 的 `/api/v1/workspace`、outline、task、download 兼容路径仍可注册。

- [ ] **Step 6: Run composition test and verify RED**

  Run: `pnpm vitest run apps/server/src/app.test.ts apps/server/src/ppt-workspace-routes.test.ts`

  Expected: FAIL because `createApp` has no `pptWorkspace` seam or because the duplicate route is still registered.

- [ ] **Step 7: Integrate app and production entry point minimally**

  在 `createApp` 中注册新路由；仅当没有 `pptWorkspace` 时才让 M0 注册 legacy requirements route。`index.ts` 在 M0、library、owner、conversation migrations 之后运行 `migratePptWorkspaceSchema`，创建一个 SQL pool 和 `PptWorkspaceStore`，注入应用，并在 shutdown 中关闭 pool。

- [ ] **Step 8: Run focused and server regression tests**

  Run:

  ```bash
  pnpm vitest run apps/server/src/ppt-workspace-migration.test.ts apps/server/src/ppt-workspace-store.test.ts apps/server/src/ppt-workspace-routes.test.ts apps/server/src/app.test.ts
  pnpm vitest run apps/server
  pnpm --filter @selfalone/server typecheck
  pnpm --filter @selfalone/server build
  ```

  Expected: all PASS, no duplicate Fastify route, no warning or leaked database schema.

- [ ] **Step 9: Commit the HTTP checkpoint**

  ```bash
  git add apps/server/src/ppt-workspace-routes.ts apps/server/src/ppt-workspace-routes.test.ts apps/server/src/app.ts apps/server/src/index.ts
  git commit -m "feat(server): expose account-scoped PPT workspaces"
  ```

### Task 4: Candidate verification and controller integration

**Files:**
- Modify after integration: `TASK_LEDGER.md`

**Interfaces:**
- Consumes: exact candidate commit chain from Tasks 1–3.
- Produces: reviewed candidate, current-main evidence, ledger receipt, fast-forward remote revision.

- [ ] **Step 1: Review the actual candidate diff**

  检查范围只包含计划文件；确认没有读取凭证、调用 Provider、修改小程序现场、生成大纲或创建任务；运行 `git diff --check`。

- [ ] **Step 2: Obtain non-author review**

  Reviewer 必须核查：已发送消息门、账号隔离、来源基数、request 幂等、乐观版本、迁移兼容、错误不泄露、M0 路由不冲突。Critical / Important 任一非零则回到对应 TDD 循环。

- [ ] **Step 3: Integrate sequentially into local main**

  在 main 重新核对 HEAD、status、worktree 和台账，按候选提交顺序合入；不得夹带四组受保护视觉候选或 f312 小程序工作树。

- [ ] **Step 4: Verify current main from fresh evidence**

  Run:

  ```bash
  pnpm vitest run apps/server/src/ppt-workspace-migration.test.ts apps/server/src/ppt-workspace-store.test.ts apps/server/src/ppt-workspace-routes.test.ts apps/server/src/app.test.ts
  pnpm vitest run apps/server
  pnpm typecheck
  pnpm build
  pnpm verify:visual-contract
  git diff --check
  ```

  Expected: all PASS on the same current-main HEAD.

- [ ] **Step 5: Close the ledger event and push**

  将 `M1-F5-A1` 更新为 `DONE / BACKEND FOUNDATION`，明确真实边界：已完成后端账号级持久化，不代表 Web/小程序入口、意图模型、大纲、模板或 PPTX 已完成。创建单一台账提交；按持续授权以非强制快进方式推送并回读远端 SHA。

---

## Review rework (non-author FAIL follow-up)

- Production `m0 + pptWorkspace` composition uses a same-path strict dual-shape dispatcher for `PUT /api/v1/ppt-drafts/:id/requirements`: legacy `{expectedVersion, requirements:string}` goes to `m0.saveRequirements`; the four-field workspace body goes to `pptWorkspace.saveRequirements`; mixed or extra fields return 400. Existing global `STALE_VERSION` / `*_NOT_FOUND` mapping is unchanged.
- Create idempotency persists nullable `intent_source_book_id` as the immutable create-request source fingerprint. Reuse compares that fingerprint before validating a new request's book, so the original retry still reuses the current workspace after its original book is deleted. Old M0 rows stay null and are not backfilled. Concurrent same-request creates remain one draft; same request with a different source yields one success and one `PPT_INTENT_CONFLICT`.
- Workspace reads use one `ppt_drafts` / `ppt_draft_sources` / `books` JOIN so a concurrent `replaceSource` cannot return an old version with a new source. Source cardinality still fail-closes unless exactly one `source_order=0` row is present. Create responses reuse `getWorkspace`.
- Route ACCOUNT_REQUIRED / ACCOUNT_FORBIDDEN map to 401 / 403. Page counts may reach PostgreSQL `int` max. Requirements writes, including the legacy shared route shape, cap `expectedVersion` at `PPT_WORKSPACE_INCREMENTABLE_VERSION_MAX`; source replacement accepts the stored maximum only for a same-source no-op and rejects any different-source increment. After `ppt_draft_sources` exists, M0 development reset truncates that table too, without CASCADE onto unrelated tables.

## Self-Review Record

- Spec coverage: 本计划覆盖第 5.1 节“真实发送后创建、当前会话、恰好一本书、多个独立任务”和第 5.2 节“四个固定字段、无需模型、换书保留通用要求”的后端基础；不覆盖需要模型的意图识别、个性化范围追问、大纲、模板、生成和端侧视觉。
- Placeholder scan: 无 TBD、TODO、模糊测试或未定义接口。
- Type consistency: 路由、Store 和 contracts 均使用 `PptWorkspaceSnapshot`、`PptFixedRequirements`、`expectedVersion`、`requestId`、`bookId`；创建、读取、保存和换源接口名称一致。
