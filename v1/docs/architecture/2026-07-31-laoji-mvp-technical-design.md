# 老己 MVP 技术设计草案

- 版本：MVP v0.1
- 状态：方案草案，阶段 0 验证后定稿
- 日期：2026-07-31

## 1. 架构目标

技术架构服务于一条垂直闭环：同步或导入书籍，保存来源内容和用户笔记，生成并导出可编辑 PPTX。架构必须把来源差异、AI 供应商差异和 PPT 产物边界隔离开，避免后续增加技能时重写阅读和作品数据。

## 2. 系统边界

```text
+------------------+       +----------------------+
| Responsive Web   | ----> | Netlify Web/API      |
| Chat / Library   |       | Functions / Jobs     |
| Reader / PPT UI  |       +----------+-----------+
+------------------+                  |
                                      v
                 +--------------------+--------------------+
                 |                    |                    |
                 v                    v                    v
          Auth / Database      Object Storage       External Adapters
                                                   /       |        \
                                                  /        |         \
                                           WeRead API  AI Providers  Image Service
```

Netlify 是首选部署目标，但 Netlify Functions 不应直接承担长期数据存储、密钥管理和大型异步任务。数据库、对象存储、密钥加密和任务队列需要在阶段 0 根据大陆访问、成本和合规要求选择独立服务。

## 3. 领域边界

### 3.1 核心实体

- `User`：账户和身份。
- `AiProviderConfig`：用户当前生效的供应商、加密 API Key、验证状态和能力快照。
- `WeReadConnection`：用户的微信读书 Skill Key 加密凭证、连接状态和最近同步时间。
- `Book`：统一书架中的书籍记录，包含 `sourceType` 和来源标识；同名不同来源不自动合并。
- `BookSource`：微信读书同步或本地导入的来源适配信息。
- `SourceContent`：微信读书同步内容、本地书原文及位置/作者/来源引用；只读。
- `Highlight`：用户在本地书创建的阅读高亮和位置锚点；可取消，但取消不级联删除关联笔记。
- `UserNote`：用户私有老己笔记；正文可编辑，记录可删除，并可保留只读来源引用和内部定位元数据。`targetType` 仅用于内部定位，不作为用户可见分类或填写项。
- `PptMaterial`：经过用户选择、可送入大纲生成的来源内容或用户笔记引用。
- `PptProject`：一本书的一次 PPT 生成任务和其编辑状态。
- `SlideSpec`：HTML 预览和 PPTX 生成共用的结构化大纲。
- `PptArtifact`：可预览、下载、再次打开的 PPTX 产物及其来源引用。
- `SyncJob` / `GenerationJob`：可重试的外部同步和 AI/PPT 任务。

### 3.2 来源能力

不要在业务代码中只用 `if sourceType === ...` 决定页面行为。书籍来源应暴露能力集合，例如：

```text
fullTextReadable
preciseHighlightable
syncProgress
syncPersonalNotes
syncPublicReferences
removable
```

页面根据能力展示操作；PPT 和笔记通过统一引用接口消费来源内容。

## 4. 内容和笔记模型

来源内容和用户笔记分开保存：

```text
SourceContent
  id, sourceType, externalId, bookId
  text, author, location, sourceUrl, readOnly

UserNote
  id, bookId, targetType(book/chapter/highlight), targetId
  body, sourceContentId, quoteSnapshot, createdAt, updatedAt

PptMaterial
  id, bookId, contentRef, noteRef, materialType
  provenance
```

`UserNote.body` 可由用户修改；删除 `UserNote` 只移除该条用户笔记，不级联删除关联的 `SourceContent`、`Highlight` 或 `Book`。引用型笔记编辑后继续保留原来源引用，来源字段始终只读。取消 `Highlight` 只移除阅读高亮；已有引用型笔记继续保留原文快照和位置。

公开参考素材必须保留来源和作者信息。任何 AI 提示词和 PPT 大纲输入都不能只保留无来源的纯文本副本。

## 5. 文档阅读和跨页划线

### 5.1 EPUB

- 使用成熟 EPUB 解析/阅读组件展示章节和文本层。
- 将选区转换成章节、段落和字符偏移锚点。
- 保存规范化文本快照，支持重新渲染后恢复高亮。

### 5.2 文字型 PDF

- 使用成熟 PDF 渲染和文本层方案，不从截图或 OCR 伪造选区。
- 为每页建立文本层和文档级连续字符偏移。
- 跨页选择时将起止页、页内范围、文档全局偏移、规范化原文和必要的几何框一起保存。
- 重新打开时优先使用页面/字符锚点恢复，恢复失败则显示需要重新定位的状态，不静默标错。
- 无文本层、加密、扫描或文本顺序损坏的 PDF 在导入阶段标记为不支持精准划线。

跨页选区必须通过阶段 0 的多页真实样本文档验证后，才进入正式开发。

## 6. AI 供应商适配

统一能力接口，不让前端感知供应商具体模型名：

```text
verifyCredential(provider, key)
detectCapabilities(provider, key)
generateText(provider, request)
understandImage(provider, request)
generateImage(provider, request)
```

每个供应商适配器维护文本、图片理解、图片生成、权限、限额和错误映射。能力检测结果带验证时间，不作为永久事实。

AI API Key：

- 只在服务端接收和调用；
- 数据库存储加密密文，前端只拿掩码和状态；
- 日志不得输出明文 Key、完整请求头或敏感内容；
- 支持验证、替换、撤销和失败重试；
- 用户没有 Key 时，阅读和笔记路径不调用 AI。

## 7. 微信读书适配

微信读书适配器负责：

- 凭证验证；
- 书架/进度/统计同步；
- 个人内容和公开内容归一化；
- 增量同步和失败重试；
- 来源字段、作者和引用标识保留。

它不负责全文阅读，也不向微信读书回写用户笔记或公开内容。公开内容默认只读，用户显式选择后才生成 `PptMaterial`。

所有接口字段、频率限制、保存同步数据的条款和商业使用边界在阶段 0 形成验证记录。

## 8. PPT 生成链路

```text
Book / SourceContent / UserNote
              |
              v
        PptMaterial 选择
              |
              v
        LLM -> SlideSpec
              |
              v
       用户编辑和确认 SlideSpec
              |
       +------+------+
       v             v
 HTML Preview   PptxGenJS Renderer
                     |
                     v
                PptArtifact
```

`SlideSpec` 是预览和 PPTX 的唯一内容源，至少包含页面顺序、标题、正文、来源引用、布局、图片提示和可编辑元素。渲染器失败不应丢失大纲和用户修改。

图片生成是独立能力：优先调用当前供应商，失败或不支持时调用平台图片服务；需要配额、超时、重试和无图降级策略。

## 9. 关键 API 形态

以下是逻辑接口，不锁定具体框架路由：

```text
POST /api/ai/verify
GET  /api/ai/capabilities
POST /api/weread/verify
POST /api/weread/sync
GET  /api/books?query=&source=
POST /api/books/import
GET  /api/books/:bookId
POST /api/books/:bookId/notes
PATCH /api/notes/:noteId
POST /api/ppt/projects
PATCH /api/ppt/projects/:projectId/spec
POST /api/ppt/projects/:projectId/generate
GET  /api/ppt/projects/:projectId/artifacts
```

接口必须返回明确的状态和可恢复错误，不把第三方原始错误直接暴露给用户。

## 10. 异步状态

同步和生成任务统一使用：

```text
idle -> queued -> running -> succeeded
                         \-> failed -> retryable / terminal
```

前端保留用户上下文和已编辑内容；重试不能重复创建不可区分的书籍、笔记或 PPT 作品。

## 11. 测试与验收

### 阶段 0

- 真实微信读书 Key 的服务端调用和字段记录；
- 供应商能力矩阵和错误映射；
- EPUB 选区恢复；
- 多页文字型 PDF 跨页选区、重载恢复和不支持识别；
- PPTX 打开、文字编辑、形状编辑、图片替换和来源引用检查。

### 阶段 1

- 注册、跳过 Key、按需配置和撤销；
- 两类书籍统一书架、来源语义与本地导入折角、搜索和无结果状态；
- 微信读书未连接、本地导入、同步失败、导入失败状态；
- 笔记关联元数据、个人/公开内容权限，以及老己笔记编辑、删除不影响来源内容的边界；
- 大纲生成、修改、确认、失败重试和 PPTX 导出；
- 桌面端和手机端核心流程；
- 不支持 PDF 的提示不允许继续进入“精准划线”承诺流程。

## 12. 部署与合规前提

- 首选 Netlify 部署前端和轻量 API。
- 暂无域名和 ICP 备案，不能承诺中国大陆访问稳定性。
- 外部数据库、对象存储、加密密钥管理和长任务服务需要单独选择并做大陆访问测试。
- 微信读书同步数据、用户上传书籍和 AI Key 都属于敏感资产，需要数据最小化、加密、删除和访问控制。
