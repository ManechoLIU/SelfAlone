# SelfAlone MVP Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. If the user explicitly chooses delegated execution, use `superpowers:subagent-driven-development` with only `luna_worker` agents as required by `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面 Web 与微信小程序上交付从登录、书籍导入 / 同步、阅读与笔记，到生成并下载可编辑 PPTX 的同一套邀请制 Beta MVP。

**Architecture:** 使用 TypeScript 单仓和模块化单体后端，PostgreSQL 保存业务事实与任务队列，对象存储保存文件，独立 Worker 执行解析、模型调用和 PPTX 生成。先用桌面 Web 建立真实纵向闭环，再让微信小程序复用稳定 API 和状态机；两端共享契约，不强行共享 UI。

**Tech Stack:** Node.js 24 LTS、pnpm、React + Vite、微信小程序原生 TypeScript、Fastify、Zod、Prisma、PostgreSQL、pg-boss、S3-compatible storage；PPT 优先适配自托管 Presenton，并使用已安装的 Presentations Skill 做模板与 QA，PptxGenJS / Office Kit 仅作窄回退；测试使用 Vitest 与 Playwright。

**Spec:** [`redesign-v2/SPEC.md`](../../../redesign-v2/SPEC.md)、[`redesign-v2/DESIGN.md`](../../../redesign-v2/DESIGN.md)、[`redesign-v2/DESIGN-WEB.md`](../../../redesign-v2/DESIGN-WEB.md)、[`redesign-v2/DESIGN-MINIAPP.md`](../../../redesign-v2/DESIGN-MINIAPP.md)、[`redesign-v2/TECHNICAL.md`](../../../redesign-v2/TECHNICAL.md)、[`redesign-v2/design-reference/README.md`](../../../redesign-v2/design-reference/README.md)

## Global Constraints

- 一级导航固定为 `对话 / 读书 / 设置`，PPT 不成为一级入口。
- MVP 的 PPT 提交恰好绑定一本书；同一会话可先后承载不同书籍的多个 PPT 任务。
- 固定流程为 `范围与需求 / 大纲 / 模板 / 生成`；大纲是连续分层文本，页数只由一级段落数量计算。
- 新账户免费体验按账户累计平台实际调用成本，硬上限为 `¥5`；前台不展示金额、余额、进度或券中心。
- 会话消息最多 `4` 张图片；失败和模型不支持图片时必须保留文字与附件草稿。
- PPT 页面、模板与作品预览都保持真实 `16:9`；没有图片模型时仍须生成可展示的完整视觉成品。
- 桌面 Web 验收视口为 `768 / 1024 / 1200 / 1440px`；微信小程序验收内容宽度为 `360 / 390 / 430px`。
- 触控目标不小于 `44×44px`，键盘焦点可见，状态不只靠颜色，数据区覆盖加载、真实空、筛选空、失败和正常内容。
- 不修改 `v1/`；不从探索稿、文件名或旧会话推断批准；运行时只使用参考索引允许的资产和当前事实源。
- 未获授权不安装生产依赖、不调用付费服务、不上传、发布或推送；凭证不得进入源码、命令参数、日志或测试数据。

---

## 1. 交付策略

### 1.1 推荐路线

采用“先闭环、再补齐、最后上线”的四道门：

| 门 | 可见结果 | 可以证明 | 不能声称 |
| --- | --- | --- | --- |
| P0 行走骨架 | 桌面 Web 连续点击完整流程并下载确定性 PPTX | 页面、API、数据库、Worker、对象存储和下载链路能连通 | 真实模型、微信读书、跨端或上线完成 |
| P1 真实桌面闭环 | 邮箱登录、真实本地书、真实文本模型、可编辑 PPTX | 桌面 Web 核心闭环可用于内部试用 | 微信登录、小程序、微信读书和生产上线完成 |
| P2 双端候选 | 微信登录、微信小程序、微信读书与桌面同账户恢复 | 两端核心闭环与外部边界可验收 | 已发布或已通过平台审核 |
| P3 邀请制 Beta | Staging、生产部署、小程序审核、监控与回滚通过 | MVP 已上线给受邀用户 | 大规模公开运营、付费或 SLA |

P0 必须尽快出现，但它只使用明确标识的本地假模型和假微信读书；所有完成页面显示“开发数据”标记，生产构建强制排除这些适配器。P1 起不得用 fixture、静态图片或手工改数据库替代真实入口。

### 1.2 备选与反方意见

- **只做桌面 Web**：能把前期日历时间缩短约 `25–35%`，但直接违反当前规格的双端 MVP 验收，并把小程序登录、上传、键盘、安全区和任务恢复风险推迟到最后。只适合作为 P1 内测，不作为最终 MVP。
- **直接使用 Serverless BaaS**：账户和 CRUD 起步更快，但微信两种登录、长时 PPT 任务、对象权限、成本硬上限和可恢复 Worker 会很快落入平台特例。当前更适合一个可部署到普通容器的模块化单体。
- **一开始并行完成两套 UI**：视觉进度看起来快，但 API 与状态机仍在变化，返工概率最高。推荐每个纵向切片先在桌面 Web 验证契约，再立即在小程序落同一能力，而不是等整个 Web 做完后才开始小程序。

最强反对意见是：P0 的假服务可能形成“演示完成”的错觉。应对方式不是取消 P0，而是把 P0 与 P1 的证据严格分开；任何需要模型、微信读书或真实账户的验收都必须在 P1/P2 重跑真实路径。

### 1.3 复用优先清单

| 能力 | 首选复用 | 项目只负责 |
| --- | --- | --- |
| PPT 生成与可编辑导出 | 自托管 Presenton 的异步/API 能力 | 大纲、任务状态、权限、成本、模板映射和产物归档 |
| PPT 模板与质量检查 | 当前已安装的 Presentations Skill、渲染与溢出检查工具 | 青瓷视觉决策和 PowerPoint/WPS 实开验收 |
| PPT 底层对象补缺 | PptxGenJS 或 Office Kit | 只实现 Presenton 验收失败的具体能力，不建另一套完整引擎 |
| EPUB / PDF 阅读 | 成熟 EPUB、PDF 解析与渲染库 | 统一书籍模型、位置映射、同步和错误恢复 |
| 数据库访问与迁移 | Prisma + PostgreSQL | 领域约束、事务、账户隔离和索引 |
| 后台任务 | pg-boss | 任务业务状态、取消语义和用户可见进度 |
| 文件存储 | S3-compatible SDK 与签名 URL | 对象所有权、生命周期和数据库引用 |

任何自研模块开始前都先回答三件事：现成项目是否已有、许可证能否用于产品、现成能力能否通过当前验收。三项都不满足才写新实现。

## 2. 文件结构与责任

```text
apps/
  web/                 桌面 Web 页面、端侧状态和浏览器适配
  miniapp/             微信小程序页面、端侧状态和平台 API 适配
  server/              HTTP API、认证、业务用例、上传签名
  worker/              导入解析、模型调用、联网补全、PPTX 生成
packages/
  contracts/           两端共享请求、响应、枚举与错误码
  domain/              无框架依赖的业务规则和状态机
  presentation-adapter/ Presenton 适配、模板映射与窄回退
  test-support/        本地假服务和确定性测试数据
infra/
  migrations/          数据库迁移审查入口
  deploy/              单镜像双进程部署与回滚说明
tests/
  integration/         PostgreSQL、对象存储、Worker 和 API 边界
  e2e/web/             桌面真实浏览器路径
  e2e/miniapp/         微信开发者工具可执行路径与检查清单
```

共享包不得导入 Web 或小程序运行时。`apps/server` 不承担后台长任务；`apps/worker` 不直接提供用户 HTTP API。视觉 token 的权威仍是 `DESIGN*.md`，代码只实现，不复制文档职责。

## 3. 工作包

### Task 1: 建立最小可运行仓库与本地 Harness

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`
- Create: `apps/web/`, `apps/miniapp/`, `apps/server/`, `apps/worker/`
- Create: `packages/contracts/`, `packages/domain/`, `packages/presentation-adapter/`, `packages/test-support/`
- Create: `infra/compose.yaml`, `infra/deploy/Dockerfile`
- Test: `packages/domain/src/health.test.ts`, `tests/integration/health.test.ts`

**Interfaces:**

- Produces root commands: `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `pnpm verify`.
- Produces `GET /api/v1/health/live` and `GET /api/v1/health/ready`.

- [ ] **Step 1: Record the execution snapshot**

  Run `pwd`, `git rev-parse --show-toplevel`, `git rev-parse HEAD`, and `git status --short`. Stop if the root differs from `/Users/echoman/Documents/SelfAlone` or unrelated edits overlap files owned by this task.

- [ ] **Step 2: Add a failing workspace health test**

  The test imports `createServer()` from `apps/server/src/app.ts`, injects `GET /api/v1/health/ready`, and expects `{ "status": "ready" }` only when PostgreSQL and object storage checks succeed.

- [ ] **Step 3: Run the test and verify failure**

  Run `pnpm test:integration -- health.test.ts`. Expected: failure because the workspace and server app do not exist.

- [ ] **Step 4: Scaffold only the listed packages and scripts**

  Pin Node `24`, enable TypeScript `strict`, configure one formatter/linter, and add local PostgreSQL plus an S3-compatible test service. Do not add Storybook, monorepo task runners, Kubernetes, Redis or CI matrices.

- [ ] **Step 5: Implement liveness and readiness**

  Liveness checks the process only. Readiness checks the database and object-storage bucket without creating permanent data; no external model or 微信读书 call belongs in readiness.

- [ ] **Step 6: Verify and commit**

  Run `pnpm verify`. Expected: unit, integration, typecheck and build pass. Commit only Task 1 files with `chore: scaffold mvp workspace`.

**Stop condition:** clean local startup and deterministic verification from a fresh checkout. External credentials are not required.

### Task 2: P0 桌面 Web 行走骨架

**Files:**

- Create: `packages/contracts/src/ppt.ts`, `packages/domain/src/ppt-state.ts`
- Create: `apps/server/src/modules/demo-flow/`, `apps/worker/src/jobs/demo-ppt.ts`
- Create: `apps/web/src/routes/login/`, `apps/web/src/routes/library/`, `apps/web/src/routes/conversation/`
- Create: `apps/web/src/features/ppt-workspace/`
- Create: `packages/presentation-adapter/src/fake-local.ts`, `packages/presentation-adapter/src/presenton.ts`
- Test: `packages/domain/src/ppt-state.test.ts`, `tests/e2e/web/walking-skeleton.spec.ts`

**Interfaces:**

```ts
export type PptDraftStage = "requirements" | "outline" | "template" | "submitted";
export type PptTaskStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type PptTaskSnapshot = {
  id: string;
  status: PptTaskStatus;
  completedPages: number;
  totalPages: number;
  version: number;
  artifactId?: string;
};
```

- [ ] **Step 1: Run the one-day PPT engine reuse Spike**

  Start a pinned Presenton container only after installation/network authorization. Feed it exact Chinese `slides_markdown`, a no-image request and one青瓷模板；verify API authentication, custom template fidelity, async progress, stop behavior, editable objects, PowerPoint / WPS open-and-resave, and Docker restart recovery. Record pass/fail per criterion. Use Presenton only if it passes the required behavior; otherwise retain its passing parts and use PptxGenJS or Office Kit only for the failed capability.

- [ ] **Step 2: Write state-machine tests**

  Cover valid stage progression, rejection of template submission before outline confirmation, idempotent task submission, stale version rejection, stop from `queued/running`, and preservation of completed pages after failure.

- [ ] **Step 3: Verify tests fail**

  Run `pnpm test:unit -- ppt-state.test.ts`. Expected: failure because the state machine does not exist.

- [ ] **Step 4: Implement the smallest domain state machine and persistence schema**

  Store one seeded development account, one TXT book, one conversation, one draft and one task. Use real PostgreSQL rows and object-storage objects; only outline/copy generation is fake and must be labeled `adapter: "fake-local"`.

- [ ] **Step 5: Implement one desktop route chain**

  Build login shell → unified library → book detail / conversation entry → requirements → outline → template → generating waterfall → completed waterfall → PPTX download. Use reference 02 for the shared shell and current Web design rules; do not build settings, WeRead or all empty states yet.

- [ ] **Step 6: Generate an actual editable PPTX**

  Use the selected engine adapter and `celadon-reading` template. The artifact must not be a screenshot-only deck; open the file with a parser test and assert slide count, `16:9` dimensions and editable text nodes. Use the installed Presentations Skill to render all pages and run overflow checks instead of creating another QA tool.

- [ ] **Step 7: Run the real browser path**

  Run `pnpm test:e2e:web -- walking-skeleton.spec.ts` at `1440×1024`. Expected: the test uses only visible UI, observes at least two progress snapshots, downloads a `.pptx`, and confirms the artifact record persists after browser refresh.

- [ ] **Step 8: Commit**

  Review screenshots against reference exclusions, run `pnpm verify`, then commit Task 2 files with `feat: add mvp walking skeleton`.

**Stop condition:** P0 is visibly continuous and produces a real file, while the UI and test report clearly state that external services are still fake.

### Task 3: 账户、绑定、设置与免费体验成本门

**Files:**

- Create: `apps/server/src/modules/auth/`, `apps/server/src/modules/accounts/`
- Create: `apps/server/src/modules/model-credentials/`, `apps/server/src/modules/trial-grants/`
- Create: `apps/web/src/routes/auth/`, `apps/web/src/routes/settings/`
- Modify: `packages/contracts/src/auth.ts`, `packages/domain/src/account-binding.ts`, `packages/domain/src/cost-limit.ts`
- Test: `tests/integration/auth.test.ts`, `tests/integration/trial-cost.test.ts`, `tests/e2e/web/auth-settings.spec.ts`

**Interfaces:**

- `POST /api/v1/auth/email/register`, `/login`, `/forgot-password`, `/reset-password`
- `GET /api/v1/auth/wechat-web/start`, `GET /api/v1/auth/wechat-web/callback`
- `POST /api/v1/auth/wechat-miniapp/exchange`
- `POST /api/v1/account/identities/bind`, `DELETE /api/v1/account/identities/:id`
- `POST /api/v1/trial-grant`, `PUT /api/v1/model-credentials/text`

- [ ] **Step 1: Write failing security and account tests**

  Cover password hashing, cookie flags, opaque miniapp token hashing, one-time code replay rejection, optional binding, two-data-account merge rejection, model-key non-disclosure, exactly-once trial claim and a transactional `¥5` hard stop under concurrent calls.

- [ ] **Step 2: Verify failure**

  Run `pnpm test:integration -- auth.test.ts trial-cost.test.ts`. Expected: endpoints and tables are absent.

- [ ] **Step 3: Implement email authentication and sessions**

  Add verification/reset expiry, rate limits and generic error messages that do not disclose registered emails. Web sessions are revocable rows; miniapp tokens are separate revocable rows.

- [ ] **Step 4: Implement WeChat identity adapters behind fake and real modes**

  The real mode accepts only server-side AppID/AppSecret configuration. It exchanges client code server-side and never returns `session_key`; H4 remains disabled until explicit credentials and authorization are available.

- [ ] **Step 5: Implement account binding and model credential encryption**

  Require re-authentication and explicit confirmation. Reject binding if both target accounts contain user data. Encrypt model keys with AES-256-GCM and return only configured/unconfigured status.

- [ ] **Step 6: Implement the trial ledger**

  Claim once per account, reserve estimated cost inside a transaction, settle actual cost, release failed reservations, and reject any call whose reservation could exceed `¥5`.

- [ ] **Step 7: Build and test Web screens**

  Implement reference 01 login, reference 36 quota strip, reference 09 settings, and reference 37 text-model configuration. Run the browser path for registration, claim, logout/login, failed key validation with preserved input, and successful return to the original action.

- [ ] **Step 8: Verify and commit**

  Run secret scans, integration tests and Web E2E, then commit with `feat: add accounts and trial access`.

**Risk escalation:** any real email, WeChat or model call requires its own credential and cost authorization before H4.

### Task 4: 统一书架、本地导入、阅读与笔记

**Files:**

- Create: `apps/server/src/modules/books/`, `apps/server/src/modules/reading/`, `apps/server/src/modules/notes/`
- Create: `apps/worker/src/jobs/import-book.ts`
- Create: `apps/web/src/routes/library/`, `apps/web/src/routes/books/`
- Modify: `packages/contracts/src/books.ts`, `packages/domain/src/reading-position.ts`
- Test: `tests/integration/book-import.test.ts`, `tests/e2e/web/reading-notes.spec.ts`

**Interfaces:**

- `POST /api/v1/books/uploads`, `POST /api/v1/books/imports`, `GET /api/v1/books/:id/import-status`
- `GET /api/v1/books`, `GET /api/v1/books/:id/sections`
- `PUT /api/v1/books/:id/position`, CRUD under `/highlights` and `/notes`

- [ ] **Step 1: Write failing import and recovery tests**

  Use one EPUB, one TXT, one text-layer PDF, one image-only PDF and one corrupt file. Assert stable book identity, source separation, original-file retention, last-good-version preservation, default cover behavior and understandable failure.

- [ ] **Step 2: Verify failure**

  Run `pnpm test:integration -- book-import.test.ts`. Expected: import job and schema are absent.

- [ ] **Step 3: Implement signed upload and asynchronous parsing**

  Validate extension, MIME, size and account ownership; publish parsed sections only after the full parse succeeds. Do not add OCR, a vector database or a format-specific UI branch.

- [ ] **Step 4: Implement reading state**

  Save one full-book position per account/book, preserve background preference, use stable section offsets for return-to-source, and reject stale progress updates.

- [ ] **Step 5: Implement highlights and notes**

  Preserve read-only source quotes, optional reliable location, body-only notes, new-note behavior for AI整理, and save-failure input retention.

- [ ] **Step 6: Build desktop library and reader**

  Use full visual reference 03 for the library and references 07/08/10 only within their listed scope. Verify 5-column behavior at `1440px`, reduced columns below it, focus mode, directory overlay, selection toolbar and all five data states.

- [ ] **Step 7: Run real browser and persistence checks**

  Import an EPUB through the visible file picker, read, highlight, write a note, refresh and log in again. Expected: the exact position, highlight and unsaved-error recovery behave through API and database boundaries.

- [ ] **Step 8: Commit**

  Run affected unit/integration/E2E suites and commit with `feat: add local library and reading`.

**Stop condition:** one real local book survives upload, parse, reading, note and re-login without fixture-backed UI.

### Task 5: 会话、图片附件和任务互斥

**Files:**

- Create: `apps/server/src/modules/conversations/`, `apps/server/src/modules/messages/`
- Create: `apps/web/src/routes/conversation/`, `apps/web/src/features/composer/`
- Modify: `packages/contracts/src/conversations.ts`, `packages/domain/src/conversation-lock.ts`
- Test: `tests/integration/conversation-lock.test.ts`, `tests/e2e/web/conversation.spec.ts`

**Interfaces:**

- `POST /api/v1/conversations`, `DELETE /api/v1/conversations/:id`
- `POST /api/v1/conversations/:id/messages`, `POST /api/v1/conversations/:id/stop`
- `POST /api/v1/message-attachments/uploads`

- [ ] **Step 1: Write failing concurrency tests**

  Cover one running operation per conversation, other-conversation independence, stop restoring send access, stale completion rejection, conversation deletion preserving started tasks/artifacts, and draft retention after upload/send failure.

- [ ] **Step 2: Implement conversations and message persistence**

  Keep one conversation type. Store user/assistant/status messages and structured selection results without introducing a generic task-center UI.

- [ ] **Step 3: Implement attachment flow**

  Enforce `0–4` images, ownership and size/type checks. Preserve text and successful uploads if one image fails; verify capability before sending to the text model.

- [ ] **Step 4: Implement visible Web behavior**

  Use reference 02 and 36 for the desktop shell. Provide keyboard-operable new/switch/delete, stable status messages, stop control, image removal and mascot summon/close behavior.

- [ ] **Step 5: Verify and commit**

  Run two-browser-context tests for conversation isolation, refresh recovery and stale response protection. Commit with `feat: add persistent conversations`.

### Task 6: 真实文本模型与完整 PPT 生产链路

**Files:**

- Create: `apps/server/src/modules/text-model/`, `apps/server/src/modules/ppt/`
- Create: `apps/worker/src/jobs/create-outline.ts`, `apps/worker/src/jobs/generate-ppt.ts`
- Create: `packages/presentation-adapter/src/templates.ts`, `packages/presentation-adapter/src/progress.ts`
- Modify: `packages/presentation-adapter/src/presenton.ts`, `packages/domain/src/ppt-state.ts`
- Test: `tests/integration/ppt-job.test.ts`, `packages/presentation-adapter/src/presenton.test.ts`, `tests/e2e/web/ppt-flow.spec.ts`

**Interfaces:**

- `POST /api/v1/ppt-drafts`, `PATCH /api/v1/ppt-drafts/:id/requirements`
- `POST /api/v1/ppt-drafts/:id/outline/generate`, `PUT /api/v1/ppt-drafts/:id/outline`
- `PUT /api/v1/ppt-drafts/:id/template`, `POST /api/v1/ppt-tasks`
- `GET /api/v1/ppt-tasks/:id`, `POST /api/v1/ppt-tasks/:id/stop|retry`, `DELETE /api/v1/ppt-tasks/:id`
- `GET /api/v1/ppt-artifacts/:id/download`

- [ ] **Step 1: Write failing contract and layout tests**

  Assert valid outline hierarchy, automatic page count, source ownership, deterministic idempotency, retry without duplicate completed pages, stop recovery, failure deletion scope, `16:9` output, editable text/shape objects and long-text overflow failure.

- [ ] **Step 2: Implement one real model adapter and schema validation**

  Validate every model response before persistence. Retry only transport/transient failures within the job policy; invalid structured output becomes a visible retryable failure with the draft preserved.

- [ ] **Step 3: Implement continuous outline editing and autosave**

  Preserve focus and selection, reject orphan child nodes in place, and require a fresh confirmation after a confirmed outline changes.

- [ ] **Step 4: Lock three reusable PPT templates**

  Use the installed Presentations Skill and Presenton template tooling to produce and visually inspect `celadon-reading`、`editorial-paper`、`minimal-ink`. Each includes title, section, content and closing layouts and produces a usable no-image deck. Check the versioned template assets into the project; do not rebuild a generic template designer.

- [ ] **Step 5: Implement the Worker lifecycle**

  Lease jobs, heartbeat, check cancellation between pages, persist each completed preview, recover expired leases, and settle cost per real call. Polling snapshots must be monotonic by version.

- [ ] **Step 6: Build all desktop states**

  Implement range, outline, template, generating, failed and completed states. References 04, 06 and 33 constrain their listed pages; template 05 is structure-only; desktop completed state must be a minimal derivative of shared waterfall rules, not an old exploration image.

- [ ] **Step 7: Run authorized H4 and real PPTX checks**

  After the user authorizes provider, model, call count and budget, generate one short, one long-text and one no-image deck. Open and re-save them in both PowerPoint and WPS; record visual and editability results.

- [ ] **Step 8: Verify and commit**

  Run domain, integration, worker-restart, browser and artifact tests. Commit with `feat: generate editable pptx`.

**Stop condition:** desktop P1 passes with a real model and real office applications. Static PPT XML checks alone are insufficient.

### Task 7: 微信读书与公开资料补全

**Files:**

- Create: `apps/server/src/modules/weread/`, `apps/server/src/modules/public-sources/`
- Create: `apps/worker/src/jobs/sync-weread.ts`, `apps/worker/src/jobs/find-public-sources.ts`
- Modify: `apps/web/src/routes/library/`, `apps/web/src/routes/settings/`
- Test: `tests/integration/weread-sync.test.ts`, `tests/integration/public-sources.test.ts`

**Interfaces:** `WeReadAdapter` and `PublicBookSourceAdapter` exactly as defined in `redesign-v2/TECHNICAL.md`.

- [ ] **Step 1: Obtain and freeze external contracts**

  Use the provider's formal documentation and one authorized sandbox response to record request fields, pagination, stable IDs, rate limits, error codes and revocation. If these cannot be obtained, stop this work package at the adapter boundary and report that MVP launch remains blocked; do not infer private APIs.

- [ ] **Step 2: Write contract tests against sanitized recordings**

  Cover successful validation, invalid Skill Key, pagination, retryable failure, account switch without merge, disconnect preserving synced data, and public-source evidence links.

- [ ] **Step 3: Implement replace-after-validate connections**

  A new Skill Key becomes active only after validation succeeds. Successful save starts sync; normal automatic sync does not create a permanent shelf button or timestamp.

- [ ] **Step 4: Implement idempotent sync**

  Upsert by provider and external ID, preserve personal annotations, never merge same-name books from different sources, and retain last successful data on failure.

- [ ] **Step 5: Implement evidence-aware public supplementation**

  Prefer publisher/author pages, public catalogs, author interviews and credible reviews. Persist source URL, title, retrieval time and supported claim; when evidence is insufficient, retain the draft and ask for user material.

- [ ] **Step 6: Verify authorized H4 and commit**

  Run one first sync, one incremental sync, one invalid-key recovery and one account switch with explicit authorization. Commit with `feat: sync weread content` only after current evidence passes.

### Task 8: 微信小程序核心闭环

**Files:**

- Create: `apps/miniapp/pages/auth/`, `conversation/`, `library/`, `reader/`, `settings/`, `ppt/`
- Create: `apps/miniapp/components/conversation-drawer/`, `composer/`, `bottom-sheet/`, `ppt-waterfall/`
- Create: `apps/miniapp/services/api.ts`, `auth.ts`, `uploads.ts`
- Test: `tests/e2e/miniapp/core-flow.md`, `apps/miniapp/**/*.test.ts`

**Interfaces:** consumes the stable `/api/v1` resources from Tasks 3–7 without miniapp-only business endpoints.

- [ ] **Step 1: Add page-state tests**

  Cover safe-area layout, keyboard avoidance, `360/390/430px` shelf columns, bottom-sheet selection retention, `0–4` attachments, one-page reading gestures, PPT stage return and polling recovery.

- [ ] **Step 2: Implement login and app shell**

  Use references 21, 11 and 13. Exchange `wx.login()` code on the server, keep email secondary, and never store AppSecret or session_key in the package.

- [ ] **Step 3: Implement conversation and attachments**

  Use references 30–32 for the local states that override reference 13. Multi-select uses a bottom half-sheet, not desktop cards; camera/gallery and image removal preserve the same API contract as Web.

- [ ] **Step 4: Implement library, local reading and book content**

  Use references 14–20. Verify introduction → swipe page → immersive text → tap controls → content panel, with safe areas, dynamic panels and persistent reading position.

- [ ] **Step 5: Implement settings and model recovery**

  Use references 22, 38 and 39. Successful model validation returns to the exact input/task stage without auto-running the old request.

- [ ] **Step 6: Implement the full PPT flow**

  Use references 23–29 for all seven states. Preserve single-task layout, two-column template grid, waterfall progress, failed-page actions and completed download.

- [ ] **Step 7: Execute real-device H3**

  In微信开发者工具 and at least one iOS plus one Android device, run login → import/sync → read/note → start PPT → background/return → download. Record viewport, device, build, account and persisted artifact ID.

- [ ] **Step 8: Verify and commit**

  Run miniapp build, package-size check, unit tests, manual H3 checklist and backend regression. Commit with `feat: add miniapp core flow`.

### Task 9: P3 发布候选、恢复与邀请制 Beta

**Files:**

- Create: `infra/deploy/runbook.md`, `infra/deploy/rollback.md`, `infra/deploy/backup-restore.md`
- Create: `tests/e2e/web/release-smoke.spec.ts`, `tests/release/checklist.md`
- Modify: `.env.example`, `infra/deploy/Dockerfile`
- Update after confirmation: `PROJECT_STATUS.md`

**Interfaces:** production processes `server` and `worker`; one HTTPS API domain; versioned database migrations with backward-compatible deploy order.

- [ ] **Step 1: Freeze the release candidate**

  Record repository root, commit, clean status, image digest, migration list and client build IDs. No feature changes enter after freeze without a new candidate.

- [ ] **Step 2: Run H0–H3 on Staging**

  Run `pnpm verify`, migrations on a production-shaped copy, browser H3 and miniapp H3. Verify real object downloads, task restart recovery and account isolation.

- [ ] **Step 3: Run only authorized H4**

  Exercise 微信登录、微信读书、文本模型、联网补全 and optional image model with agreed accounts, call count and budget. Redact logs and store only result IDs and cost totals.

- [ ] **Step 4: Prove backup, restore and rollback**

  Restore database and object references into an isolated environment, verify one book, note and PPT artifact, then roll the application back to the prior compatible image without data loss.

- [ ] **Step 5: Complete platform gates**

  Configure the HTTPS request/upload/download domains, finish APP/小程序备案 and privacy disclosures, submit the exact candidate to微信审核, and retain the rejection/retry path. These are external gates, not code-complete claims.

- [ ] **Step 6: Production smoke and invite opening**

  After explicit deploy authorization, migrate, deploy server and Worker, deploy Web, release the approved miniapp build, run one account's core smoke path, then open only the agreed invitation cohort.

- [ ] **Step 7: Observe and stop**

  Observe error rate, task duration, queue depth, model cost, storage failures and login failures for the agreed window. Roll back on the documented thresholds; otherwise mark P3 evidence in `PROJECT_STATUS.md`.

- [ ] **Step 8: Commit release documentation**

  Commit only reviewed runbooks and current status with `docs: record mvp release evidence`. Publishing and pushing remain separate authorizations.

## 4. 规格覆盖矩阵

| 规格范围 | 主要任务 | 上线前证据 |
| --- | --- | --- |
| 账户、绑定、设置、免费体验 | Task 3, 8 | H1 并发成本测试、H3 两端恢复、授权 H4 微信登录 |
| 会话、互斥、图片附件 | Task 5, 8 | H2 并发与旧请求测试、H3 图片失败保留 |
| 统一书架、本地书、阅读、划线、笔记 | Task 4, 8 | H2 真实文件解析、H3 刷新/跨端恢复 |
| 微信读书同步 | Task 7, 8 | 授权 H4 首次/增量/失败/换号 |
| 双入口 PPT、范围、大纲、模板 | Task 2, 6, 8 | H1 状态机、H3 两入口同流程 |
| 生成、停止、失败、作品与 PPTX | Task 6, 8 | Worker 重启、浏览器/真机 H3、PowerPoint/WPS 实开 |
| 五类数据状态、无障碍与响应式 | 每个 UI 任务，Task 9 汇总 | 目标视口、键盘、字体放大、焦点和错误恢复 |
| 部署、隐私、备案、审核与回滚 | Task 9 | H5 当前候选证据 |

## 5. 里程碑、时间与停止条件

| 里程碑 | Codex 实际工作时间 | 人类日历时间 | 停止条件 |
| --- | --- | --- | --- |
| P0 行走骨架（Task 1–2） | `8–14h` | `1–2` 个工作日 | Presenton 适配结论明确，真实浏览器下载确定性 PPTX |
| P1 真实桌面闭环（Task 3–6） | `28–42h` | `1–2` 周 | 真实账户、本地书、模型和 Office/WPS 验收通过 |
| P2 双端候选（Task 7–8） | `24–36h` | `1–2` 周 | 微信读书与小程序真机核心链路通过 |
| P3 邀请制 Beta（Task 9） | `10–16h` | `3–7` 个工作日，另加平台等待 | Staging、备案/审核、生产冒烟和回滚证据通过 |
| 合计 | `70–108h` | `3–5` 周，外部备案/审核时间另计 | 两端邀请制 Beta 可用且可恢复 |

时间不包含等待用户提供凭证、付费调用授权、域名/主体材料或平台审核的时间。若先只做到 P1 内测，不能称为完整 MVP 上线。

如果目标先收窄为“给你本人真实使用的桌面纵向闭环”，而不是双端备案上线，预计为 `24–40h` Codex 实际工作时间、`4–7` 个工作日；这才是第一版应该追求的速度。

## 6. 执行与协作规则

- 用户确认计划后，先把当前里程碑和 Task 1 写入 `PROJECT_STATUS.md`，再开始安装依赖或改代码。
- 默认主 Agent 顺序执行关键路径；只有文件不重叠且无顺序依赖时才并行，最多三个 `luna_worker`。
- 同一任务由一个写入者负责；审查者只检查指定结论、反例和遗漏，不重做实现。
- 每个任务都执行测试先行、定向验证、真实入口验收、diff 审查和范围单一的本地提交。
- P1、P2、P3 里程碑以及认证、成本、外部调用、持久化、取消和发布边界必须有非作者审查；审查报告不替代主 Agent 的最终验证。
- 任何外部服务调用前逐项确认服务/模型、次数、范围或尺寸、输出位置和预算；未经授权停在门前，不阻塞可独立完成的本地工作。
- 达到每个 Stop condition 后停止扩展，不夹带重构、通用平台或下一阶段功能。

## 7. 计划自审结果

- **规格覆盖：** `SPEC.md` 的账户、会话、书籍、阅读、笔记、设置、双入口 PPT、任务恢复、跨端和发布要求均已映射到 Task 3–9；参考图 01–39 按索引层级进入对应 UI 任务。
- **已知视觉缺口：** 桌面模板只有结构参考，生成完成无认可页面参考；Task 6 只允许按共享外壳、瀑布流和端侧规范派生，不复制旧探索稿。该缺口不阻塞技术设计或 P0/P1。
- **已知外部门：** 微信读书正式协议、真实模型/检索提供方、域名/主体材料和发布账户必须由用户提供或授权；Task 7/9 有明确停止条件，不以假服务越过。
- **类型一致性：** 草稿阶段、任务状态、版本号、幂等和错误码统一以 `TECHNICAL.md` 与 `packages/contracts` 为唯一代码契约；两端不得复制不同枚举。
- **占位扫描：** 计划不包含未定义实现项；外部未知被定义为授权门和停止条件，而不是由开发者猜测。
