# 老己书架、书籍详情与对话式 PPT 重构实施计划

> 历史计划：PPT 生命周期相关任务已被 `../specs/2026-08-12-ppt-workbench-and-book-ppt-lifecycle-design.md` 替代。后续 agent 不得按本文实现版本管理、生成前草稿列表或固定“回到作品会话”；等待新规范对应的实施计划。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将现有响应式原型重构为封面优先的书架、单书归属的老己笔记，以及在同一 PPT 专属会话内完成选书、范围确认、大纲编辑与最终预览的连续体验。

**Architecture:** 保留现有多 HTML 状态快照与共享 `laoji.css` / `laoji.js` 架构，但让 PPT 各状态页使用同一会话壳层与同一作品状态。书架和书籍详情仍以各自 HTML 呈现；独立笔记路由删除，笔记改为当前书籍详情的内容面板。HTML 提供无脚本可见的真实内容，JavaScript 只增强筛选、选中、视图切换、保存与生成状态。

**Tech Stack:** 语义化 HTML5、原生 CSS、原生 JavaScript、Node.js `node:test`/`assert` 风格的静态契约测试、Open Design 单次图片导出验证。

## Global Constraints

- 沿用 `prototype/brand-spec.md` 与现有青瓷书斋视觉令牌，不引入新的品牌方向。
- 所有用户可指认区域、控件和重复卡片保留或补充唯一 `data-od-id`。
- 书架封面下不重复书名、作者、格式或阅读进度；仅本地书封面显示“本地导入”。
- 微信读书内容不显示来源角标；本地来源不区分 EPUB/PDF。
- 不保留独立 `laoji-notes.html` 或其入口；每本书只管理自己的老己笔记。
- PPT 范围、需求、大纲与预览必须保持同一专属会话的标题、书籍绑定与消息历史。
- 桌面使用会话 + 作品画布并列布局；手机在两者间切换并保留返回对话入口。
- 触控目标不小于 44px，焦点态可见，360px 宽度无横向滚动。
- 不覆盖已有人工大纲；重新生成必须创建或提示新版本。
- 删除独立笔记文件属于用户已明确确认的范围。

---

### Task 1: 固化新的原型契约

**Files:**
- Create: `prototype/tests/laoji-reading-ppt-redesign.test.js`
- Modify: `prototype/tests/laoji-library-markup.test.js`
- Modify: `prototype/tests/laoji-prototype-links.test.js`

- [x] **Step 1: 写入书架、笔记归属与对话画布的失败测试**

  测试需要读取原型 HTML 并断言：

  - 书架有 8 本静态示例书和 8 个封面标题；
  - 书架不存在 `.book-meta`，不存在“微信读书”“本地 EPUB”“本地 PDF”封面标签；
  - 本地书使用统一的“本地导入”标签；
  - `laoji-notes.html` 不存在，所有 HTML 不再引用它；
  - 对话页包含带书封面的选书区域；
  - PPT 素材、大纲、预览页面均包含 `data-ppt-chat-shell` 与聊天记录；
  - 大纲和预览页分别包含 `data-outline-canvas`、`data-preview-canvas`；
  - 原型页面总数由 15 调整为 14。

- [x] **Step 2: 运行新测试并确认按预期失败**

  Run: `node prototype/tests/laoji-reading-ppt-redesign.test.js`

  Expected: FAIL，指出旧书架元信息、独立笔记路由或缺失的会话画布契约。

- [x] **Step 3: 更新既有测试的目标断言**

  将页面数量改为 14，将书架测试改为封面-only 与统一来源角标规则，保留现有资源链接完整性检查。

---

### Task 2: 重构封面优先书架

**Files:**
- Modify: `prototype/laoji-library.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-library-markup.test.js`
- Test: `prototype/tests/laoji-reading-ppt-redesign.test.js`

- [x] **Step 1: 移除静态书卡封面下方元信息**

  每个 `data-book` 只保留一个覆盖整张封面的链接。封面自身继续包含书名和作者；本地书使用 `local-import-badge`，微信读书不显示来源。

- [x] **Step 2: 调整响应式封面网格**

  桌面根据容器宽度显示 5–7 列，600–1023px 显示 4 列，360–599px 显示 3 列。封面保持 5:7 比例，移动端不得退化为两列。

- [x] **Step 3: 同步动态新增书卡**

  更新 `createLibraryCard()`，不再生成 `.book-meta` 或格式来源文案。本地书只生成“本地导入”角标，并保留可访问名称、筛选数据与详情链接。

- [x] **Step 4: 运行书架契约测试**

  Run: `node prototype/tests/laoji-library-markup.test.js`

  Expected: PASS。

---

### Task 3: 将老己笔记收回当前书籍详情

**Files:**
- Modify: `prototype/laoji-wechat-book.html`
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Delete: `prototype/laoji-notes.html`
- Delete: `prototype/laoji-notes.html.artifact.json`
- Test: `prototype/tests/laoji-reading-ppt-redesign.test.js`
- Test: `prototype/tests/laoji-prototype-links.test.js`

- [x] **Step 1: 移除所有独立笔记入口**

  删除“管理老己笔记”“编辑与管理”“最近笔记”等跨书入口；把新建、编辑、删除改为当前书详情内的按钮或对话框操作。

- [x] **Step 2: 完成微信读书当前书笔记面板**

  保留本书的引用型笔记与独立笔记，补齐新增、更多菜单、编辑、删除确认和来源回看入口；所有动作都明确只影响当前书。

- [x] **Step 3: 完成本地书当前书笔记面板**

  EPUB 与 PDF 阅读器增加“阅读 / 老己笔记 / 读书 PPT”视图切换。笔记面板包含“全部 / 划线 / 笔记”筛选、回到章节或页码、新建与更多菜单。

- [x] **Step 4: 删除独立笔记页面并验证链接**

  Run: `node prototype/tests/laoji-prototype-links.test.js`

  Expected: PASS，14 个 HTML 页面均无失效本地链接。

---

### Task 4: 将选书、范围与需求改为真实对话流

**Files:**
- Modify: `prototype/laoji-chat.html`
- Modify: `prototype/laoji-ppt-materials.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-reading-ppt-redesign.test.js`

- [x] **Step 1: 在普通对话中加入封面选书消息**

  使用桌面四列、手机横向封面轨道。选择态同时显示边框、勾选和“已选择《书名》”，确认后折叠为书籍绑定摘要。

- [x] **Step 2: 将素材页重构为 PPT 专属会话状态**

  页面应先显示已绑定书籍，再由老己依次询问内容范围和分享需求。点击建议或输入自然语言更新同一范围草稿，需求确认卡只保留一个“生成大纲”主操作。

- [x] **Step 3: 增加对话式交互增强**

  JavaScript 管理封面选中、范围选中、需求摘要、输入草稿与继续操作。未配置 AI 时范围与需求仍可编辑，仅生成动作进入配置提示。

- [x] **Step 4: 运行对话契约测试**

  Run: `node prototype/tests/laoji-reading-ppt-redesign.test.js`

  Expected: 选书与素材会话相关断言 PASS。

---

### Task 5: 在同一会话内嵌大纲编辑画布

**Files:**
- Modify: `prototype/laoji-ppt-outline.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-reading-ppt-redesign.test.js`

- [x] **Step 1: 统一大纲页面的会话壳层**

  桌面左侧为 360–420px 会话区，右侧为大纲画布；保留相同会话标题、当前书封面与范围摘要。旧的独立三栏工作区不再作为页面外壳。

- [x] **Step 2: 保留并增强结构化编辑能力**

  复用 `data-outline-editor`、页面列表与字段绑定，支持选择、添加、删除、排序、标题与要点编辑。来源抽屉默认收起。

- [x] **Step 3: 统一手工与对话修改状态**

  手工修改与聊天指令更新同一版本号和保存状态；重新生成存在人工修改时显示“创建新版本”确认，不静默覆盖。

- [x] **Step 4: 实现手机会话/画布切换**

  手机点击作品卡进入全屏大纲层，顶部提供返回对话、页码和保存状态；返回不清空输入草稿。

---

### Task 6: 在同一会话内嵌预览与生成画布

**Files:**
- Modify: `prototype/laoji-ppt-preview.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-reading-ppt-redesign.test.js`

- [x] **Step 1: 统一预览页面的会话壳层**

  复用大纲页的会话宽度、当前书绑定、消息样式与手机返回逻辑，右侧改为模板和幻灯片预览画布。

- [x] **Step 2: 保留生成与恢复状态**

  继续支持就绪、生成中、失败、完成四种状态；失败保留大纲、模板和已生成页；下载只在完成后成为主操作。

- [x] **Step 3: 完成作品回溯路径**

  从预览返回大纲时保持当前书与会话上下文，从书籍详情的“读书 PPT”面板可以重新进入同一作品会话。

---

### Task 7: 同步产品与设计文档

**Files:**
- Modify: `docs/prd/laoji-mvp-prototype-prd.md`
- Modify: `docs/ui/laoji-mvp-ui-design-spec.md`
- Modify: `docs/decisions/ADR-0004-reading-workspace-owns-ppt.md`
- Modify: `docs/decisions/ADR-0008-layered-note-model.md`
- Modify: `docs/decisions/ADR-0009-outline-first-ppt-workflow.md`
- Modify: `docs/README.md`
- Modify: `prototype/README.md`

- [x] **Step 1: 更新页面数量与信息架构**

  将独立笔记页从 MVP 页面清单移除，页面总数调整为 14；说明 `NOTE-01` 已变为书籍详情内的内容状态而非路由。

- [x] **Step 2: 写入新的交互真相**

  PRD 记录封面-only 书架、单书笔记归属、对话内嵌作品画布和恢复规则；UI 规范只固化体验与可访问性下限，不冻结具体布局实现。

- [x] **Step 3: 同步 ADR 与 README**

  ADR-0004 记录 PPT 由单书专属会话承载，ADR-0008 记录无独立笔记管理面，ADR-0009 记录大纲和预览在同一会话中展开。README 更新原型入口和验证命令。

---

### Task 8: 完整验证与视觉检查

**Files:**
- Verify: `prototype/*.html`
- Verify: `prototype/assets/laoji.js`
- Verify: `prototype/assets/laoji-state.js`
- Verify: `prototype/tests/*.test.js`

- [x] **Step 1: 运行全部自动化测试**

  Run: `for test_file in prototype/tests/*.test.js; do node "$test_file"; done`

  Expected: 全部 PASS。

- [x] **Step 2: 检查 JavaScript 语法与遗留入口**

  Run: `node --check prototype/assets/laoji.js && node --check prototype/assets/laoji-state.js`

  Run: `rg -n "laoji-notes|book-meta|本地 EPUB|本地 PDF|管理老己笔记" prototype docs`

  Expected: JavaScript 语法通过；原型不再出现独立笔记入口或旧来源文案，文档中的历史说明须有明确语境。

- [x] **Step 3: 做一次响应式视觉导出**

  Run: `"$OD_NODE_BIN" "$OD_BIN" export prototype/laoji-ppt-outline.html --project "$OD_PROJECT_ID" --format image --out /tmp/laoji-ppt-outline-review`

  检查桌面会话/画布比例、文字溢出、按钮主次、焦点与手机切换规则。若导出失败，只做一次有针对性的诊断。

- [x] **Step 4: 检查工作区完整性**

  Run: `git diff --check`

  Expected: 无空白错误。复核所有修改文件均已写入，并记录由于沙箱不允许写 `.git` 而无法提交（如仍受限）。
