# SelfAlone 任务台账

> 唯一执行控制面。只记录当前 Goal、活动任务、下一步、真实阻塞、规则版本、任务状态与可复用证据；产品、视觉和技术规则分别以 [SPEC](redesign-v2/SPEC.md)、[DESIGN](redesign-v2/DESIGN.md)、目标端规范、[参考索引](redesign-v2/design-reference/README.md) 与 [TECHNICAL](redesign-v2/TECHNICAL.md) 为准。

## 1. 当前控制面

- 当前 Goal：`STAGE-READ-NOTES-V1-H ACTIVE`；Desktop TXT / EPUB 选中正文经现有“和老己聊聊”带入当前会话可编辑草稿，不自动发送；发送、失败保留 / 重试与刷新恢复复用已稳定真实会话能力。PDF、Mini、PPT、图片、视觉重设计与成本系统不在本 Goal。
- 当前活动项：无
- 下一可见检查点：writer 回传完整 ACK 与首个 RED（当前 Reader 入口只跳普通 `#/conversation`、quote / book identity 未进入 composer）；随后冻结单一候选并做非作者验证。
- 当前阻塞：Mini production 仍受 AppID / apiBaseUrl / 域名与非游客 DevTools 门约束；Mini Drawer clean-console 与软件键盘只受外部 H3 约束；Desktop Auth 专用背景 / Logo seal未绑定；真实 PDF 页面能力受生产依赖 / 许可证授权门约束。各门只阻塞依赖包。
- 规则版本：减法迁移输入基线 `main@9c43e68` 与受保护现场已对账；总控已加载 `adaptive-delivery@36f71943cd4bf85fb2bf3abdeaf2e8e88a68ba2f`，SKILL `aeb0246b…e7634`、long-task `ef3c9372…b13de`、methods `109f5fab…e59`。
- 容量 / READY：root + 1 个 ACK PENDING writer 共 2/4、可用 2、live 子任务 1、待审 / 待集成候选 WIP 0。`M1-F2-D` 已派发；`M1-F4-B` 只读诊断为 READY，但属于下一可靠性 Goal且与当前唯一共同验收无关，不抢占本 Goal核心线；其余开放包继续保留在 READY 宇宙。

## 2. 开放工作包

`VERIFY` 行保留当前完成边界与精确缺口；`READY / PENDING` 行只保留释放条件；`BLOCKED` 行保留外部唤醒事件。当前没有 `ACTIVE / RECOVERING`。

| ID | 状态 / owner | 固定边界与当前证据 | 依赖、阻塞与下一步 |
| --- | --- | --- | --- |
| `M1-F1` | `READY` / 项目总控 | 桌面邮箱身份、会话与账户设置父闭环 | A / B 已局部主线 PASS；V1 仍需真实邮箱、找回、修改与数据保持 Case |
| `M1-F1-A` | `VERIFY / MAIN b6b77ee / MAIN CASE PASS` | 注册、登录、退出与桌面认证 UI 已集成；真实邮件 / 微信与 reduced-motion 未覆盖 | 证据 `auth-early-b7a6894/`、`main-auth-settings-final-d9a3b46/`；保持父包开放 |
| `M1-F1-A-AUTH-EARLY` | `VERIFY / CANDIDATE faa194d / ASSET BLOCKED` | entry→register→login 状态 SELF PASS；候选仅六个 Auth Web 文件 | ref01 `d49f5a61…a824`；绑定 Auth 专用背景 / Logo seal 后再 EARLY，不得自由设计或临时替代 |
| `M1-F1-B` | `VERIFY / MAIN a9408ad / P0 MAIN FINAL PASS` | 邮箱 / 密码修改与设置 failure / focus 已闭合；敏感密码不持久化 | 真实邮件、成功换邮、微信绑定与 reduced-motion 仍独立开放；证据 `main-settings-p0-final-a9408ad/` |
| `M1-F1-B-SETTINGS` | `VERIFY / MAIN a9408ad / REOPEN CLOSED` | legacy v1 清洗密码、失败保留内存字段、刷新 / 新标签仅恢复邮箱 | 定向12项、Web231项；后续只验真实服务边界 |
| `M1-F1-V1` | `PENDING` / 待分配 | 同一真实邮箱完成注册、重登、找回和账户修改，既有书籍不丢 | 依赖 A / B 与真实邮件授权；真实浏览器、DB、令牌安全 |
| `M1-F2` | `VERIFY` / 项目总控 | 桌面导入、书架、文本阅读与笔记已有多个 scoped PASS | PDF、引用到会话、跨端互见及父级 V1 仍开放 |
| `M1-F2-A` | `VERIFY / FUNCTION DONE / VISUAL SUBGATES CLOSED` | 本地 EPUB / TXT / PDF 导入与统一书架功能已在 main；进度、normal、五态 / 四宽子门分别主线 PASS | 父包仍不代表 Reader / PDF / 双端完成；DESIGN-READY `350b86d9…8140` |
| `M1-F2-B` | `VERIFY / TXT READER CURRENT-MAIN PASS / PARENT OPEN` | TXT / EPUB 正文、位置、目录、背景与专注 scoped PASS；原生200% / DPR2 已补证 | PDF 与未覆盖 EPUB 组合仍开放；证据 `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `M1-F2-BOOK-DETAIL-VISUAL` | `VERIFY / CANDIDATE 7b0a671 / AUTH-BLOCKED` | 四个 Web 文件以成熟 SVG 替换裸文本图标，代码检查绿 | 真实1440×1024入口需认证后做非作者 EARLY；不用 ImageGen 画功能图标 |
| `M1-F2-C` | `VERIFY / SAFETY SEED MAIN d7e5ee6+589a22b` | PDF 安全首包覆盖样本、异常租约与版本缓存 | 真实 PDF.js / Canvas、owner fencing、持久恢复、续租 / 取消、DB / API / Web仍缺；生产依赖 / 许可证待授权 |
| `M1-F2-D` | `READY / DISPATCHED ACK PENDING` / `/root/reader_chat_handoff_writer` | 文本标注、想法、手工笔记、详情入口已有 scoped PASS；当前包只连接 TXT / EPUB 精确引用→现有会话草稿 | worktree `readchat@b376a5b`；完整 ACK 前停写，随后 RED→候选→current-main Chrome；PDF与父级完整入口仍开放 |
| `M1-F2-D-ENTRY` | `VERIFY / BOOK DETAIL + HANDOFF SCOPED FINAL` | Book Detail 与当前书 PPT handoff 已有四宽、恢复和持久化证据 | 不代表真实下载 / PDF / AI；证据 `book-detail-main-final-0cc5d46/`、`dtext-handoff-early-101789e/` |
| `M1-F2-D-PDF` | `PENDING` / 待分配 | PDF 页定位上的划线、想法与手工笔记 | 等 M1-F2-C 真实页面 / locator / 渲染与持久化 |
| `M1-F2-D-TEXT` | `VERIFY / DESKTOP TXT SCOPED DONE / PARENT OPEN` / 项目总控 | 同账户 TXT 划线、想法、note CRUD、断服保留 / 重试、刷新恢复已 PASS | PDF、Mini production与父项仍开放；schema `read_notes_desktop_20260828_b`、最终2 highlights / 0 note |
| `M1-F2-D-TEXT-WEB-ENTRY` | `VERIFY / MAIN 1e7763a / SCOPED FINAL` | 768裁切、旧书 workspace 泄露、恢复 scroll 遮挡与200% / DPR2已关闭 | 文件上传、AI / PPTX与父项仍开放；证据 `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `M1-F2-E` | `VERIFY / OPEN / SPLIT` / 项目总控 | owner / 版本合同已冻结；跨端真实验收未完成 | E-XEND 依赖真实 F1 会话、M2-F1身份与对应内容能力 |
| `M1-F2-E-XEND` | `PENDING` / 待分配 | 同账户 Web / Mini 读取同一位置、划线与笔记并失败恢复 | 依赖 E-OWNER、F1、M2-F1、B / C / D；真实 AppID / 身份就绪后验收 |
| `M1-F2-V1` | `PENDING` / 待分配 | 隔离账户完成导入、书架、文本 / PDF 阅读、划线、笔记、刷新恢复 | 依赖 A～E；真实文件、DB、视觉与可访问性 |
| `M1-F3A` | `VERIFY` / 项目总控 | 文本模型加密配置与真实 H4 已 PASS | 图片模型独立配置仍开放 |
| `M1-F3A-B` | `PENDING` / 待分配 | 图片模型独立配置、检测、撤销与失败保留 | 图片供应商 / 付费调用未确认；不得成为无图 PPT 前置 |
| `M1-F3B` | `VERIFY` / 项目总控 | Desktop 真实文字对话 H4 已闭合；Selection有 scoped PASS | 图片消息、书籍上下文与父级 V1 仍开放 |
| `M1-F3B-B` | `PENDING` / 待分配 | 最多4图的纯图片 / 图文消息、预检、逐张移除与失败恢复 | 依赖对象存储和模型能力目录 |
| `M1-F3B-C` | `VERIFY / MAIN c858a06 / MAIN CHROME PASS / PARENT OPEN` | 简单选择、显式确认、历史只读、stale / failure恢复已通过 | 真实AI问题生成仍未覆盖；证据 `main-selection-focus-c858a06/FINAL-RECEIPT.json` |
| `M1-F3B-C-R2A` | `VERIFY / MAIN 30e0423+6e21cad / CODE PASS` | mutation丢响应、重试、multi / free、stale fencing 已进main | 只作父包底层证据，不单独代表用户闭环 |
| `M1-F3B-C-R2B` | `VERIFY / MAIN a08fbbc / CODE PASS` | assistant message 绑定、API / DB状态已进main | 只作父包底层证据，不单独代表共享 UI |
| `M1-F3B-D` | `PENDING` / 待分配 | 书籍上下文对话与明确请求后的AI笔记新增 / 定向修改 | 依赖 A 与 M1-F2-D；失败不得丢讨论和笔记内容 |
| `M1-F3B-V1` | `PENDING` / 待分配 | 两会话边界下完成文字 / 图片、停止恢复、选择与笔记整理 | 依赖 A～D；真实模型或明确 fake 边界、DB、视觉 |
| `M1-F4` | `PENDING` / 项目总控 | 免费体验与成本父闭环 | A已完成；B / C / V1未开始 |
| `M1-F4-B` | `PENDING` / 待分配 | 成本预占、结算、释放、审计与账户累计¥5硬上限 | 依赖平台适配器；先以确定性适配器验证，真实费用需授权 |
| `M1-F4-C` | `PENDING` / 待分配 | AI / PPT共用免费能力，耗尽后原位引导配置且保留上下文 | 依赖 A / B / F3与PPT草稿合同 |
| `M1-F4-V1` | `PENDING` / 待分配 | 领取、AI / PPT消耗、失败恢复和并发硬上限 Case | 依赖 A～C；真实计费需授权 |
| `M1-F5` | `PENDING` / 项目总控 | 桌面 PPT 与真实可编辑 PPTX 父闭环 | F4-V1、对话选择、阅读与外部生成边界 |
| `M1-F5-A` | `PENDING` / 待分配 | 对话 / 书籍双入口、单书来源、范围 / 需求与任务工作区 | 依赖 M1-F4-V1、F2、F3B-C |
| `M1-F5-B` | `PENDING` / 待分配 | 公开资料补全、大纲生成、分层编辑与自动保存 | 依赖 A与文本模型；联网 / 预算需授权 |
| `M1-F5-C` | `PENDING` / 待分配 | 三套16:9青瓷模板、真实预览与选择 | 依赖 B；`39b84a4`仅Presenton种子 |
| `M1-F5-D` | `PENDING` / 待分配 | 任务幂等、Worker租约、停止 / 重启恢复与Presenton适配 | 依赖 C；版本、安全、许可证与真实进度不明时暂停 |
| `M1-F5-E` | `PENDING` / 待分配 | 生成中、停止、失败、重试、修改大纲、删除与完成瀑布流 | 依赖 D |
| `M1-F5-F` | `PENDING` / 待分配 | 作品列表、独立再生成、签名下载与可编辑PPTX | 依赖 D / E |
| `M1-F5-V1` | `PENDING` / 待分配 | 三份中文PPTX在PowerPoint / WPS打开、编辑、重存 | 依赖 C～F；真实软件 / 环境 / 费用需授权 |
| `M1-V1` | `PENDING` / 待分配 | 同一真实邮箱完成登录→导入→阅读→AI→额度 / 配置→PPTX | 依赖 M1-F1～F5 V1与邮件 / 模型 / Presenton授权 |
| `M2` | `VERIFY` / 项目总控 | 小程序运行壳与多个开发态 scoped PASS 已进入main / 唯一f312 | 真实身份、production API、跨端互见与完整PPTX仍开放 |
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
| `M2-F2` | `PENDING` / 待分配 | 微信读书Key、首 / 增量同步、恢复与统一书架 | 依赖M2-F1与真实Key授权；外部调用前细拆 |
| `M2-F3` | `VERIFY / MAIN 11f480a / PARENT OPEN` / 项目总控 | 会话抽屉、文字 / attachment、失败保留 / retry与刷新 scoped PASS | 真实API、软件键盘、clean-console与reduced-motion仍开放 |
| `M2-F3-MINI-CONVERSATION-API` | `VERIFY / MAIN de92f50 / F312 d60716a / PROD H3 BLOCKED` | hydrate / create / send、草稿 / 上下文恢复、失败映射与同requestId重试已实现 | production依赖M2-F1 bearer / base URL / AppID / 域名；main两处Mini测试WIP继续只读保护 |
| `M2-F3-MINI-CONVERSATION-LONG-LIST` | `VERIFY / MAIN 35bad75 / SCOPED NO-GO` | developmentLongList 18项、搜索与末项露出已实现 | clean-console / production不在本包；既有 query 模式只供唯一f312复验 |
| `M2-F3-MINI-CONVERSATION-SEND-RETRY` | `VERIFY / MAIN 11f480a / SCOPED FINAL PASS` | 本地text / attachment发送锁、失败原位retry、刷新无重复与anchor通过 | 真实AI/API、软件键盘、clean-console与long-list不在本包 |
| `M2-F4` | `VERIFY / MAIN b98c118 / READER SCOPED FINAL / LIBRARY AUTH BLOCKED` | 统一书架、连续正文、面板、notes与背景恢复部分闭合 | Library真实接线依赖M2-F1；不返工已通过Reader |
| `M2-F4-A` | `BLOCKED / CANDIDATE 20d61d6 / PRIVATE CONTRACT` | GET query、octet-stream import、映射与失败关闭合同冻结，未接page / runtime | 唤醒：Mini session bridge与runtime transport进入main；再派新writer走唯一f312 |
| `M2-F4-B` | `PENDING` / 待分配 | 连续正文、目录 / 设置 / 操作层、笔记与跨端位置恢复 | 依赖B / C / D / E内容合同及真实身份；四宽、键盘、安全区 |
| `M2-F5` | `PENDING` / 待分配 | 账户、模型、微信读书与退出的Mini端闭环 | 依赖M2-F1～F3；高风险流程按场景细拆 |
| `M2-F6` | `VERIFY / DRAFT HANDOFF F312 SELF PASS / FULL FLOW OPEN` | 书籍→当前会话draft/context已进入唯一f312 | 完整AI / 大纲 / 模板 / PPTX依赖M2-F3、F4、M1-F5与下载域名 |
| `M2-F6-MINI-PPT-DRAFT-HANDOFF` | `VERIFY / F312 cf6a8c5 / SELF PASS` | 携带bookId / 书名，可编辑预填；发送前不auto-send / sheet / task；失败保留草稿与上下文 | 非作者最终门与完整PPT流仍开放；证据 `mini-ppt-f312-self-cf6a8c5/` |
| `M2-V1` | `PENDING` / 待分配 | 同账户跨Web / Mini完成身份、书籍、阅读、对话、额度 / 模型与PPTX | 依赖M2-F1～F6、真机、DB与外部授权 |
| `M3` | `PENDING` / 待分配 | 隐私 / 删除、备份恢复、迁移、监控、Staging、Web与小程序发布 | 依赖M2-V1及法务 / 服务器 / 域名 / 备案 / 平台 / 发布授权 |

## 3. 完成历史（压缩）

| ID | 状态 / 结果 / 提交 | 证据与边界 |
| --- | --- | --- |
| `M0` | `DONE / 2b639e0` | 可运行工作区、健康检查与确定性本地PPT基线 |
| `STAGE-READ-NOTES-V1-A` | `DONE / CURRENT-MAIN TXT REAL CASE` | 导入→阅读→划线→想法→note CRUD→断服保留 / 重试→刷新恢复；`read_notes_desktop_20260828_b` |
| `STAGE-READ-NOTES-V1-B` | `DONE / SERVER f7cf45c / MINI 82f6b84 / F312 d4f3dd0` | PUT / PATCH兼容、开发适配器notes失败保留 / 重试；production门未冒充通过 |
| `STAGE-READ-NOTES-V1-C` | `DONE / CURRENT-MAIN READER 200% + DPR2` | `desktop-reader-native-200-dpr2-464a8f5/08-final-receipt.json` |
| `STAGE-READ-NOTES-V1-D` | `DONE / MAIN e36bc37 / CURRENT-MAIN PASS` | Book Detail动作SVG、focus、overflow、console；真实下载未覆盖 |
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

- 本地验证合格后的本地 `main` 集成已授权；远端 push、PR、发布、部署、真实邮件 / 微信、微信读书 / Presenton、小程序审核及其他付费调用未授权。
- 用户已授权 SelfAlone 测试安全读取本机保存的 DeepSeek Key，后续项目内测试调用无需重复确认；既有 H4 总观测6次且≤¥1。Key不得进入聊天、源码、`.env`、命令参数、日志、截图或台账，授权不扩展到生产、其他项目或无限费用。
- ImageGen总授权20次，已用7次、剩余13次；已有参考先忠实实现，功能图标不用栅格生图。
- 唯一 Mini DevTools 常驻入口为 `/Users/echoman/.codex/worktrees/f312/SelfAlone/apps/miniapp`。隔离writer不得新增长期入口。
- main两处 Mini conversation测试WIP、6个DOCX / Word锁文件及3组视觉候选目录均为受保护现场；不得覆盖、移动、清理或夹带提交。共享PostgreSQL只证明副作用，开发 / QA使用隔离schema并记录owner与恢复点。
