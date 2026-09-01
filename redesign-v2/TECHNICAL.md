# 老己 MVP 技术设计

## 1. 架构

- Node.js 24 LTS、pnpm workspace、TypeScript strict mode。
- 单体仓库、模块化后端、一个 PostgreSQL 数据库和一个 S3 兼容对象存储。
- HTTP API 与后台 Worker 使用同一代码库、不同进程；任务队列使用 PostgreSQL，不增加 Redis。
- 桌面 Web 与微信小程序共享 JSON 兼容契约、账户数据和状态机，不共享页面组件。
- 外部模型、微信读书、公开资料与 PPT 引擎均由服务端适配器隔离；外部系统不成为账户、任务或作品的业务事实源。

| 位置 | 职责 | 技术约束 |
| --- | --- | --- |
| `apps/web/` | 桌面 Web | React、Vite、TypeScript 与共享视觉 token |
| `apps/miniapp/` | 微信小程序 | 原生框架与 TypeScript，不引入跨端 UI 框架 |
| `apps/server/` | HTTP API、认证、上传签名、业务编排 | Fastify、Zod 与 PostgreSQL |
| `apps/worker/` | 导入解析、AI、PPT 生成与恢复 | Node.js 进程消费 PostgreSQL 任务 |
| `packages/contracts/` | 请求、响应、状态和错误契约 | 只含 TypeScript 类型与 JSON 兼容常量 |
| `packages/domain/` | 领域状态与并发规则 | 无 UI、网络和数据库依赖 |
| `packages/presentation-adapter/` | PPT 引擎与模板映射 | 屏蔽引擎差异，归一化进度和产物 |
| `packages/test-support/` | 假外部服务和确定性数据 | 只用于测试与本地开发 |

生产运行单元为 `server`、`worker` 和内网 PPT 生成服务。`server` 与 `worker` 可由同一镜像使用不同启动命令运行；PPT 服务固定版本和镜像摘要，不开放公网管理入口。桌面 Web 与微信小程序共用一个 HTTPS API 域名。

## 2. 数据与安全

核心数据表：

- `accounts`, `login_identities`, `sessions`, `email_tokens`
- `conversations`, `messages`, `message_attachments`
- `books`, `book_files`, `book_sections`, `reading_positions`
- `highlights`, `notes`
- `ppt_drafts`, `ppt_outline_nodes`, `ppt_tasks`, `ppt_pages`, `ppt_artifacts`
- `service_connections`, `model_credentials`, `trial_grants`, `cost_ledger`, `job_events`

所有用户数据表带 `account_id`，父子资源使用包含 `account_id` 的复合外键。写入使用资源版本或条件更新拒绝旧请求；账户级幂等键不能跨账户冲突；失败任务的清理不得级联删除历史成功作品。

- Web 会话使用随机、可撤销的 `HttpOnly + Secure + SameSite=Lax` Cookie；小程序使用随机不透明令牌，数据库只保存令牌摘要和过期时间。
- 邮箱密码使用 Argon2id；邮箱验证与找回令牌一次有效、短期过期，数据库只保存摘要。
- `wx.login()` code 只发送给服务端；`AppSecret` 与 `session_key` 不下发客户端。
- 两个已有数据账户拒绝静默合并；身份绑定需要重新验证并显式确认。
- 模型和外部服务凭证使用部署主密钥执行 AES-256-GCM 信封加密；API、日志和错误响应不回传完整凭证。

## 3. 状态、任务与并发

```text
PPT 草稿: requirements -> outline -> template -> submitted

PPT 任务: queued -> running -> completed
                            -> failed
                            -> stopped
```

- 从书籍详情 / 阅读页进入会话的书籍来源与预填文本属于版本化的会话 `draft/context handoff`，不是 PPT 草稿或任务。该交接保存 `conversation_id`、`bookId`、书名和当前已有的可显示书籍信息，以及未发送的可编辑草稿；在用户实际发送并完成 PPT 意图识别前，不得创建 `ppt_drafts` / `ppt_tasks`、分配任务 ID、进入 requirements 阶段或预写范围选择。跳转、刷新或恢复失败必须保留交接上下文和草稿。
- 同一 `conversation_id` 最多存在一个运行中的 AI 回答或 PPT 任务，由数据库约束与事务共同保证。
- 创建 PPT 任务必须携带草稿版本和账户级幂等键；同一请求重试返回原任务。
- Worker 使用租约、心跳和有限重试；进程重启后重新领取过期租约。
- 停止只写入取消请求；Worker 在可恢复边界检查并保留已经完成的产物。
- 外部结果写回前再次校验账户、资源版本和任务状态，过期结果不得覆盖新状态。

## 4. API 与存储

API 前缀为 `/api/v1`，错误统一为：

```ts
type ApiError = {
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "VALIDATION_FAILED"
    | "CONFLICT"
    | "EXTERNAL_AUTH_REQUIRED"
    | "EXTERNAL_SERVICE_FAILED"
    | "COST_LIMIT_REACHED"
    | "STALE_VERSION";
  message: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
};
```

资源组包括账户与身份、会话与消息、书籍与阅读位置、划线与笔记、PPT 草稿与任务、产物下载、外部连接、模型凭证、体验领取和健康检查。

- 上传与下载使用短时效签名 URL，API 进程不转发大文件。
- 对象键包含 `account_id`、资源 ID 和版本；原文件与派生缓存分开保存。
- 客户端通过轮询读取任务状态；前台活跃时 `2s`，后台或非末尾浏览时 `5s`，不引入 WebSocket 或 SSE。

## 5. 内容与外部适配器

### 5.1 本地书籍

- 导入适配器按 `EPUB`、`TXT`、`PDF` 分派解析器，对外输出统一的文件元信息、解析状态和稳定定位结构。
- EPUB/TXT 生成规范化章节与稳定定位。
- PDF 依次执行文件校验、页面枚举、文本层提取和页面渲染；加密、损坏、单页失败与文件级不可渲染使用不同的结构化结果。
- PDF 原文件是内容事实源；页面图像、缩略图和文本层均为按文件版本、页码、渲染器版本和尺寸区分的可重建缓存。
- 图片型 PDF 的独立笔记以文件版本和页码作为锚点，不依赖文本偏移。单页失败允许单独重试；所有页面均不可渲染才进入文件级失败。
- 原文件先写入对象存储，再由 Worker 解析；成功后事务性发布解析版本。
- 书籍搜索使用 PostgreSQL 的标题、作者和来源字段，不建设全文搜索服务。

#### 5.1.1 文本 / PDF 阅读共享接缝

M1-F2-B 与 M1-F2-C 共用下列接缝，端侧和解析模块不得各自发明另一套定位或版本语义：

```ts
type TextLocator = {
  kind: "text";
  fileVersion: number;
  sectionId: string;
  offset: number;
};

type PdfLocator = {
  kind: "pdf";
  fileVersion: number;
  pageNumber: number;
};

type ReadingLocator = TextLocator | PdfLocator;
```

- `book_files.version` 是阅读内容版本。Worker 只能事务性发布同一版本的章节或页面；保存位置、重试、笔记和缓存均携带 `fileVersion`，版本不一致返回 `STALE_VERSION`，旧任务不得回写当前内容。
- 文本章节使用稳定 `sectionId + offset`；PDF 只使用从 1 开始的 `pageNumber`，不得把文本偏移用于页面定位。阅读位置按 `(account_id, book_id)` 唯一并带递增 `version`，客户端写入必须携带 `expectedVersion`。
- 共享 API 固定为：`GET /api/v1/books/:bookId/reading` 返回当前文件版本、内容模式与位置；文本内容位于 `/content/sections`，PDF 页摘要与单页资源位于 `/content/pages`；位置写入使用 `PUT /position`；笔记 CRUD 位于 `/notes`，锚点复用 `ReadingLocator`。具体查询参数和 JSON 字段只在 `packages/contracts` 定义一次。
- 共享数据层新增 `book_sections`、`book_pages`、`reading_positions` 与 `notes`。所有表带 `account_id`，对子资源使用 `(account_id, book_id)` 复合外键；章节唯一键为文件版本与 `section_id`，页面唯一键为文件版本与页码。页面缓存另带渲染器版本与尺寸，不作为内容事实源。
- B 独占 `text-reader*` 模块，C 独占 `pdf-reader*` 与 PDF Worker / 缓存模块；`packages/contracts`、迁移、Server 组合入口和 Web 共享路由 / 样式由项目总控单写入并集成。
- 当前仓库尚无批准的生产 PDF 解析 / 渲染依赖。C 可以先交付真实样本、适配器接口、安全上限、缓存键、任务恢复和失败关闭测试；在生产依赖及许可证 / 资源边界明确前，不得把本机工具、检测摘要或占位页面称为真实页面渲染。

### 5.2 模型与公开资料

```ts
interface TextModelAdapter {
  validateCredential(apiKey: string): Promise<void>;
  chat(input: ChatInput, signal: AbortSignal): Promise<ChatResult>;
  createOutline(input: OutlineInput, signal: AbortSignal): Promise<OutlineResult>;
  createSlideCopy(input: SlideCopyInput, signal: AbortSignal): Promise<SlideCopyResult>;
}

interface PublicBookSourceAdapter {
  search(input: BookSourceQuery, signal: AbortSignal): Promise<SourceDocument[]>;
}
```

- 文本 provider id 为 `deepseek`、`kimi`、`glm`、`qwen`；客户端不提交任意端点或模型名。
- 服务端模型目录记录端点、允许模型、默认模型、能力、备案信息、地域、来源和最近核验时间；易变值不固化在本文。
- 平台凭证与用户凭证复用适配器但使用不同凭证来源。平台调用事务性预占成本，完成后结算，失败则释放预占；若结算已经提交但确认响应丢失，服务端回读同一 reservation，只有状态与实际金额都一致时才返回原回答，避免重复调用供应商。
- 正式 Server 只在部署侧同时提供 `PLATFORM_DEEPSEEK_API_KEY`、`PLATFORM_DEEPSEEK_INPUT_CACHE_HIT_CNY_MICROS_PER_MILLION`、`PLATFORM_DEEPSEEK_INPUT_CACHE_MISS_CNY_MICROS_PER_MILLION` 与 `PLATFORM_DEEPSEEK_OUTPUT_CNY_MICROS_PER_MILLION` 时启用平台文本模型；Key 不进入用户模型配置、源码、普通 `.env`、日志或客户端。四项全部缺失时保持 `PLATFORM_UNAVAILABLE`，部分或非法配置拒绝启动。价格值是部署时按供应商当前计费与换算核验的人民币微元快照，不在仓库写死；每次调用按供应商响应中的 cache hit、cache miss 与 completion token 用量向上取整到整数微元后结算。
- 图片能力使用可空的独立适配器；没有图片适配器时 PPT 引擎仍须返回有效产物。
- 公开资料结果保留来源 URL、标题、发布时间、抓取时间和使用范围。

### 5.3 微信读书

```ts
interface WeReadAdapter {
  validate(apiKey: string): Promise<WeReadAccount>;
  syncBooks(connectionId: string, cursor?: string): Promise<WeReadSyncPage>;
  syncAnnotations(connectionId: string, bookExternalId: string): Promise<WeReadAnnotation[]>;
}
```

适配器通过 `POST https://i.weread.qq.com/api/agent/gateway` 调用允许列表内的 `api_name`，使用 Bearer 凭证并携带 `skill_version`。调用检查 `errcode` 与 `upgrade_info`；升级要求暂停同步并保留上次成功快照。分页游标、外部 ID 和连接账户相互隔离；新凭证验证成功后才原子替换旧连接。限流采用单连接串行、超时和对 `429/5xx` 的有界退避。

服务端共享 HTTP 边界固定为 `/api/v1/weread`：连接读写删除位于 `/connection`，书籍同步与快照位于 `/sync/books`、`/books`，单次运行状态位于 `/sync/:runId`，单书批注同步与快照位于 `/sync/annotations`、`/annotations`。账户只由已认证服务端上下文注入；客户端提交的 cursor 保持不透明，连接替换 / 删除必须携带已观察 revision，两类同步接受后返回 HTTP 202。凭证持久化、后台恢复与真实腾讯调用属于后续 runtime 包，不由路由存在冒充完成。

### 5.4 PPT 引擎

```ts
interface PresentationEngine {
  generate(input: PresentationInput, signal: AbortSignal): Promise<PresentationJobRef>;
  getProgress(jobId: string): Promise<PresentationProgress>;
  stop(jobId: string): Promise<void>;
  getArtifact(jobId: string): Promise<PresentationArtifact>;
}
```

PPT 生成优先使用自托管 Presenton 内网服务。适配器只接受 `celadon-reading`、`editorial-paper`、`minimal-ink` 三个模板 ID，并映射到固定版本资产。Presenton 固定版本和镜像摘要、关闭匿名遥测、使用独立服务凭证并经过许可证与依赖扫描。

外部引擎不保存老己账户或业务状态。不能取得可信逐页进度时不得伪造页级进度；开发与 QA 工具不进入生产调用链。只有验收证明某项能力缺失时，才用 PptxGenJS 或 Office Kit 补充该缺口。

## 6. 技术验证与非目标

| 层级 | 技术证据 |
| --- | --- |
| H0 | 格式、Lint、TypeScript、生产构建、数据库迁移检查 |
| H1 | 领域状态、账户边界、成本并发、幂等和模板布局单元测试 |
| H2 | PostgreSQL、对象存储、Worker 恢复、上传与下载集成测试 |
| H3 | 浏览器、微信开发者工具和真实 PPTX 客户端路径 |
| H4 | 真实微信、微信读书、文本模型、公开资料与图片模型适配器 |
| H5 | Staging 迁移、生产镜像、备份恢复、告警、冒烟与回滚演练 |

不建设 Redis、消息总线、WebSocket、微服务、多区域部署、通用任务编排、插件运行时、多 Agent 编排或 Prompt 管理基础设施；不引入 OCR、Embedding、向量数据库或全文搜索服务；不复制或魔改 Presenton 完整产品。
