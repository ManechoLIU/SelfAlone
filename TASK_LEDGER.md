# SelfAlone 任务台账

> 本文件是唯一执行控制面，只记录当前目标、工作包、状态、阻塞、下一步、验收和证据。行内边界与验收只做执行摘要，不能新增或修改产品、视觉、技术规则；对应定义分别以 [`redesign-v2/SPEC.md`](redesign-v2/SPEC.md)、[`redesign-v2/DESIGN.md`](redesign-v2/DESIGN.md)、目标端规范、[`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 与 [`redesign-v2/TECHNICAL.md`](redesign-v2/TECHNICAL.md) 为准。

## 1. 当前目标与执行入口

- 当前 Goal：`CONTROL-RESET-1` 取得三个可共同检查的执行恢复点：`M1-WEB-SHELL-01` 修正候选、`M1-F2-D-TEXT` 私有 Web 候选的非作者复验裁决与入口释放判断、`M2-F0-A-SCREEN-ADAPT-ALL` 全端修正候选或真实阻塞裁决。该 Goal 不代表项目或任一模块完成。
- 当前阶段：`M1-F2-A` 只保留本地导入 / 书架功能 `DONE`，本轮独立审查已将视觉门重开为 `FAIL / REWORK`；`M1-F2-B` 仍为 `VERIFY / VISUAL REOPEN`，`M1-F2-D` 存在明确功能缺口。桌面对话 `M1-F3B-A～D / V1` 均未开发，当前 M0 / 演示页、fixture 或假适配器不得登记为 F3B 成果。M2-F0-A 已取得全端 `DESIGN-READY` 合同并进入六页 / 共享层系统返工；conversation / drawer、Reader swipe、账户 / 书架与 Reader viewport layers 已各有局部冻结点，但完整视觉、状态矩阵与 H3 外部门均未通过。
- 当前拆分：M1-F2-D 已按真实依赖拆为文本先行的 `D-TEXT`、等待 PDF 页面能力的 `D-PDF` 与不依赖 PDF 的详情 / 作品入口 `D-ENTRY`，不再因 C 未完成冻结全部 D。全项目审计按用户可见闭环分类真实完成度；UI/UX 先审读书 / 对话共享外壳和交互，再交唯一实现者。M2 继续按客户端独立能力与真实上游分别解锁，M3 保持模块级父项。
- 台账自适应：当前以“建设按可独立验收功能闭环、验收按真实业务 Case”作为默认粒度，不冻结现有行数或顺序。若频繁等待、重复回写、机械项没有独立验收价值，或台账维护成本已经超过执行收益，执行任务应主动合并、重排或精简条目；若风险、返工面、事实冲突或下一步不清楚，则主动拆细。普通结构调整无需询问用户，但必须保留真实依赖、活动项负责人 / 写入边界、验收证据、恢复点、下一步与授权门，且不得借调整台账改变产品范围或把未完成项标为 `DONE`。
- 唯一主线：本地 `main`；本轮治理链已纳入主线，后续只从 `main` 当前 HEAD 续接并在开始前重验。其他工作树保持只读，不作为开发目录或当前功能证据。
- 当前执行波次：`CONTROL-RESET-1`；Desktop 共享壳已冻结为 `6afd@9638d12`，Mini drawer / Reader 返工已冻结为 `f312@a0e98f9`，两条互不重叠的 FINAL 审查已并行拆分，不得因作者测试或截图直接合并。D-TEXT `d65ab3b` 已获非作者 `PASS WITH RECEIPT CAVEATS`，排在 Desktop 释放 `main.ts` 后做 Web 入口集成；不代表父项 DONE 或完整视觉 PASS。台账仍由项目总控独占。
- 当前活动项：Desktop 非作者 FINAL 已结束并判 `9638d12 = FAIL / REWORK`；两个 P1 为 1200px 品牌 / 设置文案断行，以及六阶段视觉 current 缺少 `aria-current="step"`。项目总控自己的 `/root/desktop_shell_m0_fix` 已从 completed 重新触发并由协作工具确认 `running`，只拥有 `styles.css`、`ui/desktop-shell.ts`、`conversation-view.ts` 及必要定向测试，从 `9638d12` 最小承接，不碰 Reader / D-TEXT / 台账。`/root/mini_visual_final_review` 同时保持 `running`，只读审 Mini `a0e98f9` 与 `IMG-04`；固定 f312 HEAD、保护差异与哈希已由总控复核一致。D-TEXT reviewer 已完成并释放；入口 writer 仍须等 Desktop 通过并完成 main 复验后再创建。
- 协调下一动作：Desktop writer 冻结最小修正候选后，原 UI/UX 只复验两个 P1 与既有不回退矩阵；PASS 才由总控顺序集成完整 `0969c33..新 HEAD`、在 main 以在线隔离 API 复验，随后释放 `M1-F2-D-TEXT-WEB-ENTRY`。Mini / IMG-04 verdict 并行返回后，PASS 才审查并集成完整 `ff4767b..a0e98f9`，由唯一集成者重建最小 lock importer；FAIL 则返回唯一 Mini writer。保护差异与 H3 阻塞不变；不得只摘末提交或把 `IMG-04` 候选当运行时资产。
- 当前授权边界：已获本地连续开发、验证合格后合并回本地 `main`，以及最多 20 次外部图片生成调用额度；额度只按实际发生的调用计数，预登记不扣减。每次调用必须记录模型 / 提供方、次数或张数、尺寸、用途、输出目录与累计余额，生成物先为 `CANDIDATE`，只有实装和真实浏览器对照通过后才能升级。产品或视觉事实源发生无法消解的实质冲突、重大功能 / 信息架构 / 核心流程变化、大范围返工选择，以及超出 20 次额度、其他付费或外部服务与凭证、push、PR、发布、部署、删除及其他难恢复动作仍须单独确认；远端 push 不是完成条件。

### 1.1 项目总控、台账所有权与证据入口

- 唯一持续项目总控：任务 `01a034b4-a73d-7ce2-8531-51585826e6d3` 的早期“仅管理台账”定位已由用户后续确认覆盖；当前以 `adaptive-delivery` 为持续运行合同，在独占台账写入之外负责总目标、需求影响扫描、阶段与真实依赖、动态拆分、执行 / QA / 非作者审查调度、设计前置门、共享契约与写入边界、候选集成、冲突处理、本地 `main` 复验和最终验收；实现继续交给边界互斥的执行者，不为每份文档或每个小问题创建独立管理 Agent。
- 台账最终写入权：项目总控独占 `TASK_LEDGER.md` 写入、提交与状态裁决。开发、审查和素材任务原则上不得直接修改、提交或重排台账，只提交证据与建议，由项目总控独立核验后写入。
- 文档治理：项目总控按根 `AGENTS.md` 的既有职责映射核对一致性，只把产品、视觉、技术、确认素材和协作规则留在各自事实源；台账只记录执行控制信息，不复制规则或制造平行文档。事实源需要改动时由对应执行范围的明确写入者完成，总控审查实际 diff，不按文档逐个新建管理 Agent。
- 统一通道：向 `codex://threads/01a034b4-a73d-7ce2-8531-51585826e6d3` 提交工作包 ID、仓库 / 工作树 / 分支 / 基线与 HEAD、精确 status / diff、目标与非目标、测试命令与结果、真实业务 Case、浏览器或 Computer Use 证据、非作者审查、阻塞、下一步、提交 / 集成状态、授权需求；有图片生成时另附提供方 / 模型、实际调用次数与张数、尺寸、用途、输出目录、哈希 / 透明度、候选结论和累计余额。
- 紧急恢复例外：只有不立即写入就会丢失恢复点、误触授权边界或造成并行覆盖时，开发任务才可临时写台账；必须同时说明原因、精确 diff、恢复点和未走专职通道的理由，并交本任务复核。未经复核不得据此升级状态或称 `DONE`。
- 当前交接：`47b4` 的未提交 `TASK_LEDGER.md` diff 已只读核对；其中与 `main` 重复的自适应规则不重复吸收，状态和证据按当前仓库、实现任务正式交接与文件元数据重写。原 diff 保留在该工作树，禁止覆盖或擅自提交。
- 当前 UI/UX 审查：替代任务 `01a03652-a5d4-76c1-b0fa-ff9303243664` 已在真实存在且 clean 的 `/Users/echoman/.codex/worktrees/27df/SelfAlone@b38ed4d` 完成书架、EPUB / TXT 与旧 M0 的真实 Chrome 首轮审查，结论均为 `FAIL`；证据目录共 `27` 张新鲜截图，位于 `/Users/echoman/.codex/visualizations/2026/08/25/01a03652-a5d4-76c1-b0fa-ff9303243664/selfalone-ui-audit-b38ed4d/`，`1440 / 1200 / 1024 / 768×844 @ 100% / DPR1` 只作自动化补充，不能替代 DPR2 终验。该任务保持非作者、仓库零写入并转为 idle，候选返回后复用其做真实端复验。
- 视觉工作包释放门：任何 UI 写入者开工前必须取得该包的 `DESIGN-READY` 收据，逐项登记绑定参考路径 / SHA / 确认层级与采用点 / 排除项、最近语义组件派生、Token / 几何 / 密度、正式运行时资产、页面 / 状态 / 宽高 / 安全区 / 键盘矩阵、禁止自由发挥项、文件所有权、首屏截图检查点和停止条件，并先取得非作者可执行 brief；缺任一项、缺 brief 或找不到可靠派生源时只允许非视觉工作继续，视觉实现保持 `BLOCKED`。具体规则仍只从 `DESIGN*` 与参考索引读取，本台账不复制。
- 视觉验收门：取得 `DESIGN-READY` 后才能进入视觉 `ACTIVE`；第一个可运行界面立即进入 `EARLY-VISUAL-VERIFY`，提交同状态真实端截图，`FAIL` 即返修，不等待功能全部完成；冻结候选进入独立 `FINAL-VISUAL-VERIFY` 并跑完整矩阵。收据必须同时记录 revision、URL / 端侧入口、viewport、zoom、DPR、截图物理像素和参考 SHA。开发者不得自审通过；非作者报告若缺逐页 / 逐状态 `covered / uncovered`、实际参考与真实端候选或只给总体结论，总控拒收并补齐原系统包；测试 / build / HTTP 200 / 静态图 / 局部交互均不能替代。
- 当前系统影响裁剪：小程序抽屉、会话输入 / 键盘、阅读操作层与内容面板均影响多个页面或共享组件，统一留在 `M2-UX-CONTRACT-ALL` 做系统影响扫描和合同，不按单条用户反馈继续拆局部视觉包；同一视觉根因再次影响两个及以上页面时回到该系统包重裁范围。`f312` 的非视觉 H3 修复不受此门阻塞，受影响视觉文件只由原唯一写入者在对应合同完成后顺序修改。
- 当前绑定关系：`02-conversation-and-scope.png`（SHA-256 `d84ffbae4a483be35c4c9c32192c05aa6e1ae111c966c6ee01599bcb28fd94f6`）约束桌面对话及读书 / 设置 / PPT 的共享外壳；`03-reading-library.png`（SHA-256 `3cee650a3125fa337d8c0f2eddfe21c6b34d1856d7b45cb9abda939be303da98`）约束统一书架。首轮 brief 已确认旧 M0 / 对话与读书割裂、书架进度语义 / 密度、阅读稳定状态骨架及选区沉淀入口均 `FAIL`；A 仅保留功能 `DONE`，视觉门已重开。

### 1.2 全项目真实完成度首轮审计

- 固定审计快照为 `main@263d3e2`；审计期间产生的 `b38ed4d` / `dbe5231` 仅修改本台账，不改变产品实现。两个既有未跟踪视觉候选目录只读排除，其他工作树、候选提交、共享数据库和 fixture 均未计入 main 完成度。
- 按 25 个用户可见路线包分类：完整并真实验收 `2`（其中 `M0` 只是开发基线，唯一真实产品闭环是 `M1-F2-A` 书架 / 导入子包）、已实现但未验收 `1`、半成品 `2`、假数据 / 占位 `5`、缺功能 `8`、真实阻塞 `7`。按当前可独立验收执行行统计，仍有至少 `40` 个未完成或未完全验收工作包；M3 尚未展开，实际余量只会增加。
- 直接结论：`M1-F2-B` 保持 `VERIFY`；PDF、文本 / PDF 笔记、书籍详情、owner / 跨端、账户设置、模型配置、F3B 对话、免费额度、真实 PPT、小程序真实 API 与发布均未完成。当前未知 hash 落入的 M0 workspace 使用固定 development account / conversation / book / draft，只能算演示；小程序候选的 DevelopmentClient / 内存 books / position / PPT 状态只能算占位或半成品。
- 依赖纠偏：文本笔记、书籍详情、本地邮箱认证、owner 契约、模型配置本地门、确定性额度 / 成本账本、PPT 工作区状态合同和小程序客户端状态都可在无真实凭证下继续；真实 PDF 渲染、微信登录、微信读书、真实模型、Presenton、办公软件兼容、双端 V1 和发布继续保留授权 / 环境门。

## 2. 路线图与父级功能组（模块级导航，非执行项）

| 功能组 | 汇总状态 | 可交付边界 | 释放条件 / 下一步 |
| --- | --- | --- | --- |
| `M0` 可运行基础 | `DONE` | 工作区、健康检查、确定性本地 PPT 基线 | 证据提交 `2b639e0` |
| `M1-F2` 桌面书库、阅读与笔记 | `ACTIVE` | 本地书导入、阅读、记录、详情与账户隔离 | A 仅书架 / 导入完成；B `VERIFY`，C 半成品，D-TEXT 共享接缝已合入但用户可见 Web 缺失，D-ENTRY 与 E-OWNER 已释放 |
| `M1-F1` 桌面账户与设置 | `READY` | 邮箱身份、会话与账户设置闭环 | 本地邮箱 / 会话可先做；owner 接缝由 `M1-F2-E-OWNER` 顺序冻结，不等待完整 `M1-F2-V1` |
| `M1-F3A` 模型配置 | `PENDING` | 文本 / 图片模型安全配置闭环 | `M1-F1-V1` |
| `M1-F3B` 桌面对话与 AI | `PENDING` | 会话、图文消息、选择与书籍上下文 | `M1-F3A-A` 本地门；图片能力按需使用 F3A-B |
| `M1-F4` 免费体验与成本 | `PENDING` | 一次性领取、成本硬上限与恢复 | `M1-F3B-V1` |
| `M1-F5` 桌面 PPT 与真实 PPTX | `PENDING` | 单书四阶段、恢复、作品与可编辑 PPTX | `M1-F4-V1` |
| `M1-V1` 桌面真实闭环 | `PENDING` | 同一账户从登录到可编辑 PPTX | M1 全部功能组 |
| `M2` 微信小程序与双端闭环 | `ACTIVE` | 客户端可独立的运行壳、状态与视觉先行；真实身份、书籍、阅读持久化、会话、额度和 PPTX 按上游能力逐项接入 | `M2-F0-A` 已释放；完整双端 V1 仍依赖对应 M1 能力、真实开发者工具 / 真机与外部授权 |
| `M3` 邀请制发布 | `PENDING` | 隐私、恢复、监控、Staging、Web 和小程序发布 | `M2-V1`；执行前再展开并取得授权 |

## 3. 当前阶段可执行台账（功能闭环；`V1` 为验收场景）

### 3.1 `M1-F2` 桌面书库、阅读与笔记

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F2-R1` | `DONE` / 主 Agent | 将 `0204` 识别为早期设计探索工作树并只读排除；不修改、搬运、清理或提交其中内容 | 2026-08-24 重验为 38 项：37 项与当前链逐字节一致，唯一剩余是已被 `TASK_LEDGER.md` 替代的旧 `PROJECT_STATUS.md`；状态变化时重验 | DOC、Git / worktree | 核对 HEAD、status、相关 diff、路径逐项字节比较和参考索引；没有唯一未吸收实现或有效视觉事实 | `0204` @ `9783628`，status SHA-256 `3bbbcce3b92620050889bc94dc38b49163bf75a80462caa0208a4dfbe1e79cbb`；保持只读排除 |
| `M1-F2-R2` | `DONE` / 主 Agent | 统一 EPUB / TXT / PDF 导入与界面；PDF 有文本读文本，无文本但页面可渲染则显示页面图，全部不可渲染才失败；不实现阅读器、不引入 OCR | 既定产品规则不变；实现若需要付费服务、伪造正文或改变视觉时暂停 | DOC、候选只读 | 覆盖文本、图片、加密、损坏、单页失败和全部不可渲染 PDF；审查 `SPEC`、`TECHNICAL`、候选 `67d77d7` 差异与链接 | 技术边界写入 `TECHNICAL.md`；候选拒绝图片型 PDF，仅可作为文本能力种子 |
| `M1-F2-A` | `DONE(function) / FAIL(visual)` / 项目总控 | 本地 EPUB / TXT / PDF 导入、账户归属、解析状态、元信息、动态封面与桌面统一书架功能闭环；不代表视觉或读书模块完成 | UI/UX 首轮确认 ready 书仍显示解析状态而非阅读进度、工程服务文案和稀疏数据不能证明 03 的两排五列密度，视觉门重开 | main 已集成功能；后续唯一书架视觉写入者在共享外壳包冻结后释放 | 保留既有真实导入 / 五态 / 搜索证据；新门为至少 10 本、封面内未开始 / 已读百分比、03 同屏、4 视口、DPR2、键盘 / console / overflow 与非作者复验 | 原回退点 `86a8fb1` 保留；旧视觉 PASS 被本轮最新真实审查覆盖，仅功能结论有效 |
| `M1-F2-BC-S1` | `DONE` / 项目总控 | 冻结文本 / PDF 共用的文件版本、稳定定位、阅读位置、API、schema 与模块接缝；不实现阅读 UI | 生产 PDF 渲染依赖仍是 C 完整页面能力的授权门，不阻塞 B 或 C 的安全首包 | `packages/contracts`、迁移、`app.ts` / `index.ts`、共享 Web 入口 / 样式与 Worker 注册只由总控写 | `fileVersion`、文本 `sectionId + offset`、PDF `pageNumber`、复合 owner 外键、条件更新 / `STALE_VERSION`、缓存版本互不混用 | `44b81ea` 已写入 `TECHNICAL.md` 5.1.1；B / C 已从该提交分开释放 |
| `M1-F2-B` | `VERIFY / VISUAL REOPEN` / 项目总控 | EPUB / TXT 正文、目录、复制、全书位置、专注模式和浅 / 深阅读背景已有可复用实现；不含 D 的划线 / 想法 / 笔记 | focus 子合同仍 PASS；本轮 UI/UX 新增确认 loading / failure 会破坏稳定 shell / 书籍上下文，原生 200%、DPR2 精确视口和完整沉淀链仍未通过 | main 已集成 `804f952 → e971ace → ed04dd4 → 08ff046`；阅读 Web 后续由总控在 D 私有接缝冻结后分配唯一写入者 | 保留真实 TXT / EPUB、位置 / 重启、浅深 / 目录 / 专注 PASS 子项；新门为稳定状态骨架、选择工具、详情往返、原生 200%、DPR2 与非作者复验 | main 恢复点 `08ff046`；UI/UX task `01a03652-a5d4-76c1-b0fa-ff9303243664` 已给 FAIL brief，待新候选复验 |
| `M1-F2-B-UX1` | `DONE / FOCUS PASS` / 历史审查结论 | 浅 / 深阅读私有侧栏、无固定桌宠、首帧、焦点、滚动、TXT、复制反馈与完整专注可聚焦集合的非作者合同已闭合；不实现 | 固定 `804f952` 的专注合同已通过；PDF 页面一致性只锁视觉合同、不冒充当前实现，父项 B 的原生 200% / 精确视口门继续保留 | 当前系统级审查由有效任务 `01a03652-a5d4-76c1-b0fa-ff9303243664` 在 `27df@b38ed4d` 执行，不重开已通过的 focus 结论 | 浅 / 深专注中 rail / toolbar 从视觉、命中、Tab 与 AX tree 退出；三控件、Selection / Range、scrollTop、Esc 恢复、console / overflow 均通过 | 允许集成 `804f952`；完整视觉 verdict 为 `VERIFY`，缺失证据仍保留 |
| `M1-F2-C` | `ACTIVE / VERIFY`（安全首包已集成）/ 项目总控 + 后续待分配 | 文本型 / 图片型 PDF 页面阅读的解析 / 渲染、安全、缓存、恢复与页锚点基础；不 OCR、不伪造正文 | `7856a7a + 059b0ec` 已以 `d7e5ee6 + 589a22b` 合入；真实页面渲染仍需生产依赖、许可证和 Worker 资源授权，不能称 C 完成 | 已集成的 `pdf-reader*` 与 C 证据作为恢复点；共享 contracts / schema / app / Worker / Web 仍由总控在后续包分配单一写入者 | 安全首包覆盖真实样本元数据、部分页失败、过期租约重启、缓存键隔离、旧版本拒绝和异常租约释放；完整门另需 owner / fencing、持久化恢复、续租 / 超时 / 取消、真实渲染、DB / API / Web 与浏览器 | 非作者修复复审 `PASS`；main 定向 3 文件 / 17 项、`pnpm verify` 16 文件 / 67 项通过。`pdfjs-dist@6.2.108` + `@napi-rs/canvas@1.0.8` 仅为待授权推荐 |
| `M1-F2-D` | `ACTIVE` / 项目总控 | 正文标注、想法、手工老己笔记、引用到会话、书籍详情和作品入口父闭环；不含 AI 整理笔记 | 按文本、PDF、入口真实依赖拆分；子项未全部通过前父项不得 `DONE` | 总控独占共享 contracts / schema / route / entry；子项互斥写入 | 文本 / PDF 均能可靠回原文，笔记持久化与 owner 隔离，详情 / 作品入口和五类状态通过 | `D-TEXT` 共享接缝已合入、Web 入口排队；`D-PDF` 等 C，`D-ENTRY` READY，引用到会话等 F3B 真实会话合同 |
| `M1-F2-D-TEXT` | `VERIFY / FROZEN d65ab3b / NONAUTHOR PASS WITH RECEIPT CAVEATS / ENTRY QUEUED` / `/root/reading_text_notes_web` | EPUB / TXT 可靠 locator 上的划线、想法与无标题手工老己笔记 CRUD；保存失败保留草稿 | `dtxtui@d65ab3b` clean；21 文件只含 13 个私有实现 / 测试、7 张图与 acceptance README。定向 5 files / 42 tests、全仓 30 files / 146 tests、typecheck / build / diff-check 全绿；当前 HEAD 真实 Chrome 覆盖 1440×844 DPR2 的 TXT / EPUB、划线 / 想法 / 刷新、无标题笔记 CRUD、tabs / hidden / inert / focus、浅深 / 专注、双页 409 保留输入重试、owner 200 / 404、console / overflow | 私有候选冻结；不得写 `main.ts` / shared shell / styles 或共享 contracts / schema。共享入口等待 Desktop shell 释放 `main.ts` 后由总控顺序集成；聊天 handoff 在入口前保持 disabled fail-closed | 非作者允许进入入口集成，不等于父项 DONE / 视觉 PASS。收据 caveat：acceptance README 的截图基线仍写父 `e2a6ac4`；当前 HEAD 未重拍 768，1024 / 1200 / 原生 200% / reduced-motion 未覆盖，真实删除未执行 |
| `M1-F2-D-PDF` | `PENDING` / 待分配 | PDF 页定位上的划线、想法与手工老己笔记 | C 的真实 PDF 页面 / locator / 渲染与持久化仍未完成 | 后续独立 PDF 私有实现；共享接口由总控 | 真实文本型 / 图片型 PDF、页锚点、失败页保留、刷新恢复 | C 页面能力通过后释放，不阻塞 `D-TEXT` |
| `M1-F2-D-ENTRY` | `READY / WRITE-HELD` / 待分配 | 书籍详情、原文件 / 笔记 / 作品入口和五类状态；不实现 PDF 阅读或 AI | UI/UX brief 已给出 07 / 08 / 10 派生与四入口；D-TEXT 私有模块可先准备，但共享外壳仍占用 `main.ts` / `styles.css`，避免同写暂不释放完整入口 | 后续唯一 Web / Server 实现者；不得与 D-TEXT 私有 writer 或桌面对话整改抢共享入口 | 真实书籍、四标签、笔记失败保留、PPT 作品比例、键盘、五态、4 视口、Chrome 与非作者复验 | Web shell 与 D-TEXT 私有候选冻结后立即释放，不等待 C |
| `M1-F2-E` | `ACTIVE / SPLIT` / 项目总控 | 原文件、解析结果、位置、划线与笔记的 owner 契约及跨端真实验收父闭环；不重复开发小程序 UI | 已拆 `E-OWNER` 与 `E-XEND`，避免真实微信身份阻塞本地 owner 合同 | 总控独占共享 contracts / schema / app 接缝；真实端实现分配互斥任务 | owner / 版本 / 旧请求防回写与两端读取分别验收 | 子项全部通过前父项不得 `DONE` |
| `M1-F2-E-OWNER` | `READY` / 待分配 | 为书籍、章节、位置和文本标注冻结会话中立的账户 owner、版本条件写入与迁移回退合同 | A / B 已具备 owner 与位置种子；`D-TEXT` 候选返回后由总控顺序集成，迁移前必须隔离 PostgreSQL | `packages/contracts`、迁移、共享 Server 接缝只允许一个集成写入者 | 两账户、旧 fileVersion、并发写入、未绑定账户隔离；记录 schema / 数据量 / owner / 约束 / 回退点 | 不等待真实邮箱、微信或小程序凭证；通过后释放 F1-A 集成和小程序真实阅读持久化接缝 |
| `M1-F2-E-XEND` | `PENDING` / 待分配 | 两个真实客户端会话读取同一位置、划线与笔记并完成失败恢复 | `E-OWNER`、F1 会话、M2-F1 身份以及 B / C / D 对应内容能力 | Web / Miniapp / API / DB / QA；按端分开写入 | 同账户跨端刷新 / 重开恢复、换号隔离、旧请求不可覆盖 | 真实 AppID / 身份与端侧能力就绪后验收，不反向冻结 `E-OWNER` |
| `M1-F2-V1` | `PENDING` / 待分配 | 一个隔离测试账户完成导入、书架、文本 / PDF 阅读、划线、笔记和刷新恢复 | A～E | QA、DOC | 真实浏览器、真实文件、PostgreSQL 持久化、视觉对照、可访问性和全 diff 审查 | 未产生；作为 F2 父闭环验收，不再反向阻塞已 `READY` 的本地邮箱 / owner 工作 |

### 3.2 `M1-F1` 桌面账户与设置

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F1-A` | `READY` / 待分配 | 邮箱注册、登录、退出、服务端会话和桌面登录 / 注册 UI 的完整闭环；微信入口保持主层级但未授权时 fail-closed | 不再等待完整 `M1-F2-V1`；`E-OWNER` 冻结共享 owner 接缝后顺序集成。候选 `658ba50` 仅作种子；账户迁移冲突时暂停 | CORE、API、DB、WEB、QA；不得与 `E-OWNER` 同写共享 schema / app | 密码摘要、Cookie、安全错误、刷新会话、跨账户隔离；4 视口、键盘和认可视觉 | 本地假邮件与确定性会话无需外部凭证；通过后释放 B |
| `M1-F1-B` | `PENDING` / 待分配 | 邮箱验证、找回、修改邮箱 / 密码、身份重验和桌面设置 UI 的完整闭环 | A；真实邮件需授权；令牌或会话撤销规则不明时暂停 | CORE、API、DB、WEB、QA | 令牌摘要、过期、单次使用、重放拒绝、新邮箱验证、失败保留和设置视觉；未授权时用假邮件验证 | 未产生；真实邮件停在授权门，功能门通过后释放 V1 |
| `M1-F1-V1` | `PENDING` / 待分配 | 同一真实邮箱完成注册、重登、找回和账户修改，既有书籍数据不丢失 | A、B | QA、DOC | 浏览器、数据库、令牌安全、账户 owner 和全 diff 审查 | 未产生；通过后释放 `M1-F3A-A` |

### 3.3 `M1-F3A` 模型配置

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F3A-A` | `PENDING` / 待分配 | 四家固定文本模型目录、API Key 信封加密、检测后原子替换、撤销、脱敏和桌面设置 UI 的完整闭环；不开放自定义端点 | `M1-F1-V1`；实施时重验官方目录；供应商规则漂移时暂停 | CORE、API、DB、WEB、QA、DOC | DeepSeek / Kimi / GLM / 千问目录限制；密钥不回传 / 不进日志；失败保留旧配置和输入；成功不自动重放 | 候选 `3e4b020` 仅作种子；通过后释放 B 和 F3B 本地开发 |
| `M1-F3A-B` | `PENDING` / 待分配 | 图片模型独立可选配置、检测、撤销和设置 UI 闭环；不成为无图 PPT 前置 | A；图片供应商范围未确认或产生付费调用时暂停 | CORE、API、DB、WEB、QA | 文本 / 图片配置互不覆盖；撤销不影响历史数据和无图 PPT；失败保留输入 | 未产生；通过后释放 V1 |
| `M1-F3A-V1` | `PENDING` / 待分配 | 完成模型配置本地闭环，并为至少一家真实文本模型取得脱敏 H4 收据 | A、B；真实部分需用户 Key 与调用授权 | QA、DOC | 假适配器证明保存 / 失败 / 替换 / 撤销；H4 记录供应商、模型、次数和结果，不记录密钥 | 未产生；本地门可先释放 F3B，真实收据在 `M1-V1` 前补齐 |

### 3.4 `M1-F3B` 桌面对话与 AI

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F3B-A` | `PENDING` / 待分配 | 会话新建 / 切换 / 删除、文字 AI、停止、草稿、历史和桌面对话 UI 的完整闭环 | `M1-F3A-A` 本地门；模型、会话锁或删除边界不清时暂停 | CORE、API、DB、WEB、QA | 会话不按书或任务分型；当前会话互斥，其他会话不阻塞；停止 / 失败恢复；参考 02、4 视口与键盘 | 未产生；通过后释放 B～D |
| `M1-F3B-B` | `PENDING` / 待分配 | 纯图片 / 图文消息、最多 4 图、逐张移除、能力预检和失败恢复的桌面闭环 | A、对象存储、模型能力目录 | CORE、API、DB、WEB、QA | 上传失败或模型不支持图片时保留全部草稿；账户隔离和视觉状态通过 | 未产生；通过后进入 V1 |
| `M1-F3B-C` | `PENDING` / 待分配 | 消息内简单选择、显式确认、只读历史和失效问题的共享闭环；复杂选择只定义后续端侧契约 | A；旧结果可能覆盖新值时暂停 | CORE、API、DB、WEB、QA | 低风险单选可直接提交；多选 / 自由输入显式确认；过期问题不可回写 | 未产生；通过后释放 F5 范围与 M2 选择层 |
| `M1-F3B-D` | `PENDING` / 待分配 | 书籍上下文对话及明确请求后的 AI 笔记新增 / 指定原笔记修改闭环 | A、`M1-F2-D` | CORE、API、DB、WEB、QA | 默认新增；只有明确引用才更新；来源轻量标记；失败不丢讨论和笔记内容 | 未产生；通过后进入 V1 |
| `M1-F3B-V1` | `PENDING` / 待分配 | 两个会话边界下完成文字 / 图片对话、停止恢复、选择和笔记整理 | A～D | QA、DOC | 真实浏览器、模型或明确假适配器边界、DB 持久化、视觉和全 diff 审查 | 未产生；通过后释放 `M1-F4-A` |

### 3.5 `M1-F4` 免费体验与成本

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F4-A` | `PENDING` / 待分配 | 新账户一次性领取、跨端 grant 状态和桌面对话首页轻量领取条闭环；不建设券、余额、充值或常驻记录 | `M1-F3B-V1`；产品 / 视觉规则变化时暂停 | CORE、API、DB、WEB、QA | 幂等、并发、中断恢复；领取后原位反馈并移除；不显示金额、余额、进度或倒计时 | 未产生；通过后释放 B、C |
| `M1-F4-B` | `PENDING` / 待分配 | 平台调用成本预占、结算、释放、审计和账户累计 `¥5` 硬上限；不把内部金额下发成余额 UI | A、平台适配器；真实费用或并发模型不清时暂停 | CORE、API、DB、QA | 并发不超支；失败正确释放 / 结算；日志脱敏、owner 和回退证据完整 | 未产生；真实付费调用需预算授权，确定性适配器先验 |
| `M1-F4-C` | `PENDING` / 待分配 | AI 与 PPT 共用免费能力，耗尽后在原操作位置引导配置并恢复输入、会话和 PPT 草稿 | A、B、F3、`TECHNICAL` 中的 PPT 草稿契约；不得反向依赖尚未建设的 F5 | CORE、API、DB、WEB、QA | 不自动重放；领取 / 调用失败与耗尽状态不丢上下文；视觉与 4 视口通过 | 未产生；通过后释放 V1 |
| `M1-F4-V1` | `PENDING` / 待分配 | 新账户领取、AI / PPT 消耗、失败恢复和硬上限并发 Case | A～C；真实计费需调用授权 | QA、DOC | 确定性适配器证明成本账本；真实调用补脱敏收据；数据库和全 diff 审查 | 未产生；本地门通过后释放 `M1-F5-A`，真实收据在 `M1-V1` 前补齐 |

### 3.6 `M1-F5` 桌面 PPT 与真实 PPTX

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-F5-A` | `PENDING` / 待分配 | 对话 / 书籍详情双入口、单书来源集合、范围与需求、结构化追问和桌面任务工作区的完整闭环 | `M1-F4-V1`、F2、F3B-C；任务 / 会话模型冲突时暂停 | CORE、API、DB、WEB、QA | MVP 恰好一本但内部不写死；切书不自动建会话；旧问题失效；返回和多任务独立；参考 02 与 Web 规范 | 未产生；通过后释放 B |
| `M1-F5-B` | `PENDING` / 待分配 | 正文不足时公开资料补全、大纲生成、连续分层编辑、自动保存和层级校验闭环 | A、文本模型；联网服务与预算需授权 | CORE、API、DB、WEB、QA | 不伪装全书分析；失败保留范围、资料和大纲；无所属页面阻止确认；参考 04 | 未产生；授权前以假适配器验，完成后释放 C |
| `M1-F5-C` | `PENDING` / 待分配 | 三套版本化 `16:9` 青瓷模板、真实预览和选择闭环；无图片模型仍达到成品视觉 | B；模板视觉基线或资产来源不明时暂停 | PPT、WEB、QA | 长标题、长正文、带图 / 无图无溢出；参考 05 不覆盖共享外壳 | 候选 `39b84a4` 仅作 Presenton 种子；通过后释放 D |
| `M1-F5-D` | `PENDING` / 待分配 | PPT 任务幂等、会话互斥、Worker 租约、停止 / 重启恢复、旧请求防回写和固定 Presenton 内网适配 | C；外部版本、安全、许可证或真实进度能力不明时暂停 | CORE、API、WORKER、DB、PPT、INFRA、QA | 重试不重复；停止保留页面；进程恢复；不暴露管理 UI；不能可信逐页时不伪造进度 | `39b84a4` 为唯一种子，`d5ee177` 已替代；通过后释放 E、F |
| `M1-F5-E` | `PENDING` / 待分配 | 桌面生成中、停止、失败、重试、修改大纲、低频删除和完成瀑布流的完整 UI 闭环 | D | CORE、API、DB、WEB、QA | 单列 16:9、末尾跟随、不抢滚动；失败保留前页；删除二次确认；参考 06/33 和 Web 规范 | 未产生；通过后释放 F、V1 |
| `M1-F5-F` | `PENDING` / 待分配 | 作品列表、独立再生成、签名下载和可编辑 PPTX 交付闭环；不覆盖历史作品 | D、E | CORE、API、DB、WEB、PPT、QA | 下载为唯一主操作；真实文件可预览；作品区参考不冒充完成工作区定稿 | 未产生；通过后进入 V1 |
| `M1-F5-V1` | `PENDING` / 待分配 | 三份中文、长标题、带图 / 无图 PPTX 在 PowerPoint 与 WPS 打开、编辑和重存 | C～F；真实软件、生成环境及必要费用需授权 | QA、DOC | 16:9、对象可编辑、字体替代、溢出、重存、候选快照和全 diff 审查 | 未产生；通过后释放 `M1-V1` |

### 3.7 `M1-V1` 桌面真实闭环

| ID | 状态 / 负责人 | 可独立交付结果与边界 | 依赖 / 阻塞 / 暂停 | 预计读写 | 验收与验证 | 证据 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| `M1-V1` | `PENDING` / 待分配 | 同一真实邮箱账户完成登录、导入书、阅读记录、AI 对话、领取或配置模型、生成并下载可编辑 PPTX | M1-F1～F5 全部 V1；真实模型 / 费用 / 邮件 / Presenton 授权门 | QA、DOC | `SPEC` 第 8 节、Web 4 视口、真实文件、PostgreSQL、刷新恢复、PowerPoint / WPS、视觉与全 diff 审查 | 未产生；不是 M2 客户端独立建设前置，仍是完整双端业务验收的重要上游门 |

## 4. M2 并行建设与远期模块

M2 不再整体等待 `M1-V1`。只依赖当前事实源和客户端本地边界的工作先行；真实账户、API、持久化、外部服务与双端闭环仍按上游能力逐项解锁。下列建设包不得把开发适配器、静态页面或模拟状态称为真实跨端完成。

| ID | 状态 / 负责人 | 当前可独立交付 | 写入边界 | 释放 / 验收门 |
| --- | --- | --- | --- | --- |
| `M2-R0` 候选复用审计 | `DONE` / 项目总控 | 以 `42d85fe → 925bbc1` 为只读代码种子，按当前连续滚动与视觉逐模块选择性复用，不继承旧工作树 | `6f5c@925bbc1` 只读；旧“连续滚动应废弃”结论失效 | HEAD / status、19 项测试和主线缺口证据已保留；F0-A 已在隔离 `f312` 从 `ff4767b` 重建，后续以其真实 diff / H3 为准 |
| `M2-UX-CONTRACT-ALL` | `DONE(HISTORICAL CONTRACT) / CURRENT VISUAL FAIL BRIEF` / `01a03652-a5d4-76c1-b0fa-ff9303243664` | `d90d0fb` 的六路由合同只作历史 DESIGN-READY；本轮对 `f81b463` 真实 DevTools 定向检查已确认 drawer / Reader 视觉失败，不写实现 | 当前 brief：drawer 保留 86vw / 开放列表并提供 140px 无图 scenery slot，正式山亭资产缺失；Reader 标题 tall 28/36、regular 26/34、short 22/28、max-width 12em，并复验 font23 首屏提示。旧 `DONE` 不得当作当前候选 PASS |
| `M2-F0-A` 原生运行壳与客户端状态 | `FAIL / SYSTEM REWORK / VISUAL REWORK / H3 BLOCKED` / `01a034e4-12d5-7b31-9104-4d7431c12110` | 六页、抽屉、共享输入 / 键盘层、底部面板与客户端五态；原 writer 已停止 drawer / Reader 写入，未就绪服务走显式开发适配器 | `f81b463` 仍是确定性功能恢复点，但已被当前视觉 WIP 覆盖，不能作为 FINAL 候选；现有 WIP 精确为 drawer / Reader 4 tracked 源测试、1 新 test、2 EARLY JPEG，源码 `+45 -26`、diff-check 与保护哈希通过，最终 WIP 尚未重跑。软件键盘、tourist 凭证、正式山亭与真实 PPT preview 继续阻塞 H3 |
| `M2-F4-A` 真实书架 / 导入接入 | `READY` / F0-A 集成后同端下一包 | 将运行壳接入真实书籍摘要、搜索、导入与解析状态 | A 已以 `38f9ec3` 合入；F0-A 虽已提交候选但仍在集成修正，为避免同写 `apps/miniapp/**`，等待其合入 main 并复验，共享 contracts / lockfile 由总控集成 | 真实 EPUB / TXT / PDF、五类状态、开发者工具与账户隔离 |
| `M2-F4-B` 连续正文 / 笔记 / 恢复接入 | `PENDING` / 后续小程序任务 | 自然连续纵向滚动正文、目录 / 设置 / 操作层、笔记和跨端位置恢复 | B / C / D / E 分别提供正文、PDF、笔记与 owner / 恢复契约；不强制分页或整页吸附 | 真实内容、刷新 / 重开恢复；360 / 390 / 430 与不同高度下验证长正文、动态字号、输入法、底部安全区、弹层和连续滚动无跳位 / 横向溢出；开发者工具、真机与非作者 UI/UX 复验 |

### 4.1 `M2-UX-CONTRACT-ALL` 当前覆盖矩阵

固定入口为 `f312@d90d0fb` 的 [`apps/miniapp/src/app.json`](/Users/echoman/.codex/worktrees/f312/SelfAlone/apps/miniapp/src/app.json) 六条路由；以下矩阵是本包当前审查范围和真实覆盖状态，不代表对应业务闭环完成。

| 页面 / 共享层 | 绑定参考（SHA-256） | 本轮必须覆盖 | 当前证据 / 结论 |
| --- | --- | --- | --- |
| `nav-drawer` | `11-mobile-conversation-drawer.png`（`9e764e60189845b6f46eb1181c97bbc622a363c067274ae479cfb7a15c68c36e`） | 打开 / 关闭、长会话、底部导航、iOS / Android 安全区、各宽高与命中 / 溢出 | `NORMAL COVERED / FAIL`：390 打开态证明宽度 / 大圆角与顶部顺序成立，但纸白、无卡片列表、留白和贴底远山亭子缺失；loading / 空 / 筛选空 / 失败、长列表、键盘和 360 仍 `UNCOVERED` |
| `login` | `21-mobile-auth-login.png`（`3cda4b1cd6b5f1479b8a29c26dc66e403840d773122ce43d1690ed4db8bc6381`） | loading / 授权失败 / 正常、微信 / 邮箱主次、协议、键盘开关、安全区、长文案 | `PARTIAL / FAIL`：`5e270b1` 已覆盖 320 主态 / 长邮箱聚焦与 430 主态，完整上下文、协议和底部安全区可见；背景山亭仍缺，恢复 loading、认证失败与真实键盘实显仍 `UNCOVERED`，焦点证据 keyboard=0。游客身份只阻塞真实授权结果 |
| `conversation` | `13`（`38569bae11f33492523b3546bed1d9a8e297a9be55a0cbdf23d44f7cf4117d5e`）、`30～32`（`5b231f018b55b535bca2659403d6e46c33e356f129ee4a85ab21fc55d5077728` / `bc286413ddbf0ecd87bde39793b7197e1abea0032891c13eb4356c751863127f` / `8bdb333b34314303fcf01ac37d91bdd80b05844490af64878daf18da1361b0fa`）、`38`（`ea5876adf8a5953c19ac105dfd251d5f77bf1d2417d71c35df5981f0b6a9fb7a`） | 五态、普通 / 范围选择 / 附件 / 免费额度、输入增长、键盘开关、趴宠可见下缘锚点、安全区 / 长内容 / 失败保留 | `NORMAL COVERED / FAIL`：390 开发正常态已覆盖；固定透明画布定位的趴宠锚点失败，selection / 附件 / 1～5 行 / 键盘 / 五态 / 额度仍 `UNCOVERED` |
| `library` | `14-mobile-reading-library.png`（`3e80d4a9d64567c439ffab09b8e90d0444f0025a794a44e8d4100d69d7465212`） | loading / 真实空 / 筛选空 / 失败 / 正常、搜索 / 导入、2 / 3 列、长书名、四宽与安全区 / 溢出 | `NORMAL BASELINE COVERED / NEAR PASS`：`5e270b1` 已冻结 320 两列和 430 三列含长标题，页头、搜索、进度、来源与无可见横溢成立；360 / 390 有前序基线，但其余四态与最终同 revision 矩阵仍 `UNCOVERED` |
| `reader` | `15～17`（`82c09e3849e000dbe3b4a4cf796b1498e9de94efc323a933d1395903652537e3` / `dcaacd30403fabfd8d01d12704ea8b5ab40572ac299f1dd2685756242393df36` / `a847e81aad0d1935cb91586ea761fb8f1abfd6ad905f4f1c2b457056a12d9608`）、`18～20`（`2ddebcb614497d88efc79e0bf77197fc26192c5641ea2833d2a7a820cef8152f` / `23d078e390f6fc2b4422587b81b990f50154ca6e98535a94ccf65c418ec76077` / `e76a281751844095d080d8564980f13cc2d0ed7b9112dc3b842f6262b98b19cb`） | 介绍首屏 / 连续正文 / 操作层、浅深、短中长高、长标题 / 正文、内容三面板五态、趴宠与 44px 对话入口锚点、安全区 / 字体 / reduced-motion | `PARTIAL / FAIL`：`630c051` 通过 swipe lifecycle，`5e0188d` 通过 live viewport / 控制层 / 面板局部几何，`cdaa307` 关闭 DevelopmentClient 内制作 PPT 绕过会话。操作层透明盒锚点、缺“新建笔记”、完整五态与 360 / 390、键盘 / 字体 / reduced-motion / 选区仍未通过 |
| `ppt` | `23～29`（`053018567a03dcef79c0c70ba3e0b3d944aa0667694ecc3fd08e714267d84ef3` / `e3b115b90a53b1066ab469455d1e315eed19e1c666f1b08547d0efcf8e7bd11c` / `fb130b9de0aa9f33537ee9219ac01f677ef77a3816d0fd57a199867d1c9f7e74` / `13591782f4ae0ff98d80c3addecbab85ff79825cefb4b8ff61a2a5cde42d6046` / `7c604274a732769251b07f27308dfa66dbfaea16c94e1a79a1af2a7c787ca36b` / `fa5fdc4b6bc36986f268f22328b9178ebb3d1ab18ab035673c1f1fdaaa19c3f8` / `4ed985f4aadafa9769d9e732228cec7768e452de4d9d21598d54bf713e1dc960`） | 范围 / 大纲 / 编辑 / 模板 / 生成中 / 失败 / 完成、键盘、动态长度、吸底操作、安全区、失败保留与溢出 | `PARTIAL / FAIL`：320 的 1 / 4、2 / 4 结构接近通过；编辑器单 textarea 与伪保存语义失败，3 / 4、4 / 4、键盘和其余状态 `UNCOVERED`。真实模板 / 完成页预览资产缺失，只允许明确开发适配器状态，不得用 CSS 色块冒充 |
| `settings` | `22`（`ce28f93874444d6877713576716b1395dff6752da36650d6a5792e293f657288`）、`39`（`e74f589f85b9c8f9bf6654ef68bca8d5e6f5f87399a34a69744722f718b5ed17`） | 总览五态、服务长状态、模型配置、凭证显隐 / 键盘、保存失败、安全区、长文案 / 溢出 | `NORMAL LIST BASELINE COVERED / PAGE FAIL`：`5e270b1` 已冻结 320 自然滚动到退出与 430 全项同屏，开放列表、分隔、状态和安全区成立；山亭仍缺，loading / 失败、39 详情与真实键盘仍 `UNCOVERED` |
| 共享面板 / 键盘层 | `16`、`18～20`、`25`、`30～32`（SHA 同上） | 动态高度、遮罩、焦点 / 返回、键盘开关、输入 / 附件增长、底部安全区、系统字体、reduced-motion、横纵滚动与内容保留 | `PARTIAL / FAIL`：reader 三内容面板正常态与 PPT 编辑面板已实看，但面板遮工具栏、编辑与键盘语义未通过；其他共享矩阵仍 `UNCOVERED`，不得由任一页面静态截图替代 |

其余 M2 / M3 行仍是父级导航；完整业务验收不得提前。

| ID | 状态 | 模块结果与边界 | 依赖 / 拆分门 | 验收方向 / 下一步 |
| --- | --- | --- | --- | --- |
| `M2-F1` 双端账户 | `PENDING` | Web 微信扫码、小程序 `wx.login()`、令牌、邮箱备选、绑定与账户隔离 | `M1-F1` 身份 / owner 契约；真实 AppID / Secret / 域名授权；认证与绑定必须细拆 | Web + 开发者工具 + 真机 + DB owner；契约就绪后展开，不等待无关 M1 功能 |
| `M2-F2` 微信读书 | `PENDING` | Key 安全连接、首 / 增量同步、自动恢复、统一书架和个人划线 / 想法 | M2-F1 本地门；真实 Key 授权；外部同步和换号必须细拆 | 官方调用、脱敏日志、两端显示；执行前展开 |
| `M2-F3` 小程序会话 | `PENDING` | 会话抽屉、文字 / 图片、选择层、停止、模型与额度恢复 | M2-F1、M1 对话能力；按小程序参考独立设计，不复制 Web | 360/390/430、开发者工具与真机；执行前展开 |
| `M2-F4` 小程序书架与阅读 | `ACTIVE` | 统一书架、导入、介绍首屏、自然连续纵向滚动正文、操作层、书籍内容与跨端恢复 | 客户端运行壳先行；A 已释放真实书架下一包，正文 / 笔记 / 恢复依赖 B～E，身份依赖 M2-F1，微信读书数据依赖 M2-F2 | 先验收 F0-A 的 360 / 390 / 430 与 H3；完整门覆盖真实导入、连续滚动、内容面板、DB 与真机 |
| `M2-F5` 小程序设置 | `PENDING` | 账户、模型、微信读书和退出的端侧闭环 | M2-F1～F3；账户与服务高风险流程按场景拆细 | 目标端视觉、键盘、安全区、失败保留；执行前展开 |
| `M2-F6` 小程序 PPT | `PENDING` | 四阶段、停止 / 失败恢复、作品、下载和系统打开 PPTX | M2-F3、F4、M1-F5；下载域名和真机授权 | 开发者工具、iOS / Android、真实 PPTX；执行前展开 |
| `M2-V1` 双端真实闭环 | `PENDING` | 同账户跨 Web / 小程序完成身份、书籍、阅读、对话、额度 / 模型和 PPTX | M2-F1～F6 | 真机、PostgreSQL、外部授权和全 diff；通过后释放 M3 |
| `M3` 邀请制发布 | `PENDING` | 隐私与删除、备份恢复、迁移回退、监控、镜像、Staging、Web 发布和小程序审核 | `M2-V1`；法务、服务器、域名、备案、平台和发布授权；全部高风险项按场景细拆 | 独立恢复、故障注入、Staging 回退和生产真实 Case；获授权后展开 |

## 5. 当前执行卡

| 工作包 | 状态 / 负责人 | 写入边界 | 本轮停止条件 |
| --- | --- | --- | --- |
| `AUDIT-ALL-1` | `DONE` / `/root/project_completion_audit` | 全程只读 main@`263d3e2`，未启动服务 / DB、未写仓库 | 已输出 25 个路线包的真实分类、证据、缺口、依赖、返工面和统计；2 完整（仅 1 个产品子闭环）/ 1 未验收 / 2 半成品 / 5 占位 / 8 缺功能 / 7 阻塞，任务已释放 |
| `M1-F2-D-TEXT` | `VERIFY / FROZEN d65ab3b / NONAUTHOR PASS WITH RECEIPT CAVEATS / ENTRY QUEUED` / `/root/reading_text_notes_web` | `/Users/echoman/.codex/worktrees/dtxtui/SelfAlone@d65ab3b`、`codex/m1-f2-d-text-web`；只含私有 text-annotation / book-detail / text-reader 与 acceptance，worktree clean，reviewer 已释放 | 当前 HEAD 定向 42 / 42、全仓 30 files / 146 tests、typecheck / build / diff-check 与 1440×844 DPR2 真实 Chrome Case 通过；README 截图基线仍指父 `e2a6ac4`，当前 HEAD 的 768、1024 / 1200 / 200% / reduced-motion、真实删除未覆盖。允许顺序入口集成，不扩大为父项 / 视觉通过；shared route / chat seam 仍未接入 |
| `M1-F2-D-TEXT-INTEGRATION` | `DONE / MAIN MERGED` / 项目总控 | `dint@5156b9c` 已由原非作者复验 `PASS`，合并 main@`f85d86c`；P2 404 / 409 与 migration receipt 引导表边界登记但不阻塞本卡 | main 定向 5 文件 / 19 项、全仓 26 文件 / 123 项、typecheck / build / diff-check 通过；释放 D-TEXT Web 入口，不代表用户可见闭环完成 |
| `M1-UX-SYSTEM-AUDIT` | `DONE / FAIL BRIEF / IDLE-REVIEW` / `01a03652-a5d4-76c1-b0fa-ff9303243664` | `/Users/echoman/.codex/worktrees/27df/SelfAlone@b38ed4d`；真实 Chrome 只读审查，仓库零写入 | 已输出 F01～F09、绑定参考 / SHA、页面分类、唯一推荐、文件所有权与验收 Case；DPR1 为自动化补充，不替代候选 DPR2 终验。等待新候选后再复验 |
| `M1-WEB-SHELL-01` | `FAIL / REWORK ACTIVE FROM 9638d12 / NOT IN MAIN` / `/root/desktop_shell_m0_fix` | 唯一 writer 只写 `apps/web/src/styles.css`、`ui/desktop-shell.ts`、`conversation-view.ts` 与必要定向测试；从冻结 `9638d12` 承接。既有完整链 `0969c33..9638d12` 为 5 提交 / 33 文件，`?? data/` 保留，禁止重做、只摘末提交或触碰 Reader / D-TEXT / 台账 | P1-1：1200×844 conversation / library 品牌单行、三 nav 行 56px、设置可见文案仅“设置”且不可用语义稳定、无横溢；P1-2：六阶段×四宽 active=1 且 `aria-current=step`=1，标题 / 阶段 / 内容一致。TDD、Web typecheck、全仓 verify、真实 Chrome 与 scoped commit 后交原非作者复验；当前禁止合并 |
| `M1-F2-D-TEXT-WEB-ENTRY` | `READY / WRITE-HELD` / 下一唯一 Web writer 待总控创建 | 把 `dtxtui@d65ab3b` 私有 book-detail / annotation / notes / reader UI 接入当前 main；仅在 Desktop 集成后分配 `main.ts` 与必要共享入口，不抢 Desktop 文件，不扩大 contracts / schema | Desktop FINAL PASS→总控集成 / main 复验→创建本任务并取得 ACK；随后做真实 TXT / EPUB 入口、持久化、失败保留、四视口与非作者复验。当前 caveat 仍保留，不因 READY 视为已实现 |
| `M2-UX-CONTRACT-ALL` | `DONE(HISTORICAL) / CURRENT FAIL BRIEF` / `01a03652-a5d4-76c1-b0fa-ff9303243664` | 历史合同仍是设计输入，不代表 `f81b463` 或当前 WIP 视觉通过；本轮只读 brief 已完成 | 当前实现必须按 UI/UX→唯一 writer→EARLY-VERIFY→冻结→FINAL-VERIFY 闭环；正式 drawer 山亭资产单独 `ASSET BLOCKED` |
| `M2-F0-A-READER-SHORT` | `PARTIAL PASS / SUPERSEDED BY SYSTEM REWORK` / `01a034e4-12d5-7b31-9104-4d7431c12110` | `f312@d4f587c → 630c051` 只保留 Reader 局部恢复点；不单独合并 | `630c051` 已关闭永久 dismissed：正文激活后提示淡出并从 AX 退出，回顶与离开 / 重进同书均恢复；仅登记 swipe lifecycle 通过。短屏完整视觉、精确动效、其余宽高 / 状态 / 字体 / reduced-motion 仍归系统矩阵，父项不得升级 |
| `M2-F0-A-SCREEN-ADAPT-ALL` | `VERIFY / VISUAL REWORK FROZEN a0e98f9 / MINI NONAUTHOR FINAL ACTIVE / H3 BLOCKED / NOT IN MAIN` / `/root/mini_visual_final_review` + `/root/mini_visual_rework` | `f312@a0e98f9` 的末提交（父 `f81b463`）冻结 13 文件 `+81/-30`；Reader 标题三档 `28/36`、`26/34`、`22/28`、`max-width:12em`，drawer 唯一列表滚动、纸白开放行、140px 无图 scenery slot。完整 `ff4767b..a0e98f9` 为 21 提交 / 223 个 `apps/miniapp/**` 文件；对 main@`7850b6c` 三方试合并无文本冲突，但必须按完整链集成 | 项目总控协作树的 Mini 专项非作者已被工具受理并显示 `running`，范围不含 Desktop；固定 HEAD、保护哈希已复核一致。候选未包含工作树中 `pnpm-lock.yaml` 的 `apps/miniapp: {}` importer；PASS 后由唯一集成者独立重建并验证 frozen lock，FAIL 返回唯一 Mini writer。正式山亭、软件键盘、游客凭证 / console、真实 PPT preview 与 H3 均未闭合 |
| `M2-F0-A-VISUAL-REWORK` | `VERIFY / FROZEN a0e98f9 / MINI NONAUTHOR FINAL ACTIVE / ASSET CANDIDATE / RUNTIME BLOCKED` / `/root/mini_visual_final_review` + `/root/mini_visual_rework` | 末提交只改 drawer / Reader 与 8 张候选收据；工作树另有两张旧 EARLY 图未入提交。保护哈希仍为 project config `bb02f467…`、lock `9a0d8a10…`。`IMG-04` 未实装，透明山亭仍只是候选 | Mini 专项审查同时给页面 verdict 与独立 `IMG-04` ASSET verdict、placement / size / opacity / crop；若页面 PASS 但资产仍未通过，只关闭无图骨架，不得称 drawer 最终视觉完成。总控必须审 `ff4767b..a0e98f9` 完整链及 main 冲突，禁止只摘 `a0e98f9` 冒充小程序闭环 |
| `M2-F0-A-H3-REWORK` | `ACTIVE / KEYBOARD H3 UNCOVERED` / `01a034e4-12d5-7b31-9104-4d7431c12110` | 与系统适配共用同一 f312 writer，先做不涉及视觉裁决的 H3；既有 `project.config.json` / 锁文件禁止触碰 | live viewport 合同已依次接入 conversation / drawer、login / library / settings 与 Reader；所有焦点图仍 keyboard=0，软件键盘 / 字体、游客 console 与凭证化环境仍为真实外部门，H3 总门不降级 |

## 6. 候选与共享环境证据

| 范围 | 唯一结论 | 证据与失效条件 |
| --- | --- | --- |
| `M1-F2` | `67d77d7` 仅作功能种子 | 只参考真实导入 / 阅读 / 标注 / 笔记差异；账户和 UI 按当前事实重落。候选或 worktree 变化即重验。 |
| `M1-F1` | `658ba50` 仅作邮箱认证种子 | 不带入 F2 父链；微信、小程序令牌、账户修改和绑定仍未完成。 |
| `M1-F3A` | `3e4b020` 仅作文本模型配置种子 | 未实现当前北京端点目录与真实供应商验证；图片模型、会话、联网和成本仍未完成。 |
| `M1-F5` | `39b84a4` 为唯一 Presenton 种子 | `d5ee177` patch 等价并 `SUPERSEDED`；固定镜像、任务恢复、安全与真实办公软件验收仍缺。 |
| `M2` | `42d85fe → 925bbc1` 可复用候选 | 不进入 M1，也不直接继承 `6f5c` 工作树；连续滚动方向与 `ff4767b` 一致。按模块复用代码，仍须重做 / 复核当前视觉、账户与 API 接缝，并通过 360 / 390 / 430 和真实微信开发者工具验收；既有 19 项测试只作种子证据。 |
| `0204` 设计探索工作树 | 只读保留并排除集成 | `9783628` 上 38 项未提交路径中，37 项与当前链逐字节一致；唯一剩余为过期旧台账。不得清理、提交或把未索引探索稿升级为视觉事实；status 摘要变化时局部重验。 |
| `M1-F2-A` 已集成候选 | `ed2cec6 → 38f9ec3 → 16ab946 + 91aab08 + 86a8fb1`，状态 `DONE(function) / FAIL(visual)` | 既有导入 / 搜索 / 五态 / 响应式与 Chrome 证据仍支持功能闭环；本轮最新 UI/UX 以真实页面确认解析状态冒充进度、工程文案与两本稀疏书架不能满足 03 密度，覆盖旧视觉 PASS。待共享外壳冻结后以至少 10 本、阅读进度和 DPR2 重验。 |
| `M1-F2-B` main 集成 | `44b81ea → 04f03d2 → 47748fa → 535b9ec → 804f952 → e971ace → ed04dd4 → 08ff046`，状态 `VERIFY / VISUAL REOPEN / FOCUS PASS` | 专注 rail / toolbar、真实 TXT / EPUB、共享 contracts / schema / Server / Web 接缝和同事务文本发布均已进入 main；缺少发布器会明确失败关闭。focus 子合同保留 PASS；最新 UI/UX 另行确认 loading / failure 稳定 shell 和沉淀入口缺口，原生 200% 与 DPR2 精确视口仍未通过。 |
| `M1-WEB-SHELL-01` 当前候选 | `0969c33 … 221d5bb → 9638d12`，状态 `FAIL / REWORK ACTIVE / NOT IN MAIN` | 独立在线 FINAL 已确认两个 P1：1200px 品牌 / 设置断行；六阶段缺 `aria-current="step"`。唯一 writer 正从该冻结点最小修正；完整链仍禁止只摘末提交或在新 FINAL 前集成。 |
| `M2-F0-A` 当前候选 | `ff4767b → 142b6f2 → 91934f1 → 76227b9 → d90d0fb → d4f587c → 4fc422f → 630c051 → 5e270b1 → 5e0188d → cdaa307 → 6aba8ef → 36aeb28 → 5d51c53 → 598e34f → 6586bca → b28aa9c → 79c9d8b → e4d94b4 → a952a49 → f81b463 → a0e98f9`，状态 `VERIFY / MINI NONAUTHOR FINAL ACTIVE / H3 BLOCKED / NOT IN MAIN` | 完整链 21 提交 / 223 个 `apps/miniapp/**` 文件，对 main@`7850b6c` 三方试合并干净；Mini 专项审查与 Desktop 并行且不重叠。候选不含验证现场所需的 lock importer，集成时须单独重建并验证。保护 project config EOF 差异不得带入；正式山亭、软件键盘、PPT 资产 / 真实预览仍缺，`IMG-04` 未实装。 |
| `M1-F2-C` 安全首包 | `7856a7a + 059b0ec → d7e5ee6 + 589a22b`，状态 `ACTIVE / VERIFY` | 范围、样本、异常租约释放和非作者复审通过；main 定向 17 项与全仓 67 项通过。owner / fencing、持久化恢复、续租 / 超时 / 取消、真实 PDF.js / Canvas、DB / API / Web 与生产依赖仍未完成。 |
| `M1-F2-D-TEXT` 共享集成与私有候选 | `263d3e2 → 18c7522` 私有种子；`94056be → ed95d95 → 5156b9c → main@f85d86c`；私有 Web `e2a6ac4 → d65ab3b` | 共享 contracts / migration / API / publisher 已通过原非作者与 main 复验；私有种子不再单独合并。`dtxtui@d65ab3b` 非作者 verdict 为 `PASS WITH RECEIPT CAVEATS`，入口等待 Desktop shell 释放 `main.ts` 后顺序接入；不代表父项 DONE / 视觉 PASS。 |
| 开发基线 | 产品集成恢复点 `main@f85d86c`；当前控制面续接于 `main@6f8a3a4` | A 功能闭合但视觉重开；B / C 共享接缝和 C 安全首包已进入 main，D-TEXT 共享接缝已合并但 Web 入口排队；Desktop `9638d12` / Mini `a0e98f9` 均未集成。主线三个未跟踪视觉候选目录仍属他人现场，不得纳入台账提交。 |
| 共享 PostgreSQL | 只证明跨工作树副作用 | 不能证明当前分支已有功能；开发必须使用隔离 schema 或实例，迁移记录 schema、数据量、owner、约束和回退点。 |

完整候选父链、patch-id、文件重叠、测试和共享数据库对账见提交 `2a4cc24` 的台账历史。任何候选、worktree 或共享环境变化只使对应结论失效，不自动推翻其他项。

## 7. 外部图片调用账本

| 序号 | 状态 | 提供方 / 模型 | 张数 / 尺寸 / 用途 | 输出与结论 | 累计 |
| --- | --- | --- | --- | --- | --- |
| `IMG-01` | `REJECTED` | OpenAI 内置 `image_gen`；具体模型 ID 未暴露 | 1 张，`1487×1058`；书架右下低对比远山候选 | `47b4`：`redesign-v2/output/ui-design-preview/product-design/shared-shell/right-canvas-candidates/v1/desktop-right-canvas-mountains-transparent-v1-candidate.png`；SHA-256 `2879ee0dda69580504d42a561158ee6f2ab3b451c8b989ac900d143c851c6178`，`hasAlpha: no`，棋盘格烧录，未实装 | 已实际调用 `1 / 20`，剩余 `19` |
| `IMG-02` | `REJECTED` | OpenAI 内置 `image_gen`；具体模型 ID 未暴露 | 1 张，`1486×1059`；只尝试修复 `IMG-01` 的真实 Alpha | `47b4`：`redesign-v2/output/ui-design-preview/product-design/shared-shell/right-canvas-candidates/v1/desktop-right-canvas-mountains-transparent-v2-candidate.png`；SHA-256 `91acb39e39d744f5007ca00b96e662d6df89e87fdaee2ada8d823cf808600115`，`hasAlpha: no`，仍有棋盘格烧录，未实装；实现任务已停止继续调用 | 已实际调用 `2 / 20`，剩余 `18` |
| `IMG-03` | `APPROVED / RUNTIME` | OpenAI 内置 `image_gen`；具体模型 ID 未暴露 | 1 张，原始 `2172×724`；按右山聚焦 brief 生成独立透明横向远山，再以可靠本地 Alpha 流程等比裁切 / 双侧包络为 `1600×320` 运行时资产 | 原始 SHA-256 `3a826b57…bdb52`；v1 SHA-256 `547eae01…5ed2` 因桌宠区 Alpha 过高判 `VERIFY`；无新增生成调用的 v2 / 运行时 SHA-256 `2d6d7088…7229f0f`，RGBA、四边透明、左区与桌宠区 max Alpha `10 / 255`。已实装到 `redesign-v2/assets/backgrounds/desktop-right-distant-mountains-transparent-v1.png`，经候选 / main 真实 Chrome 与 03 对照、原非作者终审后升级 | 已实际调用 `3 / 20`，剩余 `17` |
| `IMG-04` | `CANDIDATE / UIUX REVIEW PENDING` | OpenAI 内置 `image_gen`；具体模型 ID 未暴露 | 1 张，`1024×1536`；按参考生成小程序 drawer 底部低对比山亭 | 白底源 `redesign-v2/output/ui-design-preview/product-design/mobile-drawer/candidates/v1/mobile-drawer-landscape-white-bg-v1-candidate.png`，SHA-256 `37cbfb304a7b6a3d5f8c2013f84774c0e3339ab5474adb49e3de1993d7edb3ba`；本地确定性白转 Alpha 后裁切候选 `mobile-drawer-landscape-transparent-cropped-v1-candidate.png`，`1024×737 RGBA`，SHA-256 `55a655177c84202c255786fefdb4752e2cb575ffcf6c11f6540ae51aa48e2a38`；合成预览 `mobile-drawer-landscape-on-drawer-preview-v1.png`，SHA-256 `a9643e2aab7774eb8e0cde374cfbbe5718c9201306f6f0bc1ea88b062610f57b`。未实装、未批准为运行时资产 | 已实际调用 `4 / 20`，剩余 `16` |

## 8. 恢复证据与授权门

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| M0 基线 | `DONE` | `2b639e0`；迁移、账户域或运行基线变化时重验 |
| M1-R0 候选对账 | `DONE` | `2a4cc24`；候选或环境变化时局部重验 |
| 产品 / 视觉台账重建 | `DONE` | `6a29b96`、`204b374`；规则变化时只同步受影响事实源 |
| 文档职责治理 | `DONE` | `17339a7`；唯一台账、Wiki、Memory、项目 Skill 和链接校验 |
| 台账动态混合粒度重整 | `DONE` | 31 个当前 M1 可执行项、8 个远期模块；字段覆盖、链接、旧编号残留和 diff 检查已通过 |
| `M1-F2` 开发前收口 | `DONE` | PDF 唯一技术边界、`0204` 只读排除和安全开发基线已形成并纳入本轮主线治理链 |
| `M1-F2-A` 书架闭环 | `DONE(function) / FAIL(visual)` | main 功能回退点 `86a8fb1` 保留；最新 UI/UX 已重开 03 视觉门，旧 PASS 不再覆盖进度语义 / 密度 / 工程文案缺口 |
| `M1-F2-BC-S1` 共享接缝 | `DONE` | `44b81ea`；文本 / PDF 定位、文件版本、位置并发、API / schema 与单写入边界已冻结，生产 PDF 渲染依赖仍由 C 首包给出授权建议 |
| `M1-F2-B-UX1` 阅读视觉 / 交互 brief | `DONE / FOCUS PASS` | `804f952` 已通过历史非作者最终复验并进入 main；父项 B 的完整视觉仍等待原生 200% 与同 revision 精确无 override `1440×844`，后续由有效任务 `01a03652-a5d4-76c1-b0fa-ff9303243664` 复验 |
| `M2-F0-A` 原生运行壳 | `FAIL / SYSTEM + VISUAL REWORK / H3 BLOCKED` | `f81b463` 只保留确定性功能恢复点；当前 drawer / Reader WIP 必须完成 DESIGN-READY→实现→EARLY→FINAL 闭环。真实软件键盘、凭证化 clean console、正式山亭 / PPT 资产门通过前不合并 |
| 项目总控与台账写入权 | `ACTIVE` | 任务 `01a034b4-a73d-7ce2-8531-51585826e6d3` 负责持续总控并独占台账写入；执行任务通过统一通道交证据，紧急恢复例外须复核 |

- 当前外部授权门：验证合格后的本地 `main` 合并已授权；远端 push、PR、发布、部署、真实邮件 / 微信 / 文本模型 / 微信读书 / 联网 / Presenton 付费调用和小程序审核均未授权。外部图片生成仅限已授权的 20 次总额度并受上表逐次记录约束。
