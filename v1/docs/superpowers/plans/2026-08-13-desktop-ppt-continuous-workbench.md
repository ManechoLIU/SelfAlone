# Desktop PPT Continuous Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端 PPT 从提出意图、选书、范围、大纲、模板到生成/完成始终表现为同一个连续会话，并在空间不足时可折叠主导航、会话列表和作品工作台。

**Architecture:** 保留现有多页面原型，用 `conversation` 查询参数和 `LaojiState` 中的共享会话快照串联页面；四个页面使用同构桌面壳层，共享 JS 负责状态恢复、累计消息、折叠面板和路由透传，共享 CSS 负责紧凑导航、会话抽屉、双栏工作台和小于 1024px 的单任务布局。现有 PPT 草稿和作品状态继续兼容，迁移期间采用写穿策略，不引入 SPA 或新依赖。

**Tech Stack:** HTML5、共享 CSS、原生 JavaScript、`localStorage`、Node.js `assert`/`vm` 静态与状态测试。

## Global Constraints

- 以 `docs/prd/laoji-mvp-prototype-prd.md` 和 `docs/ui/laoji-mvp-ui-design-spec.md` 为最终事实源；本计划只实现已确认的桌面连续工作台，不新增产品能力。
- 保留现有用户改动，不整理无关文件；手工修改一律使用 `apply_patch`。
- 手机继续使用“对话页 + 全屏作品层”；768–1023px 使用单任务平板布局，不把三栏缩窄堆叠。
- 一屏仅保留一个主操作；所有折叠按钮具有可访问名称、`aria-expanded`、键盘焦点和至少 44×44px 触控区域。
- 异步状态更新必须带 `revision`，过期回调不得覆盖较新的会话快照。
- 每个任务的提交命令只是检查点；当前环境若因 `.git/index.lock` 只读而不能提交，应保留文件改动、记录限制并继续验证，不得请求扩大权限或改写 Git 元数据。

---

### Task 1: 建立 PPT 连续会话状态契约

**Files:**

- Modify: `prototype/assets/laoji-state.js:3-8,131-196`
- Modify: `prototype/tests/laoji-state.test.js`
- Modify: `prototype/tests/laoji-ppt-lifecycle-sync.test.js`

**Interfaces:**

```js
LaojiState.listPptConversations()
LaojiState.getPptConversation(id)
LaojiState.upsertPptConversation(input)
LaojiState.updatePptConversation(id, patch, expectedRevision)
```

会话快照统一使用以下形状；`draft` 兼容现有范围、大纲和模板字段，`ui` 只保存可恢复的界面状态：

```js
{
  id: 'ppt-conversation-atomic-habits',
  title: '把《原子习惯》做成读书分享 PPT',
  bookId: 'weread-atomic-habits',
  bookTitle: '原子习惯',
  entry: 'conversation',
  stage: 'scope',
  messages: [],
  draft: { scope: 'full', purpose: '', audience: '', pageCount: 5, outline: [], template: '' },
  ui: {
    sessionListMode: 'collapsed',
    workbenchOpen: true,
    chatScrollTop: 0,
    workbenchScrollTop: 0
  },
  revision: 1,
  updatedAt: '2026-08-13T00:00:00.000Z'
}
```

- [ ] **Step 1: 先写状态契约失败测试**

在 `prototype/tests/laoji-state.test.js` 中加入：

```js
const created = state.upsertPptConversation({
  id: 'ppt-conversation-test',
  title: '测试 PPT 会话',
  stage: 'scope'
});
assert.equal(created.revision, 1);
assert.equal(state.getPptConversation(created.id).ui.sessionListMode, 'collapsed');

const updated = state.updatePptConversation(created.id, { stage: 'outline' }, created.revision);
assert.equal(updated.stage, 'outline');
assert.equal(updated.revision, 2);
assert.equal(
  state.updatePptConversation(created.id, { stage: 'template' }, created.revision),
  null,
  '旧 revision 不得覆盖新状态'
);
```

- [ ] **Step 2: 运行测试并确认因 API 缺失失败**

Run: `node prototype/tests/laoji-state.test.js`

Expected: FAIL，错误包含 `upsertPptConversation is not a function`。

- [ ] **Step 3: 实现最小共享状态 API**

在 `KEYS` 中增加 `pptConversations: 'laoji-ppt-conversations'`，加入规范化、读取、写入和乐观 revision 检查：

```js
function normalizePptConversation(input, existing) {
  const base = existing || {};
  return {
    ...base,
    ...input,
    id: input.id || base.id,
    messages: Array.isArray(input.messages) ? input.messages : (base.messages || []),
    draft: { ...(base.draft || {}), ...(input.draft || {}) },
    ui: {
      sessionListMode: 'collapsed',
      workbenchOpen: true,
      chatScrollTop: 0,
      workbenchScrollTop: 0,
      ...(base.ui || {}),
      ...(input.ui || {})
    },
    revision: Number(input.revision || base.revision || 0),
    updatedAt: input.updatedAt || base.updatedAt || new Date().toISOString()
  };
}

function updatePptConversation(id, patch, expectedRevision) {
  const conversations = listPptConversations();
  const index = conversations.findIndex((item) => item.id === id);
  if (index < 0 || conversations[index].revision !== expectedRevision) return null;
  conversations[index] = normalizePptConversation({
    ...patch,
    revision: expectedRevision + 1,
    updatedAt: new Date().toISOString()
  }, conversations[index]);
  write(KEYS.pptConversations, conversations);
  return conversations[index];
}
```

导出四个 API。`upsertPptConversation` 创建时 revision 为 1，更新已有项时自动递增。

- [ ] **Step 4: 补充生命周期兼容断言并运行测试**

在 `prototype/tests/laoji-ppt-lifecycle-sync.test.js` 断言新会话状态与现有 `pptRecords` 分离，草稿阶段不会进入书籍 PPT 列表。

Run: `node prototype/tests/laoji-state.test.js && node prototype/tests/laoji-ppt-lifecycle-sync.test.js`

Expected: 两个测试均输出 `all tests passed`。

- [ ] **Step 5: 提交检查点**

```bash
git add prototype/assets/laoji-state.js prototype/tests/laoji-state.test.js prototype/tests/laoji-ppt-lifecycle-sync.test.js
git commit -m "feat: add persistent ppt conversation state"
```

---

### Task 2: 为四个阶段页面建立同构桌面壳层

**Files:**

- Modify: `prototype/laoji-chat.html`
- Modify: `prototype/laoji-ppt-materials.html`
- Modify: `prototype/laoji-ppt-outline.html`
- Modify: `prototype/laoji-ppt-preview.html`
- Create: `prototype/tests/laoji-desktop-ppt-continuity.test.js`

**Interfaces:**

```html
<body class="ppt-conversation-page" data-ppt-conversation-id="ppt-conversation-atomic-habits">
<main class="ppt-continuous-shell" data-ppt-desktop-shell data-session-mode="collapsed">
```

- [ ] **Step 1: 写同构壳层失败测试**

创建 `prototype/tests/laoji-desktop-ppt-continuity.test.js`，读取四个 HTML，逐页断言：

```js
for (const [name, html] of pages) {
  assert.match(html, /data-ppt-desktop-shell/, `${name} 应使用连续桌面壳层`);
  assert.match(html, /data-ppt-session-toggle[^>]*aria-expanded="false"/, `${name} 应可展开会话列表`);
  assert.match(html, /data-ppt-session-panel/, `${name} 应保留同一会话入口`);
  assert.match(html, /data-ppt-conversation-timeline/, `${name} 应承载累计消息`);
  assert.match(html, /data-ppt-workbench-panel/, `${name} 应承载阶段工作台`);
  assert.match(html, /data-ppt-workbench-toggle/, `${name} 应可折叠作品区`);
}
```

- [ ] **Step 2: 运行测试并确认缺少共享选择器**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js`

Expected: FAIL，首个缺失项为 `data-ppt-desktop-shell`。

- [ ] **Step 3: 将现有桌面结构对齐为同一壳层**

四页均保留现有实际内容，但统一加入以下可操作区域：

```html
<button class="icon-btn ppt-nav-toggle" type="button"
        data-ppt-nav-toggle aria-expanded="false" aria-controls="ppt-primary-nav"
        aria-label="展开主导航"></button>

<button class="btn btn-quiet ppt-session-toggle" type="button"
        data-ppt-session-toggle aria-expanded="false" aria-controls="ppt-session-panel">
  会话列表
</button>

<aside id="ppt-session-panel" class="ppt-session-panel" data-ppt-session-panel aria-label="PPT 会话列表">
  <!-- 复用当前会话项，当前项同时使用 aria-current="page" 和文字状态 -->
</aside>

<section class="ppt-chat-pane" data-ppt-chat-pane>
  <div data-ppt-conversation-timeline aria-live="polite"></div>
  <!-- 复用现有输入器 -->
</section>

<section class="ppt-workbench-panel" data-ppt-workbench-panel>
  <button class="icon-btn ppt-workbench-toggle" type="button"
          data-ppt-workbench-toggle aria-expanded="true"
          aria-label="收起作品工作台"></button>
  <!-- 复用当前范围/大纲/模板/生成内容 -->
</section>
```

`laoji-chat.html` 只在选书进入 PPT 草稿后显示该壳层；常规对话保持现状。每页保留无 JavaScript 时可理解的静态文本，不复制不同版本的业务状态。

- [ ] **Step 4: 补齐会话身份与原生链接**

阶段链接必须显式带同一个会话身份：

```html
href="laoji-ppt-materials.html?conversation=ppt-conversation-atomic-habits"
href="laoji-ppt-outline.html?conversation=ppt-conversation-atomic-habits"
href="laoji-ppt-preview.html?conversation=ppt-conversation-atomic-habits"
```

真实跳转仍使用 `<a href>`；JS 只补全动态参数，不接管基本可导航性。

- [ ] **Step 5: 运行壳层和既有移动契约测试**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js && node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: 两个测试均通过；移动端原有 `data-mobile-view` 和作品层选择器仍存在。

- [ ] **Step 6: 提交检查点**

```bash
git add prototype/laoji-chat.html prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/tests/laoji-desktop-ppt-continuity.test.js
git commit -m "feat: align desktop ppt conversation shells"
```

---

### Task 3: 实现紧凑导航、会话抽屉和可折叠作品区

**Files:**

- Modify: `prototype/assets/laoji.css:62-86,449-570,681-860,1297-1610`
- Modify: `prototype/assets/laoji.js:2455-2610`
- Modify: `prototype/tests/laoji-desktop-ppt-continuity.test.js`
- Modify: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**

```js
initPptDesktopShell(shell, conversation)
setPptSessionMode(shell, mode)
setPptWorkbenchOpen(shell, isOpen)
isPptSingleTaskViewport()
```

- [ ] **Step 1: 扩充失败测试覆盖三种宽度模型**

加入静态契约断言：

```js
assert.match(css, /--ppt-compact-nav:\s*7[2-9]px|--ppt-compact-nav:\s*80px/);
assert.match(css, /@media \(min-width: 1280px\)[\s\S]*?data-session-mode="pinned"/);
assert.match(css, /@media \(min-width: 1024px\) and \(max-width: 1279px\)[\s\S]*?\.ppt-session-panel/);
assert.match(css, /@media \(max-width: 1023px\)[\s\S]*?\.ppt-continuous-shell/);
assert.match(js, /function setPptSessionMode\(shell, mode\)/);
assert.match(js, /function setPptWorkbenchOpen\(shell, isOpen\)/);
```

- [ ] **Step 2: 运行测试并确认响应式契约尚未实现**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js`

Expected: FAIL，缺少紧凑导航或面板控制函数。

- [ ] **Step 3: 实现桌面空间分配规则**

在 PPT 页面作用域内增加规则，不改变其他页面的全局侧栏：

```css
.ppt-conversation-page {
  --ppt-compact-nav: 80px;
  --ppt-chat-width: clamp(360px, 31vw, 430px);
  --ppt-session-width: 224px;
}

@media (min-width: 1024px) {
  .ppt-conversation-page .side-nav { width: var(--ppt-compact-nav); }
  .ppt-conversation-page .side-nav .nav-text,
  .ppt-conversation-page .side-nav .brand-name-wrap,
  .ppt-conversation-page .side-nav .side-foot { display: none; }
  .ppt-conversation-page .app-shell { padding-left: var(--ppt-compact-nav); }
  .ppt-continuous-shell {
    display: grid;
    grid-template-columns: var(--ppt-chat-width) minmax(0, 1fr);
    min-width: 0;
  }
  .ppt-workbench-panel[hidden] { display: none; }
  .ppt-continuous-shell:has(.ppt-workbench-panel[hidden]) { grid-template-columns: minmax(0, 1fr); }
}

@media (min-width: 1280px) {
  .ppt-continuous-shell[data-session-mode="pinned"] {
    grid-template-columns: var(--ppt-session-width) var(--ppt-chat-width) minmax(0, 1fr);
  }
}

@media (min-width: 1024px) and (max-width: 1279px) {
  .ppt-session-panel { position: fixed; inset: 0 auto 0 var(--ppt-compact-nav); width: var(--ppt-session-width); }
}

@media (max-width: 1023px) {
  .ppt-conversation-page .side-nav { display: none; }
  .ppt-conversation-page .app-shell { padding-left: 0; }
  .ppt-continuous-shell { display: block; }
  .ppt-chat-pane,
  .ppt-workbench-panel { width: 100%; min-width: 0; }
}
```

若目标浏览器不支持 `:has()`，同时由 JS 在壳层写入 `data-workbench-open="false"`，使用属性选择器作为主规则，`:has()` 仅作增强。

- [ ] **Step 4: 实现折叠状态和可访问反馈**

```js
function setPptSessionMode(shell, mode) {
  const panel = shell.querySelector('[data-ppt-session-panel]');
  const button = shell.querySelector('[data-ppt-session-toggle]');
  const expanded = mode !== 'collapsed';
  shell.dataset.sessionMode = mode;
  panel.hidden = !expanded;
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? '收起会话列表' : '展开会话列表');
}

function setPptWorkbenchOpen(shell, isOpen) {
  const panel = shell.querySelector('[data-ppt-workbench-panel]');
  const button = shell.querySelector('[data-ppt-workbench-toggle]');
  shell.dataset.workbenchOpen = String(isOpen);
  panel.hidden = !isOpen;
  button.setAttribute('aria-expanded', String(isOpen));
  button.setAttribute('aria-label', isOpen ? '收起作品工作台' : '展开作品工作台');
}
```

工作台收起时，在会话时间线中只显示一个“继续当前步骤”任务卡入口；工作台展开时隐藏该重复入口。Escape 关闭临时抽屉并把焦点还给触发按钮。

- [ ] **Step 5: 恢复状态并尊重 reduced motion**

初始化先读取 `conversation.ui`；用户操作后用当前 `revision` 更新。只对宽度和透明度做 160–200ms 过渡，`prefers-reduced-motion: reduce` 下取消过渡。

- [ ] **Step 6: 运行桌面与移动契约测试**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js && node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: 两个测试均通过；移动端输入器、安全区和横向截断规则未退化。

- [ ] **Step 7: 提交检查点**

```bash
git add prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-desktop-ppt-continuity.test.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: add collapsible desktop ppt workspace"
```

---

### Task 4: 串联路由、累计消息和阶段恢复

**Files:**

- Modify: `prototype/assets/laoji.js:2388-2610,2936-end`
- Modify: `prototype/laoji-chat.html`
- Modify: `prototype/laoji-ppt-materials.html`
- Modify: `prototype/laoji-ppt-outline.html`
- Modify: `prototype/laoji-ppt-preview.html`
- Modify: `prototype/tests/laoji-desktop-ppt-continuity.test.js`
- Modify: `prototype/tests/laoji-ppt-lifecycle-sync.test.js`

**Interfaces:**

```js
getPptConversationId(params)
ensurePptConversation(seed)
renderPptConversationTimeline(host, messages)
appendPptConversationMessage(conversation, message)
advancePptConversation(conversation, stage, message)
propagatePptConversationRoute(link, conversation)
```

- [ ] **Step 1: 写失败测试覆盖同一会话与累计时间线**

测试必须断言：

```js
assert.match(js, /function getPptConversationId\(params\)/);
assert.match(js, /params\.set\('conversation', conversation\.id\)/);
assert.match(js, /function renderPptConversationTimeline\(host, messages\)/);
assert.match(js, /function advancePptConversation\(conversation, stage, message\)/);
assert.doesNotMatch(js, /timeline\.innerHTML\s*=\s*message\.text/);
```

并通过 VM 状态测试验证 scope → outline → template → generating → complete 使用同一个 `id`，消息只追加不覆盖。

- [ ] **Step 2: 运行测试并确认缺少连续路由实现**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js && node prototype/tests/laoji-ppt-lifecycle-sync.test.js`

Expected: FAIL，缺少 `getPptConversationId` 或阶段推进函数。

- [ ] **Step 3: 在普通对话选书后创建或恢复会话**

`openScopeWorkbench(book)` 不再只改变局部 DOM；它应创建/恢复会话并加入选书消息：

```js
const conversation = ensurePptConversation({
  id: `ppt-conversation-${book.id}`,
  title: `把《${book.title}》做成读书分享 PPT`,
  bookId: book.id,
  bookTitle: book.title,
  entry: 'conversation',
  stage: 'scope'
});
appendPptConversationMessage(conversation, {
  id: `book-selected-${book.id}`,
  role: 'assistant',
  kind: 'book-selection',
  text: `已选择《${book.title}》，接下来确认内容范围。`,
  status: 'complete'
});
```

从书籍详情首次进入时 `entry` 为 `book`，仍创建新会话；返回目的地由 `entry` 决定，不新增固定“返回会话”按钮。

- [ ] **Step 4: 统一阶段推进与链接透传**

- 材料页确认范围：写入 `draft`，追加“范围已确认”，stage → `outline`，再跳转大纲页。
- 大纲页确认：写入 `draft.outline`，追加“大纲已确认”，stage → `template`，再跳转模板页。
- 模板页点击“开始生成 PPT”：写入 `draft.template`，追加“已选择模板”，stage → `generating`；只有此时创建书籍 PPT 任务记录。
- 生成、失败、恢复和完成继续复用现有生命周期，但同步会话 stage；失败保留 draft、messages 和完成页。
- 所有内部链接、AI 设置往返链接都使用 `URL`/`URLSearchParams` 透传 `conversation`、`from` 和 `book`。

- [ ] **Step 5: 安全渲染累计消息并恢复滚动位置**

`renderPptConversationTimeline` 使用 `createElement` 和 `textContent`，按消息 `id` 去重。页面离开前记录两个滚动容器；初始化在 `requestAnimationFrame` 后恢复并将值限制在实际 `scrollHeight` 内。

```js
const text = document.createElement('p');
text.textContent = message.text;
row.append(text);
```

- [ ] **Step 6: 防止过期异步任务回写**

生成进度回调捕获 `revision`；`updatePptConversation` 返回 `null` 时立即停止该回调，不覆盖更晚的重试、恢复或完成状态。

- [ ] **Step 7: 运行连续性和生命周期测试**

Run: `node prototype/tests/laoji-desktop-ppt-continuity.test.js && node prototype/tests/laoji-ppt-lifecycle-sync.test.js && node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: 三个测试均通过；草稿阶段不进入书籍列表，生成开始后才创建任务，重新生成产生独立作品。

- [ ] **Step 8: 提交检查点**

```bash
git add prototype/assets/laoji.js prototype/laoji-chat.html prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/tests/laoji-desktop-ppt-continuity.test.js prototype/tests/laoji-ppt-lifecycle-sync.test.js
git commit -m "feat: preserve ppt conversation across stages"
```

---

### Task 5: 同步受影响事实源并清理旧规则残留

**Files:**

- Inspect and modify only if affected: `docs/prd/laoji-mvp-prototype-prd.md`
- Inspect and modify only if affected: `docs/ui/laoji-mvp-ui-design-spec.md`
- Inspect and modify only if affected: `docs/decisions/ADR-0004-reading-workspace-owns-ppt.md`
- Inspect and modify only if affected: `docs/decisions/ADR-0009-outline-first-ppt-workflow.md`
- Inspect and modify only if affected: `docs/glossary.md`
- Inspect and modify only if affected: `prototype/README.md`

- [ ] **Step 1: 做实现后的事实源影响扫描**

Run:

```bash
rg -n "三栏|两栏|会话列表|PPT 工作台|范围|大纲|模板|生成中|返回会话|版本" docs/prd/laoji-mvp-prototype-prd.md docs/ui/laoji-mvp-ui-design-spec.md docs/decisions docs/glossary.md prototype/README.md
```

Expected: 主事实源描述与实现一致；若已有规则已覆盖“桌面右侧工作台 + 手机全屏作品层”，不机械增加重复段落。

- [ ] **Step 2: 只同步真正受到影响的当前规则**

需要修改时：PRD 只写页面职责、状态和验收；UI 规范只写折叠导航、宽度断点、响应式和可访问行为；ADR 只记录为何采用多页面共享壳。不得写日期增量、“以本段覆盖”或旧方案回顾。

- [ ] **Step 3: 扫描矛盾、占位和禁止概念**

Run:

```bash
rg -n "TO[D]O|TB[D]|待定|占位|以本段覆盖|固定返回会话|创建新版本|版本号" docs/prd/laoji-mvp-prototype-prd.md docs/ui/laoji-mvp-ui-design-spec.md docs/decisions docs/glossary.md prototype/README.md
```

Expected: 无新增占位或禁止概念；历史专项文档中的状态说明不作为主事实源冲突处理。

- [ ] **Step 4: 提交检查点**

仅添加实际发生变化的文档：

```bash
git add docs/prd/laoji-mvp-prototype-prd.md docs/ui/laoji-mvp-ui-design-spec.md docs/decisions/ADR-0004-reading-workspace-owns-ppt.md docs/decisions/ADR-0009-outline-first-ppt-workflow.md docs/glossary.md prototype/README.md
git commit -m "docs: align desktop ppt continuity rules"
```

---

### Task 6: 运行流程、响应式、可访问性与回归验证

**Files:**

- Verify: `prototype/laoji-chat.html`
- Verify: `prototype/laoji-ppt-materials.html`
- Verify: `prototype/laoji-ppt-outline.html`
- Verify: `prototype/laoji-ppt-preview.html`
- Verify: `prototype/assets/laoji.css`
- Verify: `prototype/assets/laoji.js`
- Verify: `prototype/assets/laoji-state.js`
- Verify: `prototype/tests/*.test.js`

- [ ] **Step 1: 运行全部 Node 原型测试**

Run:

```bash
for test_file in prototype/tests/*.test.js; do
  node "$test_file" || exit 1
done
```

Expected: 每个测试均输出 `all tests passed` 或等价成功消息，循环退出码为 0。

- [ ] **Step 2: 检查链接和禁止残留**

Run:

```bash
node prototype/tests/laoji-prototype-links.test.js
rg -n "href=\"#\"|onclick=|TO[D]O|TB[D]|创建新版本|版本号|固定返回会话" prototype/laoji-chat.html prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/assets/laoji.js
```

Expected: 链接测试通过；残留扫描不出现本轮新增的空链接、内联事件、占位或禁止概念。

- [ ] **Step 3: 浏览器验证完整桌面流程**

分别在 1024、1200、1280 和 1440px 视口从普通对话执行：提出 PPT → 选书 → 确认范围 → 确认大纲 → 选模板 → 开始生成 → 完成作品。

逐阶段确认：

- URL 中 `conversation` 不变，刷新后仍回到相同阶段。
- 消息时间线只追加不重置；选书、范围、大纲和模板的已完成状态清晰。
- 1024/1200px 会话列表为抽屉，1280/1440px 可固定或折叠。
- 工作台展开时是唯一主操作区；收起后任务卡提供唯一恢复入口。
- 折叠主导航、会话列表和工作台后，焦点回到触发按钮；Escape 只关闭临时抽屉。
- 无横向溢出、内容截断或不可达控件。

- [ ] **Step 4: 验证单任务移动/平板流程**

在 360、390、430 和 768px 视口复测同一路径；确认对话输入器底部间距一致、作品层全屏、返回后滚动位置与输入草稿保留、键盘和安全区不遮挡主操作。

- [ ] **Step 5: 验证文本缩放、键盘和 reduced motion**

- 浏览器 200% 文本缩放下，导航、任务卡、对话输入器和工作台无裁切。
- 仅用 Tab / Shift+Tab / Enter / Space / Escape 可完成折叠和关键流程。
- 屏幕阅读器可读出当前会话、当前阶段和折叠状态；状态不只靠颜色。
- `prefers-reduced-motion: reduce` 下无宽度/位移动画。

- [ ] **Step 6: 做最终差异检查**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出且退出码为 0；`git status --short` 仅显示用户原有改动和本计划范围内的新改动。

- [ ] **Step 7: 记录真实限制并交付**

最终交付先列已贯通流程和验证证据，再列未能执行的浏览器/提交步骤或环境限制；不得把未运行的检查描述为通过。
