# 老己统一移动对话体系 Implementation Plan

> 部分被替代：普通对话壳层与输入器任务仍可作为历史实现证据；PPT 生命周期、文档式大纲、模板启动生成和书籍任务列表必须改按 `../specs/2026-08-12-ppt-workbench-and-book-ppt-lifecycle-design.md` 的新计划执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一普通对话与 PPT 三阶段的移动页头、消息列和输入器，把范围与要求改为对话内全宽任务面板，并为三种 PPT 风格补齐真实 16:9 封面缩略图。

**Architecture:** 保留四个现有 HTML 页面和 PPT 既有状态函数，以共享语义类统一移动壳层。范围与要求继续使用现有草稿字段和事件锚点，但将结构化控件移出消息气泡；模板仍由现有 `data-template` 驱动，只替换视觉预览结构。新增规则限定在 `max-width: 767px`，桌面布局继续沿用现有规则。

**Tech Stack:** 原生 HTML、共享 CSS、原生 JavaScript、Node.js `assert` 静态测试、本地浏览器响应式验证。

## Global Constraints

- 设计来源：`docs/superpowers/specs/2026-08-12-mobile-conversation-system-design.md`。
- 不增加页面、路由、业务字段或 PPT 制作步骤。
- 保留 `data-chat-form`、`data-ppt-inline-form`、`data-material-form`、`data-ppt-scope-choice`、`data-friend-opinion`、`data-ppt-view`、`data-template` 和 `data-mobile-view`。
- 不修改全局设计令牌，不使用手绘线框图标，不影响 768px 及以上桌面双栏布局。
- 360、390、430px 不得出现页面级横向滚动；触控目标不小于 44px。
- 每个移动视口最多一个内容区实心主操作。
- 当前 `.git` 目录只读；任务中的提交命令保留为交付步骤，实际执行若仍无法创建 `index.lock`，跳过提交并在最终报告中说明。

---

### Task 1: 建立统一移动会话契约

**Files:**
- Create: `prototype/tests/laoji-mobile-conversation-system.test.js`
- Reference: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- Produces: 四页共享壳、统一输入器、任务面板、模板封面和自动增高输入器的静态契约。
- Consumes: 现有 HTML/CSS/JS 文件文本。

- [ ] **Step 1: 写失败测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['laoji-chat.html', 'laoji-ppt-materials.html', 'laoji-ppt-outline.html', 'laoji-ppt-preview.html'].map(read);
const materials = pages[1];
const preview = pages[3];
const css = read('assets/laoji.css');
const js = read('assets/laoji.js');

pages.forEach((html) => {
  assert.match(html, /<body[^>]*class="[^"]*mobile-conversation-page/);
  assert.match(html, /data-mobile-conversation-header/);
  assert.match(html, /class="[^"]*mobile-chat-composer/);
  assert.match(html, /class="[^"]*conversation-send-icon/);
});
assert.match(materials, /data-ppt-task-panel="scope"/);
assert.match(materials, /data-ppt-task-panel="requirements"/);
assert.doesNotMatch(materials, /message-bubble[\s\S]{0,1800}data-material-form/);
['business', 'cards', 'story'].forEach((name) => assert.match(preview, new RegExp(`data-template-cover="${name}"`)));
assert.match(css, /\.ppt-template-cover\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
assert.match(js, /function resizeConversationInput\(input\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node prototype/tests/laoji-mobile-conversation-system.test.js`  
Expected: FAIL，报告 `mobile-conversation-page` 缺失。

- [ ] **Step 3: 提交测试基线**

```bash
git add prototype/tests/laoji-mobile-conversation-system.test.js
git commit -m "test: define unified mobile conversation contract"
```

---

### Task 2: 统一四页移动页头和输入器

**Files:**
- Modify: `prototype/laoji-chat.html`
- Modify: `prototype/laoji-ppt-materials.html`
- Modify: `prototype/laoji-ppt-outline.html`
- Modify: `prototype/laoji-ppt-preview.html`
- Modify: `prototype/assets/laoji.css`
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-mobile-conversation-system.test.js`

**Interfaces:**
- Produces: `.mobile-conversation-page`、`[data-mobile-conversation-header]`、`.mobile-chat-composer`、`.conversation-send-icon`、`resizeConversationInput(input)`。
- Consumes: 现有表单数据锚点和提交逻辑。

- [ ] **Step 1: 给四页添加共享页面类和页头锚点**

普通对话使用：

```html
<body class="chat-page mobile-conversation-page" data-od-id="chat-page">
<header class="topbar mobile-conversation-header" data-mobile-conversation-header data-od-id="chat-header">
```

三个 PPT 页面使用 `class="ppt-conversation-page mobile-conversation-page"`，其页头增加 `mobile-conversation-header` 和 `data-mobile-conversation-header`。PPT 页头增加 44px 的移动返回入口，标题第二行分别为“原子习惯 · 范围与要求”“原子习惯 · 编辑大纲”“原子习惯 · 预览与生成”。

- [ ] **Step 2: 统一四页输入器 DOM**

保留各页面原数据锚点，所有表单增加 `mobile-chat-composer`；所有发送按钮使用：

```html
<button class="btn btn-primary conversation-send-icon" type="submit" aria-label="发送">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
  <span>发送</span>
</button>
```

- [ ] **Step 3: 添加共享移动规则**

```css
@media (max-width: 767px) {
  .mobile-conversation-page { overflow-x: clip; }
  .mobile-conversation-header { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; min-height: 64px; padding: 6px 9px; }
  .mobile-conversation-header .topbar-title { grid-column: 2; grid-row: 1; min-width: 0; text-align: center; }
  .mobile-conversation-header h1 { overflow: hidden; margin: 0; font: 600 16px/1.35 var(--ui); text-overflow: ellipsis; white-space: nowrap; }
  .mobile-conversation-header .topbar-sub { display: block; overflow: hidden; margin-top: 1px; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-chat-composer { grid-template-columns: minmax(0, 1fr) 44px; gap: 8px; width: min(800px, 100%); padding: 6px; border: 1px solid var(--border); border-radius: 15px; background: var(--white); box-shadow: 0 8px 24px oklch(0.30 0.03 170 / .10); }
  .mobile-chat-composer .chat-input { min-height: 44px; max-height: 112px; padding: 10px 8px; border: 0; overflow-y: auto; resize: none; }
  .mobile-chat-composer .conversation-send-icon { width: 44px; min-width: 44px; min-height: 44px; padding: 0; border-radius: 11px; font-size: 0; }
  .mobile-chat-composer .conversation-send-icon::after { content: none; }
  .mobile-chat-composer .conversation-send-icon svg { width: 20px; height: 20px; }
  .mobile-chat-composer .conversation-send-icon span { display: none; }
}
```

- [ ] **Step 4: 添加共享自动增高函数**

```js
function resizeConversationInput(input) {
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}
function initConversationInputs() {
  $$('[data-chat-input], [data-ppt-inline-input]').forEach((input) => {
    resizeConversationInput(input);
    input.addEventListener('input', () => resizeConversationInput(input));
  });
}
```

在总初始化函数中调用 `initConversationInputs()`；恢复普通对话草稿后和清空 PPT 输入后再次调用 `resizeConversationInput(input)`。

- [ ] **Step 5: 运行测试**

Run: `node prototype/tests/laoji-mobile-conversation-system.test.js`  
Expected: 页头、输入器和 JS 断言 PASS；任务面板与模板封面断言仍 FAIL。

- [ ] **Step 6: 提交共享壳**

```bash
git add prototype/laoji-chat.html prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-conversation-system.test.js
git commit -m "feat: unify mobile conversation shell"
```

---

### Task 3: 把 PPT 范围与要求移出消息气泡

**Files:**
- Modify: `prototype/laoji-ppt-materials.html`
- Modify: `prototype/assets/laoji.css`
- Test: `prototype/tests/laoji-mobile-conversation-system.test.js`

**Interfaces:**
- Produces: `[data-ppt-task-panel="scope"]` 和 `[data-ppt-task-panel="requirements"]`。
- Consumes: 现有范围、书友观点、表单和生成锚点。

- [ ] **Step 1: 将范围控件移到助手消息后的兄弟面板**

```html
<section class="ppt-task-panel" data-ppt-task-panel="scope" aria-labelledby="ppt-scope-title">
  <div class="ppt-task-panel-head"><div><p class="eyebrow">第 1 步</p><h2 id="ppt-scope-title">内容范围</h2></div><span class="data">单选</span></div>
  <div class="choice-row" role="group" aria-label="选择内容范围"><button class="choice-chip" type="button" aria-pressed="true" data-ppt-scope-choice="all-notes">我的笔记 + 老己笔记</button><button class="choice-chip" type="button" aria-pressed="false" data-ppt-scope-choice="chapters">指定章节</button><button class="choice-chip" type="button" aria-pressed="false" data-ppt-scope-choice="laoji-notes">只用老己笔记</button></div>
  <label class="ppt-task-switch"><input type="checkbox" data-friend-opinion><span><strong>加入书友观点</strong><small>默认关闭；开启后保留作者与来源。</small></span></label>
</section>
```

- [ ] **Step 2: 将需求表单移到第二个兄弟面板**

```html
<form class="ppt-task-panel" data-ppt-task-panel="requirements" data-material-form data-od-id="generation-requirements">
  <div class="ppt-task-panel-head"><div><p class="eyebrow">第 2 步</p><h2>分享要求</h2></div><span class="data">草稿已保存</span></div>
  <div class="form-grid"><div class="field"><label for="ppt-topic">主题</label><input class="input" id="ppt-topic" value="让好习惯自然发生"></div><div class="form-row"><div class="field"><label for="purpose">用途</label><select class="select" id="purpose"><option>读书分享</option><option>内部培训</option><option>个人复盘</option></select></div><div class="field"><label for="audience">分享对象</label><input class="input" id="audience" value="项目团队"></div></div><div class="field"><label for="page-count">页数</label><select class="select" id="page-count"><option>6–10 页</option><option selected>11–15 页</option><option>16–20 页</option></select></div><div class="field"><label for="ppt-notes">补充要求</label><textarea class="textarea" id="ppt-notes">控制在 15 分钟，减少概念定义，增加两个工作场景案例。</textarea></div></div>
  <div class="card-actions"><button class="btn btn-primary" type="submit" data-generate-outline data-od-id="generate-outline-button">生成大纲</button></div>
</form>
```

- [ ] **Step 3: 添加扁平任务面板样式**

```css
@media (max-width: 767px) {
  [data-ppt-workbench="materials"] .ppt-task-panel { width: calc(100% - 35px); min-width: 0; margin-left: 35px; padding: 16px 0 4px; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: transparent; box-shadow: none; }
  .ppt-task-panel-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .ppt-task-panel-head h2 { margin: 1px 0 0; font: 600 16px/1.35 var(--ui); }
  .ppt-task-switch { min-height: 56px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 10px; margin-top: 10px; padding: 8px 2px; }
  [data-ppt-task-panel="requirements"] .form-grid, [data-ppt-task-panel="requirements"] .form-row { display: grid; grid-template-columns: 1fr; gap: 12px; margin: 0; }
  [data-ppt-task-panel="requirements"] [data-generate-outline] { width: 100%; min-height: 48px; }
}
```

- [ ] **Step 4: 运行新旧 PPT 测试**

Run: `node prototype/tests/laoji-mobile-conversation-system.test.js && node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`  
Expected: 任务面板和旧作品层断言 PASS；模板封面断言仍 FAIL。

- [ ] **Step 5: 提交任务面板**

```bash
git add prototype/laoji-ppt-materials.html prototype/assets/laoji.css prototype/tests/laoji-mobile-conversation-system.test.js
git commit -m "feat: flatten mobile ppt requirements flow"
```

---

### Task 4: 用真实封面替换模板文字占位

**Files:**
- Modify: `prototype/laoji-ppt-preview.html`
- Modify: `prototype/assets/laoji.css`
- Test: `prototype/tests/laoji-mobile-conversation-system.test.js`

**Interfaces:**
- Produces: `.ppt-template-cover` 和 `data-template-cover="business|cards|story"`。
- Consumes: 现有 `data-template` 和模板选择事件。

- [ ] **Step 1: 替换三个 `.template-mini`**

```html
<span class="ppt-template-cover ppt-template-business" data-template-cover="business" aria-hidden="true"><span class="ppt-template-kicker">ATOMIC HABITS</span><span class="ppt-template-title">让好习惯<br>自然发生</span><span class="ppt-template-rule"></span><span class="ppt-template-meta">读书分享 · 2026</span></span>
<span class="ppt-template-cover ppt-template-cards" data-template-cover="cards" aria-hidden="true"><span class="ppt-template-number">01</span><span class="ppt-template-title">习惯不是目标<br>而是一套系统</span><span class="ppt-template-card">提示 → 行动 → 奖励</span></span>
<span class="ppt-template-cover ppt-template-story" data-template-cover="story" aria-hidden="true"><span class="ppt-template-image"><span></span><span></span><span></span></span><span class="ppt-template-copy"><span class="ppt-template-kicker">CHAPTER 01</span><span class="ppt-template-title">微小改变<br>如何累积</span></span></span>
```

- [ ] **Step 2: 添加共同 16:9 封面和三种版式**

```css
.ppt-template-cover { position: relative; aspect-ratio: 16 / 9; display: block; overflow: hidden; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--white); color: var(--fg); }
.ppt-template-business { padding: 13px; background: oklch(0.96 0.018 157); }
.ppt-template-business .ppt-template-title { position: absolute; left: 13px; top: 31px; font: 600 13px/1.2 var(--reading); }
.ppt-template-business .ppt-template-rule { position: absolute; left: 13px; right: 38%; bottom: 18px; height: 2px; background: var(--accent); }
.ppt-template-cards { padding: 10px; background: oklch(0.95 0.025 90); }
.ppt-template-cards .ppt-template-number { font: 700 18px/1 var(--data); color: var(--accent); }
.ppt-template-cards .ppt-template-title { position: absolute; left: 40px; top: 12px; font: 600 11px/1.3 var(--reading); }
.ppt-template-cards .ppt-template-card { position: absolute; left: 10px; right: 10px; bottom: 9px; padding: 6px 8px; border-radius: 5px; background: var(--white); font-size: 7px; }
.ppt-template-story { display: grid; grid-template-columns: 54% 46%; background: oklch(0.24 0.028 175); color: var(--white); }
.ppt-template-story .ppt-template-image { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 7px; }
.ppt-template-story .ppt-template-image span:first-child { grid-row: span 2; background: oklch(0.68 0.06 160); }
.ppt-template-story .ppt-template-image span { border-radius: 3px; background: oklch(0.78 0.035 105); }
.ppt-template-story .ppt-template-copy { align-self: end; padding: 10px 8px; }
```

- [ ] **Step 3: 添加不缩放的选中状态**

```css
.template-option { position: relative; }
.template-option.is-active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.template-option.is-active::after { content: "✓"; position: absolute; top: 18px; right: 18px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--white); font: 700 12px/1 var(--ui); }
@media (max-width: 767px) { [data-mobile-template-rail] .template-option.is-active { transform: none; } }
```

- [ ] **Step 4: 运行统一测试和旧 PPT 测试**

Run: `node prototype/tests/laoji-mobile-conversation-system.test.js && node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`  
Expected: 两个测试均 PASS。

- [ ] **Step 5: 提交模板封面**

```bash
git add prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/tests/laoji-mobile-conversation-system.test.js
git commit -m "feat: add real ppt template covers"
```

---

### Task 5: 全量回归与视觉验证

**Files:**
- Verify: `prototype/laoji-chat.html`
- Verify: `prototype/laoji-ppt-materials.html`
- Verify: `prototype/laoji-ppt-outline.html`
- Verify: `prototype/laoji-ppt-preview.html`
- Verify: `prototype/assets/laoji.css`
- Verify: `prototype/assets/laoji.js`
- Test: `prototype/tests/*.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 的结果。
- Produces: 移动端无溢出、桌面不退化和交互状态保持的验证证据。

- [ ] **Step 1: 运行全部静态测试**

Run: `for test_file in prototype/tests/*.test.js; do node "$test_file" || exit 1; done`  
Expected: 所有测试退出码为 0。

- [ ] **Step 2: 运行语法与空白检查**

Run: `node --check prototype/assets/laoji.js`  
Expected: 无输出并返回 0。

Run: `git diff --check -- prototype docs/superpowers/specs/2026-08-12-mobile-conversation-system-design.md docs/superpowers/plans/2026-08-12-mobile-conversation-system.md`  
Expected: 无输出并返回 0。

- [ ] **Step 3: 浏览器验证移动宽度**

依次打开四个页面，在 360×800、390×844、430×932 检查：

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`。
- 四页页头高度一致，标题不推动左右操作。
- 四页输入器外观、发送图标和自动增高一致。
- 范围与要求面板不在消息气泡内部。
- 三张模板封面均保持 16:9 且版式可区分。
- 大纲和预览作品层进入、返回、Escape 和滚动位置恢复可用。

- [ ] **Step 4: 浏览器验证 1280×800 桌面布局**

确认普通对话和三个 PPT 页面中的会话栏、消息区、作品画布、模板选择和状态操作完整可见。

- [ ] **Step 5: 最终提交**

```bash
git add docs/superpowers/specs/2026-08-12-mobile-conversation-system-design.md docs/superpowers/plans/2026-08-12-mobile-conversation-system.md prototype/laoji-chat.html prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-conversation-system.test.js
git commit -m "feat: unify mobile conversation experience"
```
