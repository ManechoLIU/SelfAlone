# SelfAlone 任务台账

> 唯一执行控制面。只记录当前 Goal、活动任务、下一步、真实阻塞、规则版本、任务状态与可复用证据；产品、视觉和技术规则分别以 [SPEC](redesign-v2/SPEC.md)、[DESIGN](redesign-v2/DESIGN.md)、目标端规范、[参考索引](redesign-v2/design-reference/README.md) 与 [TECHNICAL](redesign-v2/TECHNICAL.md) 为准。

## 1. 当前控制面

- 当前 Goal：`M1-F4-V1 / FREE EXPERIENCE REAL FLOW`。`M1-F4-C / FREE EXPERIENCE EXHAUSTION HANDOFF` 已闭合：Server 错误/重试合同、Web 三类平台错误态、设置往返、草稿保留与不自动发送均已有 current-main 代码门和真实 Chrome 分层证据；A / B / C 现均不再阻塞 V1。下一阶段只验证真实领取→平台能力消耗→硬上限→恢复的用户闭环，不把错误态 H3 冒充平台免费模型已可用。
- 下一可见检查点：先收敛 `M1-F4-V1` 的平台文本成功路径。当前 `apps/server/src/index.ts` 创建 `createPlatformTextCapability` 时未注入 `platformModel`，因此已领取且未配置用户模型时正式 4322 会在任何平台模型调用前返回 `PLATFORM_UNAVAILABLE`；TECH 已规定平台凭证与用户凭证复用适配器、使用不同凭证来源。下一实现必须只补这一既有接缝与相称测试，不扩图片模型、完整 PPT 生成或新基础设施；真实 Provider H4 / 计费仍单独受调用授权约束。
- 当前阻塞：`M1-F4-C-WEB-HANDOFF` 的真实端 H3 已解除；`M1-F4-V1` 当前不能执行成功路径，原因是正式 Server 尚无 `platformModel` 运行时接线，而不是浏览器登录或错误态 fixture。其他既有外部门：Mini production 受 AppID / apiBaseUrl / 域名与非游客 DevTools 门约束；Mini Drawer clean-console 与软件键盘只受外部 H3 约束；Desktop Auth 专用背景 / Logo seal未绑定；真实 PDF 页面能力受生产依赖 / 许可证授权门约束。
- 规则版本：总控已从真实 `main@018e084` 加载当前 AGENTS（SHA-256 `a850d7ba…c1b`），其 Fact-First 与 host-aware fallback 要求先核当前事实、证据不足保持未知，并使 Grok 安全失败后可先路由到当前宿主内部 GPT，不重置 execution lineage / recovery budget；后端 Grok OAuth 项目级路由授权以 `dfd83c7` 为事实源，Web / Mini 前端 Kimi K3 API 项目级路由授权以 `ba3a7af` 为事实源，普通已验证范围单一 `main` 提交的非强制快进 push 授权以 `46ab1fd` 为事实源。Adaptive Agent Runtime 安装副本已加载并由同一总控机器 ACK 精确 revision `4fcd8d05bbe01dc61d21f93d9df397272aa5dba9`（manifest SHA-256 `5fc8e367…1be0`），当前规则与 runtime 以 Git common-dir 握手、五种任务状态、Assignment 启动前 ACK/lease、证据进展指纹与 recovery budget 为准。唯一 controller 仍为现有 SelfAlone 总控，不创建第二总控。
- 业务父闭环只按用户结果组织为：身份、阅读与笔记、会话、PPT、跨端同步、发布 / 安全；下表技术、端侧与共享合同项均是相应父闭环的执行子包，不单独升级成用户完成宣称。
- 用户反馈分诊：Reader 草稿缺位置为 `P0 / 当前阅读→会话闭环`，立即返原 writer；Mini 搜索事件缺真实 production query 为 `P2 / 阅读与笔记旁路`，已以 `cda7b4d` 修复并顺序集成；其他既有视觉 / 外部门仍留在原业务父闭环，不打断当前 Writer。

## 2. 开放工作包

`VERIFY` 行保留当前完成边界与精确缺口；`READY / PENDING` 行只保留释放条件；`BLOCKED` 行保留外部唤醒事件。活动状态、owner与恢复动作只以本表对应任务行为准。

| ID | 状态 / owner | 固定边界与当前证据 | 依赖、阻塞与下一步 |
| --- | --- | --- | --- |
| `M1-F1` | `VERIFY / PARENT OPEN` / 项目总控 | 业务父闭环：同一账户完成身份建立、恢复、修改与数据保持 | A / B 已局部主线 PASS；V1 仍依赖真实邮箱授权完成找回、修改与数据保持 Case，不把父行冒充可独立派发的技术包 |
| `M1-F1-A` | `VERIFY / MAIN b6b77ee / MAIN CASE PASS` | 注册、登录、退出与桌面认证 UI 已集成；真实邮件 / 微信与 reduced-motion 未覆盖 | 证据 `auth-early-b7a6894/`、`main-auth-settings-final-d9a3b46/`；保持父包开放 |
| `M1-F1-A-AUTH-EARLY` | `VERIFY / CANDIDATE faa194d / ASSET BLOCKED` | entry→register→login 状态 SELF PASS；候选仅六个 Auth Web 文件 | ref01 `d49f5a61…a824`；绑定 Auth 专用背景 / Logo seal 后再 EARLY，不得自由设计或临时替代 |
| `M1-F1-B` | `VERIFY / MAIN a9408ad / P0 MAIN FINAL PASS` | 邮箱 / 密码修改与设置 failure / focus 已闭合；敏感密码不持久化 | 真实邮件、成功换邮、微信绑定与 reduced-motion 仍独立开放；证据 `main-settings-p0-final-a9408ad/` |
| `M1-F1-B-SETTINGS` | `VERIFY / MAIN a9408ad / REOPEN CLOSED` | legacy v1 清洗密码、失败保留内存字段、刷新 / 新标签仅恢复邮箱 | 定向12项、Web231项；后续只验真实服务边界 |
| `M1-F1-V1` | `PENDING` / 待分配 | 同一真实邮箱完成注册、重登、找回和账户修改，既有书籍不丢 | 依赖 A / B 与真实邮件授权；真实浏览器、DB、令牌安全 |
| `M1-F2` | `VERIFY` / 项目总控 | 业务父闭环：同一账户导入 / 同步书籍→连续阅读→划线 / 想法 / 老己笔记→失败保留→刷新与跨端恢复 | PDF、引用到会话、Mini与跨端互见及父级 V1 仍开放 |
| `M1-F2-A` | `VERIFY / FUNCTION DONE / VISUAL SUBGATES CLOSED` | 本地 EPUB / TXT / PDF 导入与统一书架功能已在 main；进度、normal、五态 / 四宽子门分别主线 PASS | 父包仍不代表 Reader / PDF / 双端完成；DESIGN-READY `350b86d9…8140` |
| `M1-F2-B` | `VERIFY / TXT READER CURRENT-MAIN PASS / PARENT OPEN` | TXT / EPUB 正文、位置、目录、背景与专注 scoped PASS；原生200% / DPR2 已补证 | PDF 与未覆盖 EPUB 组合仍开放；证据 `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `M1-F2-BOOK-DETAIL-VISUAL` | `VERIFY / CANDIDATE 7b0a671 / AUTH-BLOCKED` | 四个 Web 文件以成熟 SVG 替换裸文本图标，代码检查绿 | 真实1440×1024入口需认证后做非作者 EARLY；不用 ImageGen 画功能图标 |
| `M1-F2-C` | `VERIFY / SAFETY SEED MAIN d7e5ee6+589a22b` | PDF 安全首包覆盖样本、异常租约与版本缓存 | 真实 PDF.js / Canvas、owner fencing、持久恢复、续租 / 取消、DB / API / Web仍缺；生产依赖 / 许可证待授权 |
| `M1-F2-D` | `VERIFY / MAIN 95f782f / CURRENT-MAIN HANDOFF CASE PASS / PARENT OPEN` / 项目总控 | 同账户 TXT 真选区把书名、bookId、section / fileVersion、章节标题 / 顺序、UTF-16 字位与 quote 带入当前会话可编辑草稿且不自动发送；刷新保留，失败原位可重试且同 requestId 不重复 | candidate `64fed86` 实际4文件diff、定向22项、Web全量 / typecheck / build / visual-contract / diff-check通过；真实 Chrome 显示“第1节『第一章』（第6–12字）”，失败后草稿与1条用户消息刷新保留。既有 H4 因服务端 / Provider 未变化继续有效；PDF / Mini / 父项仍开放 |
| `M1-F2-D-ENTRY` | `VERIFY / BOOK DETAIL + HANDOFF SCOPED FINAL` | Book Detail 与当前书 PPT handoff 已有四宽、恢复和持久化证据 | 不代表真实下载 / PDF / AI；证据 `book-detail-main-final-0cc5d46/`、`dtext-handoff-early-101789e/` |
| `M1-F2-D-PDF` | `PENDING` / 待分配 | PDF 页定位上的划线、想法与手工笔记 | 等 M1-F2-C 真实页面 / locator / 渲染与持久化 |
| `M1-F2-D-TEXT` | `VERIFY / DESKTOP TXT SCOPED DONE / PARENT OPEN` / 项目总控 | 同账户 TXT 划线、想法、note CRUD、断服保留 / 重试、刷新恢复已 PASS | PDF、Mini production与父项仍开放；schema `read_notes_desktop_20260828_b`、最终2 highlights / 0 note |
| `M1-F2-D-TEXT-WEB-ENTRY` | `VERIFY / MAIN 1e7763a / SCOPED FINAL` | 768裁切、旧书 workspace 泄露、恢复 scroll 遮挡与200% / DPR2已关闭 | 文件上传、AI / PPTX与父项仍开放；证据 `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `M1-F2-E` | `VERIFY / OPEN / SPLIT` / 项目总控 | 业务父闭环：同账户 Web / Mini 共享书籍、位置、划线与笔记；owner / 版本合同已冻结 | E-XEND 依赖真实 F1 会话、M2-F1身份与对应内容能力 |
| `M1-F2-E-XEND` | `PENDING` / 待分配 | 同账户 Web / Mini 读取同一位置、划线与笔记并失败恢复 | 依赖 E-OWNER、F1、M2-F1、B / C / D；真实 AppID / 身份就绪后验收 |
| `M1-F2-WEREAD` | `DONE / MAIN 42188f6+273c691+ff80382 / CURRENT-MAIN CHROME PASS` / 项目总控 | 10文件Desktop消费接缝及3文件fail-once follow-up实际diff已审并顺序合main；候选与current-main真实Chrome均完成未连接→no-call连接→失败保留→同requestId重试→刷新恢复，console warn / error 0 | 定向28、Web全量291、typecheck / build / visual-contract / diff-check通过；真实WeRead Key / H4仍是独立授权门，不扩Server / contracts / Mini，也不代表父业务闭环完成 |
| `M1-F2-WEREAD-H4` | `VERIFY / MAIN f44284a / NONAUTHOR PASS / ADAPTER CODE GATE` / 项目总控 | 腾讯官方 WeRead Gateway Adapter 候选 `901bb04` 经独立 Grok 4.6 Reviewer PASS（Critical 0 / Important 0 / Minor 1）后精确进入 main `f44284a`；current-main 定向 Adapter 5/5、Server-only 211/211、Server typecheck、diff-check PASS，覆盖 Bearer、skill_version、api_name allowlist、errcode / upgrade_info fail-closed；全过程仅用合成凭证，不读取或调用真实 Key | Adapter 代码门已闭合，未冒充真实 Provider H4；下一步释放 Server HTTP/composition 与 Desktop H4。真实 Provider 调用仍单独受生产调用授权约束，Key 不进入聊天、源码、命令、日志、截图或台账 |
| `M1-F2-V1` | `PENDING` / 待分配 | 隔离账户完成导入、书架、文本 / PDF 阅读、划线、笔记、刷新恢复 | 依赖 A～E；真实文件、DB、视觉与可访问性 |
| `M1-F3A` | `VERIFY` / 项目总控 | 文本模型加密配置与真实 H4 已 PASS | 图片模型独立配置仍开放 |
| `M1-F3A-RUNTIME-REBIND` | `BLOCKED / LOCAL AUTH USER ACTION PENDING` / 项目总控 | 本轮保存失败演练重启 current-main API 后需把本机已保存 DeepSeek Key 重新绑定到新运行时加密主密钥；不新增供应商调用，不改变既有 H4 PASS | 唤醒=机主在 macOS Passwords / LocalAuthentication 系统提示以 Touch ID 或系统密码批准；系统未锁屏，当前仅等待本人认证，不绕过认证。随后仅安全摄入当前本地配置入口并清空剪贴板，Key 不输出、不落源码 / `.env` / 日志 / 截图 / 台账 |
| `M1-F3A-B` | `PENDING` / 待分配 | 图片模型独立配置、检测、撤销与失败保留 | 图片供应商 / 付费调用未确认；不得成为无图 PPT 前置 |
| `M1-F3B` | `VERIFY` / 项目总控 | 业务父闭环：同一账户从上下文发起真实连续会话并在失败 / 刷新后恢复 | Desktop 真实文字对话 H4 已闭合；图片消息、书籍上下文、Mini与父级 V1 仍开放 |
| `M1-F3B-B` | `PENDING` / 待分配 | 最多4图的纯图片 / 图文消息、预检、逐张移除与失败恢复 | 依赖对象存储和模型能力目录 |
| `M1-F3B-C` | `VERIFY / MAIN c858a06 / MAIN CHROME PASS / PARENT OPEN` | 简单选择、显式确认、历史只读、stale / failure恢复已通过 | 真实AI问题生成仍未覆盖；证据 `main-selection-focus-c858a06/FINAL-RECEIPT.json` |
| `M1-F3B-C-R2A` | `VERIFY / MAIN 30e0423+6e21cad / CODE PASS` | mutation丢响应、重试、multi / free、stale fencing 已进main | 只作父包底层证据，不单独代表用户闭环 |
| `M1-F3B-C-R2B` | `VERIFY / MAIN a08fbbc / CODE PASS` | assistant message 绑定、API / DB状态已进main | 只作父包底层证据，不单独代表共享 UI |
| `M1-F3B-D` | `DONE / MAIN b760142 / CURRENT-MAIN CHROME PASS` | Server `bac14b8` + Web `3422dc0+b760142` 已顺序进main且代码门通过；同一真实账户 TXT 真选区把书名 / bookId / 第1节“第一章” / UTF-16 42–46字 / quote 带入可编辑草稿且0 auto-send，明确“请整理成笔记”后1次真实 DeepSeek 回复并直接新增本书无标题笔记 | current-main Chrome 查看→编辑→刷新恢复→删除→刷新删除均 PASS；API 中断时保存正文与重试入口保留，恢复后原动作成功并清理验收笔记；最终会话请求 / 回复刷新仍在，console warn / error 0。Key 未输出；PDF / Mini / 图片 / PPT 不在本包 |
| `M1-F3B-V1` | `PENDING` / 待分配 | 两会话边界下完成文字 / 图片、停止恢复、选择与笔记整理 | 依赖 A～D；真实模型或明确 fake 边界、DB、视觉 |
| `M1-F4` | `VERIFY / B DONE / C CURRENT / PARENT OPEN` / 项目总控 | 会话 / PPT 业务闭环的共享免费体验与成本子包；A已完成，B已按新 TDD 因果审查规则闭合并进入 main | 当前推进 C；C通过后重算 V1；不把本技术子包单独冒充用户阶段 |
| `M1-F4-B` | `DONE / MAIN 1bb0b76 / TDD CAUSAL REVIEW PASS` / 项目总控 | 完整成本台账链 `695f6b0+b2b1e8f+cb2a51e+f47a990` 在 current-main scratch 无冲突且16/16+typecheck PASS 后顺序进入 main；current-main 再得 migration+store16/16、Server全量196/196、typecheck、diff-check PASS | 本包关闭；`quota-cost@f47a990` 仅保留恢复/审计现场并在本事件终态收据标 `absorbed → main@1bb0b76`，禁止重复集成；父 M1-F4 转 C |
| `M1-F4-B-REWORK-03` | `DONE / CANDIDATE f47a990 → MAIN 1bb0b76 / Grok 4.6 WRITER` | 同一 Assignment 先永久落两条同案攻击测试并由总控验证 pre-fix `2 FAIL / 10 PASS`，再完成两文件修复；final `f47a990` clean，候选 migration12/12、store4/4、typecheck、diff-check PASS | required TDD reviewer PASS 后已随完整四提交链顺序进入 main；Writer/文件租约终止，不得重复开发或单独再合 f47a990 |
| `M1-F4-B-REWORK-03-REVIEW-TDD` | `DONE / NONAUTHOR TDD CAUSAL PASS / Kimi K3 / candidate f47a990` | delivered ACK 在任何 repo tool 前独立完成且 ACK-only `tool_call=0`；reviewer 独立核 pre-fix source SHA、同一 test SHA `d0496518…508d0`，重放 RED=`2 FAIL / 10 PASS`、GREEN=`12/12 PASS`，`red_green_same_case=true`。额外反例：released direct INSERT=P0001、reserved+actual=P0001、same-ts settle-before-reserve=拒绝且 marker absent、same-ts reserve-before-settle=接受并保留2 audit；formal `verdict=PASS`，candidate 前后 clean | required review 已终止并释放只读租约；PASS 已被消费为完整链 current-main 集成与回归 |
| `M1-F4-C` | `DONE / SERVER + WEB HANDOFF CLOSED / PARENT F4 OPEN` / 项目总控 | AI / PPT 共用免费能力的失败/耗尽交接：硬上限耗尽且未配置自己的文本模型时，在当前输入/任务位置引导配置并保留输入、会话上下文与 PPT 草稿；平台能力失败原位可重试 | Server `main@99ef0ac` 与 Web `main@3c3e903` 代码门均闭合；真实 Chrome 分层 H3 已补齐，释放 `M1-F4-V1`。不代表正式平台免费模型成功路径或完整 PPT 已完成 |
| `M1-F4-C-SERVER-GATE` | `DONE / MAIN 99ef0ac / NONAUTHOR PASS` / 项目总控 | Checkpoint A 保持不变；Checkpoint B `b442418→fadad163` 经精确 RED→GREEN和原 reviewer PASS 后顺序成为 main `6bcc4a4→99ef0ac`；current-main 精确1/1、store23/23、能力+组合6/6、Server206/206、typecheck、diff-check PASS | Server 平台能力与 noteIntent 错误/重试合同冻结；释放 `M1-F4-C-WEB-HANDOFF`，不代表父 M1-F4-C 已完成 |
| `M1-F4-C-SERVER-GATE-B-CODEX-01` | `CLOSED / HOST DISCONNECTED / ZERO B WRITES / HEAD 929d1aa` | ACK/lease/runtime 曾有效；切换总控窗口后 spawned v2 Agent 被宿主卸载，direct queue 与 exec resume 均被拒绝；worktree 未出现 B 写入，runtime 已记 `terminal_state=disconnected` | 不恢复旧 parent controller；由 `M1-F4-C-SERVER-GATE-B-CODEX-02` 恢复 |
| `M1-F4-C-SERVER-GATE-B-CODEX-02` | `DONE / CANDIDATE b442418 / CODEX NATIVE RECOVERY` / owner=`codex-writer-b02` / session=`01a052c0-335a-7e52-97b9-589c3758d341` | 同一 lineage=`c7bf5a0b…6235`、recovery_count=1；合法 composition RED 后形成7文件产品候选，未重做A、无第9文件/安装/live provider/main或台账写入；canonical runtime 已记 terminal delivery PASS | Writer租约终止；候选仅进入非作者审查，不等于父 SERVER-GATE 或 M1-F4-C 完成 |
| `M1-F4-C-SERVER-GATE-B-CODEX-03` | `DONE / CANDIDATE fadad163 → MAIN 99ef0ac / CODEX NATIVE RECOVERY` / owner=`codex-writer-b03` / session=`01a052c0-335a-7e52-97b9-589c3758d341` | delivered ACK、late RED、两文件 GREEN、scope-only commit 与原 reviewer PASS 均闭合；runtime receipt=`CODEX-03:1:4` 为 transport completed / delivery PASS，同一 lineage recovery_count=2；无第9文件、A削弱、安装、live provider、main/台账写入 | Writer 与文件租约终止；候选已被 current-main 集成与回归消费，不得重复开发 |
| `M1-F4-C-WEB-HANDOFF` | `DONE / MAIN 3c3e903 / CURRENT-MAIN CONTROLLED H3 PASS` / 项目总控 | `a810c325 → f5e1b71` 六文件链经原作者 TDD 恢复与 `/root/web_handoff_code_review` PASS 后成为 main `ec9ca36 → 3c3e903`；current-main Web `296/296`、typecheck、build、视觉契约、diff-check PASS。真实登录 Chrome 4174 先验证领取从可见→成功隐藏，current schema `trial_grants` 0→1；已领取且无 verified 用户模型、正式 runtime 无 `platformModel` 时真实发送得到 `PLATFORM_UNAVAILABLE`，草稿“你好”保留。`PLATFORM_EXHAUSTION` 由 current-main Server/Store/Web 定向 `44/44` PASS（含额度拒绝不调用 provider、精确错误码/草稿保留）+ 临时本地 fault-injection 代理下的 current-main Chrome UI 验收闭合：专用“配置自己的 AI 模型后继续”与设置入口正确，设置往返 `/messages` 请求数 2→2、草稿仍在、无自动发送 | EXHAUSTION 浏览器证据明确是受控故障注入，不冒充正式 Server 已有平台模型成功路径；验收结束后 current schema 测试 grant 精确回滚 1→0、临时4175/4323关闭、真实4174/4322保留。H3 本包关闭，下一缺口转 `M1-F4-V1` |
| `M1-F4-V1` | `PENDING / PLATFORM RUNTIME SUCCESS PATH MISSING` / 项目总控 | 领取、AI / PPT消耗、失败恢复和并发硬上限 Case | A～C 已闭合；当前正式 Server 未注入 `platformModel`，领取后无法走平台免费文本成功路径。先完成最小平台文本 runtime 接线与代码门；真实 Provider H4 / 计费另受授权，不在错误态 H3 中伪造 |
| `M1-F5` | `PENDING` / 项目总控 | 业务父闭环：书籍 / 会话带上下文→范围 / 需求→大纲 / 模板→生成→可编辑 PPTX 下载 | F4-V1、对话选择、阅读与外部生成边界 |
| `M1-F5-A` | `PENDING` / 待分配 | 对话 / 书籍双入口、单书来源、范围 / 需求与任务工作区 | 依赖 M1-F4-V1、F2、F3B-C |
| `M1-F5-B` | `PENDING` / 待分配 | 公开资料补全、大纲生成、分层编辑与自动保存 | 依赖 A与文本模型；联网 / 预算需授权 |
| `M1-F5-C` | `PENDING` / 待分配 | 三套16:9青瓷模板、真实预览与选择 | 依赖 B；`39b84a4`仅Presenton种子 |
| `M1-F5-D` | `PENDING` / 待分配 | 任务幂等、Worker租约、停止 / 重启恢复与Presenton适配 | 依赖 C；版本、安全、许可证与真实进度不明时暂停 |
| `M1-F5-E` | `PENDING` / 待分配 | 生成中、停止、失败、重试、修改大纲、删除与完成瀑布流 | 依赖 D |
| `M1-F5-F` | `PENDING` / 待分配 | 作品列表、独立再生成、签名下载与可编辑PPTX | 依赖 D / E |
| `M1-F5-V1` | `PENDING` / 待分配 | 三份中文PPTX在PowerPoint / WPS打开、编辑、重存 | 依赖 C～F；真实软件 / 环境 / 费用需授权 |
| `M1-V1` | `PENDING` / 待分配 | 同一真实邮箱完成登录→导入→阅读→AI→额度 / 配置→PPTX | 依赖 M1-F1～F5 V1与邮件 / 模型 / Presenton授权 |
| `M2` | `VERIFY` / 项目总控 | Mini 端身份、导航、系统适配与各业务父闭环的端侧技术分组，不是独立用户父闭环 | 真实身份、production API、跨端互见与完整PPTX仍开放 |
| `M2-UX-CONTRACT-ALL` | `VERIFY / HISTORICAL CONTRACT DONE / CURRENT DESIGN-READY RETURNED` | 六路由历史合同仅作设计输入；Reader / Drawer最新门已分别回写子包 | 仍缺若干真实键盘、reduced-motion、production与五态；后续只按具体包复验 |
| `M2-F0-A` | `VERIFY / f312@992bf2a / CONTROLLED VISUAL SCOPED PASS` / 项目总控 | 六页、Drawer、输入 / 键盘层、底部面板与客户端状态 | 软件键盘、游客 clean-console、真实PPT preview及production仍开放；唯一f312 |
| `M2-F0-A-H3-REWORK` | `BLOCKED / KEYBOARD + CREDENTIAL H3` / 项目总控 | 仅保留真实软件键盘与非游客 clean-console外部门 | 唤醒：真实键盘环境或授权AppID / 非游客DevTools；不再改可控视觉源码 |
| `M2-F0-A-MINI-CONVERSATION-VISUAL` | `VERIFY / MAIN 11f480a / SCOPED PASS` | normal / selection / attachment、发送 / retry / 恢复视觉已有证据 | 软件键盘、长列表、reduced-motion与真实AI不在本包 |
| `M2-F0-A-MINI-DRAWER-ASSET` | `VERIFY / F312 f8b3cfc / ASSET SUBEVIDENCE` | IMG-06运行时v5 PNG与slot / mask已进唯一f312 | Alpha / 资产存在不代表整页；运行时资产冻结 `c0086fab…29fdb` |
| `M2-F0-A-MINI-DRAWER-STRUCTURE` | `VERIFY / F312 992bf2a / SCOPED PASS` | 430 / 390 / 360 / 320 normal与long-list结构证据已并入Drawer结论 | production仍空；只在新证据否定时重开 |
| `M2-F0-A-MINI-DRAWER-VISUAL` | `BLOCKED / CONTROLLED VISUAL CLOSED / EXTERNAL H3` | ref11四宽normal / long-list、独立滚动、山景 / 底栏与横溢由非作者通过 | 唤醒：真实AppID / 非游客同一f312 clean-console；证据 `mini-drawer-f312-final-992bf2a/` |
| `M2-F0-A-MINI-SETTINGS-STATE` | `VERIFY / MAIN 14b69dc / SCOPED NO-GO` | normal与fail-closed文案 / 数据行为通过 | 游客 `WAServiceMainContext` 5 errors / 9 warnings未闭合；证据 `mini-main-35bad75-14b69dc-final-review/` |
| `M2-F0-A-READER-SHORT` | `VERIFY / MAIN 7f59698 / SCOPED EARLY PASS` | refs18～20的notes normal / delete-failure / retry / success / empty与sheet手势闭合 | production / 跨端父门仍开放；DESIGN-READY `59acd56d…b3a58` |
| `M2-F0-A-SCREEN-ADAPT-ALL` | `VERIFY / LIMITED PASS / H3 OPEN` | Reader与Conversation限定响应式结论保留；Drawer可控矩阵已另闭合 | 软件键盘、游客console与真实PPT preview仍开放 |
| `M2-F0-A-VISUAL-REWORK` | `VERIFY / MAIN 11f480a / SCOPED PASS` | Reader、Conversation、send / retry / attachment缺陷已关闭 | Drawer与production按各自任务行，不扩大父包 |
| `M2-F1` | `VERIFY / SERVER MAIN 86c30a8 / MINI MAIN 9f11b89 / F312 04b5f03` | fake exchange + opaque Bearer、session expiry与动态Authorization本地合同PASS | production需 apiBaseUrl / AppID / Secret / 域名；游客console不冒充登录完成 |
| `SHARED-WEREAD-API` | `DONE / MAIN 1f922ba / CONTRACT PASS` / 项目总控 | `81f1624+86726fd+1775e21+1f922ba` 已顺序进入main：PUT显式CAS（首次为`null`）、local / provider ID、多记录 / opaque cursor / last-success失败保留与公开package导出均已审 | contracts 11项、typecheck、diff-check PASS；本包只冻结共享JSON契约，不扩HTTP / Key / H4，下游实现已释放 |
| `SHARED-WEREAD-BOOK-ID` | `DONE / MAIN 489d51d / CONTRACT PASS` / 项目总控 | books snapshot以 `WeReadBookProjection` 同时输出 account-owned local `bookId` 与 provider `externalId`，保留opaque cursor、multi-record与last-success；不改provider对象 / HTTP / Key。Grok OAuth进程exit 0但实际worktree零diff，未冒充候选；总控按已锁RED完成共享接缝 | 定向9项、contracts typecheck、全仓typecheck、diff-check PASS；精确提交已同步Web / Mini并取得新Assignment delivered ACK，外部worktree已回收 |
| `M2-F2` | `VERIFY / MAIN 43f1fc3 / DEV-WEREAD NONAUTHOR PASS / SCOPED MAIN CLOSED` / 项目总控 | 完整已审链已无手改顺序进入 main：`b36868e→1ea04e0→ad9d9fe→d0d683b→45c0d5e→43f1fc3`；main 定向63、Mini237、typecheck、真实 build/package-size PASS。F1/F2 stale replay、账号替换隔离、断开保留与 develop-only no-call 边界均保留。用户已明确回执完成此前规定的剩余 GUI 检查操作，作为人工 witness receipt；DevTools 日志不记录业务点击，故不伪造机器独立重放证据 | develop-only scoped Goal 关闭，不再重复开发/改派；父级 production 仍依赖真实 Key / AppID / apiBaseUrl / 域名与非游客环境，按既有 H3 门保持 VERIFY |
| `M2-F2-MAIN-INTEGRATION-CHAIN` | `DONE / CONTROLLER VERIFIED / KIMI ACK NONCOMPLIANT` / 项目总控 | Kimi 只读审计证据证明最小运行前置为 `370159e→0c84357→08d9597→f6a08f9`，并证明旧 `73a0f11/e4ed48e/7667456/c60ce3a` 与 f312 前四笔 patch-id 等价；但该 Kimi 会话先用 Git 工具后才输出文字，未满足 pre-tool delivered ACK，故不冒充合规 Assignment PASS。总控随后在独立 scratch 实证完整用户链六笔顺序零冲突 | scratch 定向63/63、Mini237/237、typecheck PASS；同六笔随后原样进 main 并重复通过同等代码门，任务结案 |
| `M2-F3` | `VERIFY / MAIN 11f480a / PARENT OPEN` / 项目总控 | 会话抽屉、文字 / attachment、失败保留 / retry与刷新 scoped PASS | 真实API、软件键盘、clean-console与reduced-motion仍开放 |
| `M2-F3-MINI-CONVERSATION-API` | `VERIFY / MAIN de92f50 / F312 d60716a / PROD H3 BLOCKED` | hydrate / create / send、草稿 / 上下文恢复、失败映射与同requestId重试已实现 | production依赖M2-F1 bearer / base URL / AppID / 域名；矛盾测试WIP只按第5节稳定归档收据在本包重诊断时取证 |
| `M2-F3-MINI-CONVERSATION-LONG-LIST` | `VERIFY / MAIN 35bad75 / SCOPED NO-GO` | developmentLongList 18项、搜索与末项露出已实现 | clean-console / production不在本包；既有 query 模式只供唯一f312复验 |
| `M2-F3-MINI-CONVERSATION-SEND-RETRY` | `VERIFY / MAIN 11f480a / SCOPED FINAL PASS` | 本地text / attachment发送锁、失败原位retry、刷新无重复与anchor通过 | 真实AI/API、软件键盘、clean-console与long-list不在本包 |
| `M2-F4` | `VERIFY / MAIN b98c118 / READER SCOPED FINAL / LIBRARY PROD H3` | 阅读与笔记业务父闭环的 Mini 子包：统一书架、连续正文、面板、notes与背景恢复部分闭合 | Library真实服务仍依赖M2-F1与production环境；不返工已通过Reader |
| `M2-F4-A` | `VERIFY / F312 4cdce97 / MAIN d2bf9a0 / SCOPED PASS / PROD H3` / 项目总控 | candidate `cda7b4d` 已补真实 `onSearch→listBooks(query)`、失败保留与stale fencing；root审累计diff，唯一f312定向30、Mini194及 main 定向30、Mini177、两处typecheck/build/diff-check全绿；DevTools development态真实从3书筛至1书 | production hydrate / 失败恢复仍由 Bearer / apiBaseUrl / AppID / 域名H3验证，不冒充真实服务PASS；已合候选 worktree 同事件回收 |
| `M2-F4-B` | `DONE / MAIN d1ad128+0bf4fa4 / NONAUTHOR PASS` / 项目总控 | production text-reader HTTP adapter与UTF-16 source↔trimmed-display双向换算已顺序进main；leading / trailing whitespace、non-BMP、hydrate→restore→save、stale / malformed / 401边界由实际diff与非作者复审覆盖 | reviewer定向24、全仓typecheck、diff-check PASS；main定向24、Mini typecheck / build、visual-contract、diff-check PASS；clean候选worktree已同事件回收，父 `M2-F4` production真实端门仍独立开放 |
| `SHARED-TEXT-LOCATOR-UTF16` | `DONE / MAIN ef10a9d+5fcd559 / ROOT PASS` | 两文件累计diff以PostgreSQL scalar `char_length + regexp_count(non-BMP)` 对齐JavaScript UTF-16 offset，避免整章正文回传Node；emoji PUT / DB持久化与查询形态均有回归 | 候选定向8项；main text-reader / integration / annotation 3文件11项、Server typecheck / build、diff-check PASS；已释放`M2-F4-B@6f7cc87` |
| `M2-F5` | `PENDING` / 待分配 | 账户、模型与退出的Mini端闭环 | 微信读书消费已归 `M2-F2`；其余依赖M2-F1～F3，高风险流程按场景细拆 |
| `M2-F6` | `VERIFY / HANDOFF SCOPED DONE / MAIN e334265 / FULL FLOW OPEN` / 项目总控 | 书籍→当前会话 draft/context scoped final 已进 main 并通过 current-main 代码门与唯一微信 DevTools 真实端；不再重复开发或重派该 handoff | 完整 AI / 大纲 / 模板 / PPTX 仍依赖 M2-F3、F4、M1-F5 与下载域名；父业务闭环继续开放 |
| `M2-F6-MINI-PPT-DRAFT-HANDOFF` | `DONE / MAIN e334265 / CURRENT-MAIN DEVTOOLS PASS` | current-main adaptation `9132809` 经独立 Kimi K3 非作者 PASS 后顺序进入 main；main 定向65/65、Mini243/243、typecheck、build/package-size 1,573,572/2,097,152、diff-check PASS。唯一微信 DevTools 真实 `dev-local-ink / 山窗读书札记`：发送前 `draft=帮我制作这本书PPT`、handoff.phase=draft、pptIntent=null、sheet=false；发送后 handoff=null、pptIntent.phase=awaiting-confirmation、sheet=true、messages 64→66 | scoped handoff 已关闭并释放文件租约；完整 AI / 大纲 / 模板 / PPTX 仍走父 `M2-F6 / M1-F5`，不得整支 f312 合入 |
| `M2-F6-MINI-PPT-DRAFT-HANDOFF-REVIEW` | `DONE / NONAUTHOR PASS / Kimi K3 / DELIVERED ACK f01b184 / session_d6023358-b0ee-4470-96f7-02591579a3c0` | 原 session 经一次受控恢复后产出 `PASS_TO_CONTROLLER`；全过程 observed modified files=0。累计6文件语义 PASS，current-main 3文件基线59/59 PASS；精确候选测试因 reviewer workspace 边界不可执行，未冒充已跑 | current-main 集成风险已界定为 adaptation 而非直接 cherry-pick：四文件语义可直接承接，conversation 实现/测试需保留 main 新 hydration/persistence 后重织三处 handoff；reviewer 任务终止，不再占槽 |
| `M2-F6-MINI-PPT-DRAFT-HANDOFF-MAIN-ADAPT` | `DONE / CANDIDATE 9132809 → MAIN e334265 / Kimi K3 WRITER` | Writer 先得真实 RED=9 fail/56 pass，再完成恰好6 owned files；候选 targeted65/65、Mini243/243、typecheck、build 1,573,572/2,097,152、diff-check PASS，final=`CANDIDATE_READY_FOR_CONTROLLER`；非作者通过后由总控顺序 cherry-pick 到 main | current-main 同等代码门与真实 DevTools final 均 PASS；clean candidate worktree 已同事件回收，Writer/文件租约释放 |
| `M2-F6-MINI-PPT-DRAFT-HANDOFF-MAIN-ADAPT-REVIEW` | `DONE / NONAUTHOR PASS / Kimi K3 / session_669da28f-dd07-491a-96bd-e3f074b66c44` / `kimi-k3-m2f6-ppt-main-review` | delivered ACK 严格先于任何 repo tool；只读审 `9132809` 相对 `e088bbd` 的6文件实际 diff，对照 SPEC/TECH 语义并独立取得 targeted65/65、Mini243/243、typecheck、diff-check PASS，observed modified files=0；terminal=`PASS_TO_CONTROLLER`，Kimi state=`lastTurnReason=completed` | reviewer 已自然结束且不再占槽；PASS 已由总控消费为 `main@e334265` 集成、current-main 回归与真实 DevTools final |
| `M2-V1` | `PENDING` / 待分配 | 业务父闭环：同账户 Web / Mini 完成身份、书籍、阅读笔记、会话、额度 / 模型与PPTX互见 | 依赖M2-F1～F6、真机、DB与外部授权 |
| `M3` | `PENDING` / 待分配 | 业务父闭环：隐私 / 删除、备份恢复、迁移、监控、Staging、Web与小程序发布安全闭环 | 依赖M2-V1及法务 / 服务器 / 域名 / 备案 / 平台 / 发布授权 |

## 3. 完成历史（压缩）

| ID | 状态 / 结果 / 提交 | 证据与边界 |
| --- | --- | --- |
| `M0` | `DONE / 2b639e0` | 可运行工作区、健康检查与确定性本地PPT基线 |
| `STAGE-READ-NOTES-V1-A` | `DONE / CURRENT-MAIN TXT REAL CASE` | 导入→阅读→划线→想法→note CRUD→断服保留 / 重试→刷新恢复；`read_notes_desktop_20260828_b` |
| `STAGE-READ-NOTES-V1-B` | `DONE / SERVER f7cf45c / MINI 82f6b84 / F312 d4f3dd0` | PUT / PATCH兼容、开发适配器notes失败保留 / 重试；production门未冒充通过 |
| `STAGE-READ-NOTES-V1-C` | `DONE / CURRENT-MAIN READER 200% + DPR2` | `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `STAGE-READ-NOTES-V1-D` | `DONE / MAIN e36bc37 / CURRENT-MAIN PASS` | Book Detail动作SVG、focus、overflow、console；真实下载未覆盖 |
| `STAGE-READ-NOTES-V1-H` | `DONE / MAIN 95f782f / CURRENT-MAIN PASS` | TXT真选区携带书籍 / 精确位置 / quote到当前会话可编辑草稿且不自动发送；刷新、失败原位重试与同requestId不重复通过，既有Desktop H4在Provider未变化前提下复用 |
| `M1-F2-R1` | `DONE / 0204@9783628 READ-ONLY` | 38路径对账，无唯一未吸收实现；status `3bbbcce3…e79cbb` |
| `M1-F2-R2` | `DONE / TECHNICAL PDF BOUNDARY` | 文本 / 图片 / 加密 / 损坏PDF边界冻结；`67d77d7`仅种子 |
| `M1-F2-A-PROGRESS` | `DONE / MAIN 9c18842` | 批量进度、UTF-16、owner / stale / 非文本合同；15项与DB证据 |
| `M1-F2-A-LIBRARY-NORMAL` | `DONE / MAIN ba5a836` | ref03 normal、真实进度、五列、DPR2；`desktop-library-progress-main-ba5a836/` |
| `M1-F2-A-LIBRARY-STATES` | `DONE / MAIN 3e1904f / CURRENT-MAIN REAL PASS` | 四宽4/4/3/2、五态、卡级三态、失败保留 / GET重试、focus / overflow / console PASS |
| `M1-F2-BC-S1` | `DONE / 44b81ea` | fileVersion、文本 / PDF locator、owner FK、条件更新与 `STALE_VERSION` |
| `M1-F2-B-UX1` | `DONE / 804f952 / FOCUS PASS` | reader浅深 / 专注 / focus合同；200%证据已由Stage C补齐 |
| `M1-F2-D-TEXT-INTEGRATION` | `DONE / MAIN f85d86c` | 定向19、全仓123、typecheck / build；只关闭共享集成 |
| `M1-F2-D-TEXT-PPT-HANDOFF-FIX` | `DONE / MAIN 1e7763a` | 当前书匹配 / fail-closed、scroll重置；`dtext-handoff-early-101789e/FINAL-RECEIPT.md` |
| `M1-F2-D-TEXT-READER-768-FIX` | `DONE / MAIN cc0cec0` | 768 / 1440长标题、toolbar、目录、背景 / 专注 / 笔记与overflow0 |
| `M1-F2-E-OWNER` | `DONE / MAIN f1334ad / NONAUTHOR PASS` | owner / 版本锁序、两账户、迁移重复 / 回滚、并发与旧版本拒绝 |
| `M1-F3A-A` | `DONE / MAIN 5f3b1bf + 0b1402f / H3 PASS` | AES-256-GCM、脱敏、替换 / 撤销、revision与失败回归；不等于自由聊天 |
| `M1-F3A-V1` | `DONE / REAL H4 PASS` | DeepSeek连续上下文、刷新、断网草稿 / 重试；6次观测且≤¥1，Key不落盘明文 |
| `STAGE-CHAT-V1` | `DONE / DESKTOP REAL H4 PASS` | 已保存配置→首轮→第二轮→刷新→失败保留 / 重试；10消息 / 5 request pairs |
| `M1-F3B-A` | `DONE / MAIN dea90d7` | Conversation确定性纵切、持久化、失败重试、四宽；`main-conversation-final-dea90d7/` |
| `M1-F3B-A-CONVERSATION-SLICE` | `DONE / MAIN dea90d7` | new / search / quota、owner、focus、console / overflow；同一纵切证据 |
| `M1-F3B-A1-CONVERSATION-CORE` | `DONE / MAIN dea90d7` | PG会话 / 消息、API、Web、幂等、发送锁与hydrate竞态 |
| `M1-F3B-A2-RESPONDER-CONTRACT` | `DONE / MAIN 934e654 + 2cddc3c / REAL H4` | DeepSeek适配、完整context、fail-closed、失败草稿 / 重试 |
| `M1-F3B-A3-MESSAGE-ROLES-VISUAL` | `DONE / MAIN 27edac8 + 2316a91` | 用户右 / 老己左、头像外置、selection与focus；`main-message-roles-2316a91/` |
| `M1-F4-A` | `DONE / MAIN ed489a8` | 一次性领取、grant / owner / focus与刷新隐藏；`main-quota-ed489a8/FINAL-RECEIPT.md` |
| `SHARED-WEREAD-SYNC` | `DONE / MAIN f1994a0+db4d098 / CONTRACT PASS` | 共享JSON合同与明确fake adapter；opaque分页、多记录 / 显式N+1、隔离、percent / UTC、连接级upgrade fail-closed、hint脱敏与空定位归一；main定向16、全仓655、typecheck / build / visual-contract通过，真实HTTP / Key / H4不在本包 |
| `AUDIT-ALL-1` | `DONE / READ-ONLY` | 25路线包分类与缺口审计；未写代码 / DB |
| `M1-UX-SYSTEM-AUDIT` | `DONE / b38ed4d / FAIL BRIEF` | F01～F09、参考SHA、文件所有权与验收Case |
| `M1-WEB-SHELL-01` | `DONE / MAIN deba325 / NONAUTHOR PASS` | 单rail、路由 / 刷新 / 断网恢复、1440 DPR2；`44e66af`候选 |
| `M2-R0` | `DONE / 42d85fe→925bbc1 READ-ONLY` | 旧Mini候选只作选择性复用种子，不继承工作树 |
| `M2-F0-A-MINI-DRAWER-UX-BRIEF` | `DONE / EARLY FAIL BRIEF` | ref11 + IMG-07结构 / Token / 响应式；`EARLY-BRIEF.md` SHA `075482b1…2842` |
| `M2-F0-A-MINI-NOTES-VISUAL-REWORK` | `DONE / MAIN 7f59698 / F312 9766be9` | normal / delete-failure / retry / success / empty；Mini153、visual-contract绿 |

## 4. 外部图片调用账本

| 序号 | 状态 | 调用与输出 | 账本 |
| --- | --- | --- | --- |
| `IMG-01` | `REJECTED` | 书架远山候选含烧录棋盘格；`desktop-right-canvas-mountains-transparent-v1-candidate.png` SHA `2879ee0d…c6178` | 1 / 20 |
| `IMG-02` | `REJECTED` | Alpha修复仍失败；v2 SHA `91acb39e…00115` | 2 / 20 |
| `IMG-03` | `APPROVED / RUNTIME` | Desktop远山运行时 `desktop-right-distant-mountains-transparent-v1.png` SHA `2d6d7088…7229f0f` | 3 / 20 |
| `IMG-04` | `ASSET ALPHA VERIFY / INTEGRATED VISUAL FAIL` | Mini Drawer旧山亭资产 `27c78c48…e3bdb4`；不代表整页PASS | 4 / 20 |
| `IMG-05` | `CANDIDATE / UIUX REVIEW REQUIRED` | Reader背景sheet候选 `reading-background-sheet-imagegen-v1-candidate.png` SHA `fd268146…41188` | 5 / 20 |
| `IMG-06` | `SELECTED FOR LOCAL POSTPROCESS / NOT VISUAL PASS` | Drawer v5源 `mobile-drawer-landscape-imagegen-v5-raw-candidate.png` SHA `21c483b1…7ecbc` | 6 / 20 |
| `IMG-07` | `CANDIDATE / NOT RUNTIME` | Drawer整页纠偏候选 `mobile-drawer-correction-imagegen-v7-candidate.png` SHA `ab0d5dfb2021d39798b1a93550c40f97f638678341986dcb146afecf838838a2` | 7 / 20，剩余13 |

## 5. 授权、共享环境与保护现场

- 本地验证合格后的本地 `main` 集成已授权；普通已验证、范围单一且已顺序集成 `main` 的代码 / 文档提交可直接以非强制快进方式 push 到现有远端并回读 revision。2026-09-01 已完成一次历史边界审计：`db02b5b→018e084` 共684个提交、4146个待传对象 / 1776个 blob，路径与对象完整性通过，未发现真实私钥、云密钥、平台令牌、真实 `.env` 或异常大对象；公开仓库的三份 DOCX 只检出已登记作者“哈罗”，未检出邮箱、手机号或密钥格式。随后经 HTTPS 对同一 GitHub 仓库普通快进推送，并由 GitHub API、`ls-remote` 与本地 tracking 三重回读确认 `main=origin/main=018e084`；SSH 22端口仅为当前网络不可达，不构成仓库风险。force push、PR 合并、发布、部署、删除、生产数据变更、真实邮件 / 微信、微信读书 / Presenton、小程序审核及其他付费调用仍未授权。
- 用户已授权 SelfAlone 测试安全读取本机保存的 DeepSeek Key，后续项目内测试调用无需重复确认；既有 H4 总观测6次且≤¥1。Key不得进入聊天、源码、`.env`、命令参数、日志、截图或台账，授权不扩展到生产、其他项目或无限费用。
- ImageGen总授权20次，已用7次、剩余13次；已有参考先忠实实现，功能图标不用栅格生图。
- 唯一 Mini DevTools 常驻入口为 `/Users/echoman/.codex/worktrees/f312/SelfAlone/apps/miniapp`。隔离writer不得新增长期入口。
- 当前 worktree 共2个：main 与唯一 `f312@f6a08f9`。f312 继续作为唯一 Mini DevTools / visual-qa 现场，代码已由 `main@43f1fc3` 等价吸收；其本机 AppID 配置、lockfile workspace 登记与205份 visual-qa 文件继续保持未提交 / 不推送，QA 集合指纹 `5fbd83a5…6b41`。`quota-cost@f47a990` 的完整成本链已等价顺序进入 `main@1bb0b76`，clean worktree 已于2026-09-01回收，恢复分支 `codex/m1-f4b-cost-ledger` 保留，禁止重复集成。旧 `m1-f4c-server@08b86254` 的两文件局部 WIP 已被 `main@99ef0ac` 完整实现取代，现以稳定 stash 对象 `3840b17546b1e592e7aa78389a562c88cd532a10`（标题含原路径与 HEAD）归档后移除 worktree；依赖安装产物未归档。不得为 reviewer / 占位 / 纯消息任务新建长期 worktree。历史归档 stash 共13条。
- main 两处相互矛盾的 Mini conversation 测试 WIP 已归档为稳定 stash 对象 `0bc24868359483fe7d52f9061d76b9f7d81a7000`，标题 `archive: unresolved mini conversation test WIP 2026-08-28`；不记录可变序号，不作为候选或 PASS。redesign-v2 顶层3份重复DOCX与3个Word锁文件已移至可恢复废纸篓 `/Users/echoman/.Trash/SelfAlone-redesign-duplicates-20260828-Uxchkc`，原文逐字节SHA与 `raw_sources/context-governance/` 对应文件一致；main 仅余4个未跟踪视觉候选路径、共39个文件 / 31,300,043 bytes，集合指纹 `7837df3a…358e`，继续受保护且不得作为运行时资产或PASS。共享PostgreSQL只证明副作用，开发 / QA使用隔离schema并记录owner与恢复点。
