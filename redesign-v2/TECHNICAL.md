# 老己 MVP 技术设计

- 状态：开发方案基线；用户确认进入开发后按本文件执行
- 产品行为：[`SPEC.md`](SPEC.md)
- 共享视觉：[`DESIGN.md`](DESIGN.md)
- 开发顺序：[`../docs/superpowers/plans/2026-08-23-mvp-launch.md`](../docs/superpowers/plans/2026-08-23-mvp-launch.md)

## 1. 设计目标

用一套可上线但不过度抽象的生产架构，先跑通以下真实纵向闭环：

`登录 → 导入一本书 → 阅读 / 笔记 → 发起 PPT → 确认范围、大纲和模板 → 后台生成 → 预览并下载 PPTX`

技术方案遵循以下边界：

- 一个单体仓库、一个模块化后端、一个 PostgreSQL 数据库和一个对象存储；后台任务使用同一代码库中的独立 Worker 进程。
- 桌面 Web 与微信小程序共享业务契约、数据和状态机，不共享页面组件；两端分别实现已确认视觉。
- 先实现 PPT 这一种任务，不建设通用任务中心、可视化工作流、插件平台或多租户组织权限。
- 不引入微服务、Kubernetes、消息总线、Redis、全文搜索集群、事件溯源或数据湖。
- 外部模型、微信读书、联网检索和真实发布都通过明确适配器与授权门接入；未获授权时只运行不收费的假服务和本地验证。

## 2. 技术栈与仓库结构

运行时使用 Node.js 24 LTS 与 pnpm workspace，全仓使用 TypeScript strict mode。

| 位置 | 职责 | 推荐实现 |
| --- | --- | --- |
| `apps/web/` | 桌面 Web | React、Vite、React Router、TanStack Query、CSS Modules 与共享视觉 token |
| `apps/miniapp/` | 微信小程序 | 微信小程序原生框架与 TypeScript；不为单一平台引入跨端 UI 框架 |
| `apps/server/` | HTTP API、认证、上传签名、业务编排 | Fastify、Zod、Prisma |
| `apps/worker/` | 导入解析、AI、PPT 生成与失败恢复 | pg-boss 消费 PostgreSQL 任务；复用服务模块 |
| `packages/contracts/` | 两端共享的请求、响应、状态枚举和错误码 | 只含 TypeScript 类型与 JSON 兼容常量 |
| `packages/domain/` | 账户、书籍、会话、笔记、PPT 草稿与任务规则 | 无 UI、无网络、无数据库依赖的纯函数 |
| `packages/pptx/` | 内置模板、页面布局、PNG 预览和 PPTX 导出 | 共享布局描述；PptxGenJS 导出 PPTX，SVG + Sharp 导出预览 |
| `packages/test-support/` | 假模型、假微信读书、假检索和确定性测试数据 | 仅测试与本地开发使用，不进入生产分支逻辑 |

生产基础设施只包含：

- PostgreSQL：业务事实、会话、任务、幂等键、成本账本和队列元数据。
- S3 兼容对象存储：本地书原文件、提取结果附件、会话图片和 PPTX；对象键必须带账户与资源 ID。
- 两个进程：`server` 和 `worker`。两者可由同一镜像用不同启动命令部署。
- 一个 HTTPS API 域名：同时服务桌面 Web 与微信小程序，减少跨域和域名备案范围。

## 3. 核心模块与数据

### 3.1 身份与安全

- `accounts` 保存稳定账户；`login_identities` 分别保存 `email`、`wechat_web`、`wechat_miniapp` 身份，唯一键为提供方与外部标识。
- Web 使用随机、可撤销、仅服务端可读的 `HttpOnly + Secure + SameSite=Lax` 会话 Cookie；小程序使用随机不透明令牌，数据库只保存令牌摘要和过期时间。
- 邮箱密码使用 Argon2id；找回密码与邮箱验证使用一次性、短期有效、数据库只保存摘要的令牌。
- 小程序把 `wx.login()` 的一次性 code 发送给服务端，由服务端调用 `code2Session`；`AppSecret` 与 `session_key` 永不下发客户端。
- Web 微信扫码与小程序身份只有在完成重新验证和明确确认后才绑定同一账户；两个已有数据账户拒绝合并。
- 用户模型 Key 使用部署主密钥进行 AES-256-GCM 信封加密；API、日志和错误响应不回传完整密钥。

### 3.2 业务数据

最小表集合如下：

- `accounts`, `login_identities`, `sessions`, `email_tokens`
- `conversations`, `messages`, `message_attachments`
- `books`, `book_files`, `book_sections`, `reading_positions`
- `highlights`, `notes`
- `ppt_drafts`, `ppt_outline_nodes`, `ppt_tasks`, `ppt_pages`, `ppt_artifacts`
- `service_connections`, `model_credentials`
- `trial_grants`, `cost_ledger`
- `job_events`

所有用户数据表必须带 `account_id`；所有更新使用资源版本号或条件更新阻止旧请求回写。作品与历史成功任务不可被失败任务删除级联影响。

### 3.3 状态机

PPT 草稿阶段固定为：

```text
requirements -> outline -> template -> submitted
```

PPT 任务运行状态固定为：

```text
queued -> running -> completed
                  -> failed
                  -> stopped
```

- 同一 `conversation_id` 最多一个 `running` AI 回答或任务；数据库约束与事务共同执行互斥。
- `POST /ppt-tasks` 必须携带草稿版本和幂等键；重试返回原任务，不创建重复任务。
- Worker 使用租约、心跳和有限重试；进程重启后可重新领取过期租约。
- 停止任务只设置取消请求；Worker 在页面边界检查，保留已完成页面与草稿。
- 失败任务不进入作品列表；删除失败任务只删除其临时页与任务记录。

## 4. API 契约

API 使用 `/api/v1`，错误统一为：

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

首个上线版本只保留以下资源组：

- `/auth/*`, `/account`, `/account/identities`
- `/conversations`, `/conversations/:id/messages`
- `/books`, `/books/:id/file`, `/books/:id/sections`, `/books/:id/position`
- `/books/:id/highlights`, `/books/:id/notes`
- `/ppt-drafts`, `/ppt-drafts/:id/outline`, `/ppt-tasks`, `/ppt-tasks/:id`
- `/ppt-artifacts/:id/download`
- `/service-connections/weread`, `/model-credentials/text`, `/model-credentials/image`
- `/trial-grant`, `/health/live`, `/health/ready`

上传与下载使用短时效签名 URL；客户端不通过 API 进程转发大文件。任务进度由两端统一轮询，前台活跃时每 `2s`，后台或非末尾浏览时降为 `5s`；MVP 不引入 WebSocket 或 SSE。

## 5. 内容与外部适配器

### 5.1 本地书籍

- 第一批支持 `EPUB`、`TXT` 和带文本层的 `PDF`；同一导入入口处理格式差异。
- EPUB/TXT 生成章节与稳定定位；PDF 优先提取文本，只有页面图像时保留文件与失败原因，不在 MVP 引入 OCR。
- 原文件先入对象存储，再由 Worker 解析；解析成功后事务性发布新版本，失败不影响既有书架。
- 搜索先使用 PostgreSQL 标题、作者与来源字段；MVP 不建设全文搜索服务。

### 5.2 模型与联网资料

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

- MVP 只接一个部署时指定的 OpenAI-compatible 文本模型提供方；前台只收集 API Key，不暴露提供方、端点或模型高级配置。
- 平台免费体验与用户自有 Key 复用同一适配器，凭证来源不同；每次平台调用在提交前预占成本、完成后按实际值结算，账户累计硬上限为 `¥5`。
- 图片模型是可选增强；没有图片模型时，PPT 模板必须依靠形状、字体、线条、色块和用户已有图片生成完整页面。
- 联网补全提供方必须在开发阶段单独获得服务、预算和调用范围授权；未获授权时不执行真实联网调用，也不把本地内容不足的结果描述为完整全书分析。

### 5.3 微信读书

```ts
interface WeReadAdapter {
  validate(skillKey: string): Promise<WeReadAccount>;
  syncBooks(connectionId: string, cursor?: string): Promise<WeReadSyncPage>;
  syncAnnotations(connectionId: string, bookExternalId: string): Promise<WeReadAnnotation[]>;
}
```

Skill Key 的实际供应方协议、限流、错误码和数据字段必须以实施时取得的正式接口资料和真实沙箱响应为准；在此之前只实现适配器契约、假服务与失败保留，不猜测私有接口。

## 6. PPTX 生成

- 先提供 `celadon-reading`、`editorial-paper`、`minimal-ink` 三个内置模板；每个模板由 `16:9` 母版、标题页、章节页、正文页和结束页组成。
- 大纲节点在服务端验证层级和页数；页数只按一级页面节点计算。
- Worker 先生成逐页文案，再由确定性布局器计算文本框、形状、图片和安全边距，最后由 PptxGenJS 导出。
- 文本使用 `fit: shrink` 和最小字号下限；超过下限时任务失败并返回修改大纲，不静默裁切。
- 每页先生成与客户端无关的布局描述，再由 SVG + Sharp 输出 PNG 预览、由 PptxGenJS 输出 PPTX；两种产物共享同一布局输入，避免两套内容和坐标漂移。
- 发布候选必须用真实 PowerPoint 与 WPS 打开至少三份含中文、长标题、图片和无图片版本的 PPTX，检查可编辑对象、字体替代、比例、溢出与再次保存。

## 7. Harness 与发布

| 层级 | 本项目证据 |
| --- | --- |
| H0 | 格式、Lint、TypeScript、生产构建、数据库迁移检查 |
| H1 | 领域状态机、账户绑定、成本上限、幂等、模板布局单元测试 |
| H2 | PostgreSQL、对象存储、Worker 重启恢复、上传与下载集成测试 |
| H3 | 浏览器与微信开发者工具从登录到 PPTX 下载的真实用户路径 |
| H4 | 经授权的微信登录、微信读书、文本模型、联网检索与可选图片模型 |
| H5 | Staging 迁移、生产镜像、合法域名、备案 / 审核、冒烟与回滚演练 |

上线采用邀请制 Beta：先发布同一生产后端和桌面 Web，再提交同一候选版本的小程序审核；两端 H3 完成、适用 H4 获授权且 H5 通过后才称为 MVP 上线。发布前必须具备隐私政策、用户数据导出 / 删除处理流程、备份与恢复验证、日志脱敏、费用告警、任务队列积压告警和一键回滚到前一镜像 / 前一兼容迁移的操作手册。

## 8. 明确不做

- 不建设通用任务 UI、任务市场、插件系统、多 Agent 编排或 Prompt 管理后台。
- 不建设多组织、多角色、RBAC、付费订阅、积分或营销系统。
- 不支持多书 PPT、逐页 PPT 编辑、在线协作、评论或版本树。
- 不做 OCR、Embedding、向量数据库、全文搜索服务或推荐系统。
- 不做 Redis 缓存、实时消息总线、WebSocket、微服务拆分或多区域部署。
- 不把探索稿、参考图整图或生成图中的头像、图标和文字作为运行时素材。

这些能力只有在真实用户数据证明当前架构成为瓶颈，或产品规格明确扩展后才重新评估。
