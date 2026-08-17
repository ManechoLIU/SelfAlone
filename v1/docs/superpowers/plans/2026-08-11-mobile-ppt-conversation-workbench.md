# 老己移动端 PPT 对话工作台 Implementation Plan

> 历史计划：生命周期、文档式大纲、真实模板启动生成和书籍任务列表已被 `../specs/2026-08-12-ppt-workbench-and-book-ppt-lifecycle-design.md` 替代。不得继续执行本文中的“创建新版本”等旧任务；等待新计划。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有 PPT 制作功能、路由和数据模型的前提下，把素材确认、大纲编辑、模板预览三段移动端流程重构为“对话主界面 + 全屏作品工作台”，彻底消除 360–430px 的横向溢出与组件堆砌感，并保持桌面双栏体验不变。

**Architecture:** 继续以三个现有 HTML 页面承载流程，用 `data-mobile-view="chat|artifact"` 作为唯一移动视图状态；共享 CSS 只在 `max-width: 767px` 内重排材料页、作品顶栏、页面条、模板轨道和底部操作栏；共享 JS 仅补充视图切换、滚动锁定、滚动位置恢复和可访问状态，不创建新路由或新业务状态。

**Tech Stack:** 原生 HTML、共享 CSS（`prototype/assets/laoji.css`）、原生 JavaScript（`prototype/assets/laoji.js`）、Node.js `assert` 静态回归测试。

## Global Constraints

- 设计来源：`docs/superpowers/specs/2026-08-11-mobile-ppt-conversation-workbench-design.md`。
- 视觉基准：`open-design-ui-reference/laoji-ppt-desktop-mobile.png`；真实缺陷证据：`image-10.png`。
- 不增加功能、步骤、数据字段、页面或路由；保留内容选择、大纲编辑、模板选择、逐页预览、生成、重试和下载。
- 不改全局设计令牌，不影响 768px 及以上桌面双栏布局，不恢复 CSS 手绘占位图标。
- 360、390、430、600、768px 均不得出现页面级横向滚动；触控目标不小于 44px。
- 每个移动视口最多一个实心主操作；作品态隐藏底部主导航，返回对话后恢复。
- 所有新增或重排的可评论区域、标题和主要操作保留或补齐稳定的 `data-od-id`。

---

### Task 1: 建立移动端 PPT 工作台回归契约

**Files:**
- Create: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`
- Reference: `prototype/tests/laoji-reading-ppt-redesign.test.js`
- Reference: `prototype/tests/laoji-premium-sidebar-responsive.test.js`

**Interfaces:**
- 三个页面继续暴露 `data-ppt-chat-shell`。
- 大纲和预览页面继续使用 `data-mobile-view="chat"` 初始状态。
- 新增测试锚点：`data-mobile-slide-strip`、`data-mobile-artifact-actions`、`data-mobile-template-rail`、`data-mobile-preview-controls`。
- 共享 JS 必须包含独立的移动视图切换函数，并切换 `ppt-artifact-open` 类。

- [ ] **Step 1: 写结构与行为契约测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('assets/laoji.css');
const js = read('assets/laoji.js');
const materials = read('laoji-ppt-materials.html');
const outline = read('laoji-ppt-outline.html');
const preview = read('laoji-ppt-preview.html');

assert.match(materials, /data-ppt-workbench="materials"/);
assert.match(outline, /data-mobile-slide-strip/);
assert.match(outline, /data-mobile-artifact-actions/);
assert.match(preview, /data-mobile-template-rail/);
assert.match(preview, /data-mobile-preview-controls/);
assert.match(js, /function setPptMobileView\(/);
assert.match(js, /ppt-artifact-open/);
assert.match(css, /@media \(max-width: 767px\)[\s\S]*?overflow-x:\s*(?:clip|hidden)/);
assert.doesNotMatch(css, /\.artifact-topbar \.btn:not\(\.artifact-mobile-back\)[^{]*\{[^}]*font-size:\s*0/s);
```

- [ ] **Step 2: 运行测试，确认按预期失败**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: FAIL，首先报告 `data-ppt-workbench="materials"` 或移动作品锚点缺失。

- [ ] **Step 3: 提交测试基线**

```bash
git add prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "test: define mobile ppt workbench contract"
```

---

### Task 2: 固化对话与全屏作品工作台的共享视图状态

**Files:**
- Modify: `prototype/assets/laoji.js:1832-1859`
- Modify: `prototype/assets/laoji.css:680-749`
- Modify: `prototype/laoji-ppt-outline.html:9-33`
- Modify: `prototype/laoji-ppt-preview.html:9-31`
- Test: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- `setPptMobileView(shell, nextView)` 仅接受 `chat` 或 `artifact`。
- 进入作品态前记录 `[data-ppt-chat-pane] [data-chat-feed]` 的 `scrollTop`。
- 作品态给 `body` 添加 `ppt-artifact-open`，返回时移除并恢复聊天滚动位置。
- `[data-ppt-view]` 更新 `aria-pressed`；作品画布同步 `aria-hidden`。
- Escape 在作品态返回对话；不更改页面路由。

- [ ] **Step 1: 扩充失败测试，覆盖状态函数与滚动锁**

```js
assert.match(js, /function setPptMobileView\(shell, nextView\)/);
assert.match(js, /chatFeed\.scrollTop/);
assert.match(js, /document\.body\.classList\.toggle\('ppt-artifact-open'/);
assert.match(js, /event\.key === 'Escape'/);
assert.match(css, /body\.ppt-artifact-open\s*\{[^}]*overflow:\s*hidden/s);
```

- [ ] **Step 2: 运行单测，确认新断言失败**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: FAIL，报告 `setPptMobileView` 或 `ppt-artifact-open` 缺失。

- [ ] **Step 3: 用单一函数替换内联 dataset 写入**

```js
function setPptMobileView(shell, nextView) {
  if (!['chat', 'artifact'].includes(nextView)) return;
  const chatFeed = $('[data-ppt-chat-pane] [data-chat-feed]', shell);
  const artifact = $('.ppt-artifact-canvas', shell);
  if (nextView === 'artifact' && chatFeed) shell.dataset.chatScrollTop = String(chatFeed.scrollTop);
  shell.dataset.mobileView = nextView;
  document.body.classList.toggle('ppt-artifact-open', nextView === 'artifact');
  artifact?.setAttribute('aria-hidden', String(nextView !== 'artifact'));
  $$('[data-ppt-view]', shell).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.pptView === nextView));
  });
  if (nextView === 'chat' && chatFeed) {
    window.requestAnimationFrame(() => { chatFeed.scrollTop = Number(shell.dataset.chatScrollTop || 0); });
  }
}
```

- [ ] **Step 4: 在初始化和 Escape 路径调用共享函数**

```js
setPptMobileView(shell, shell.dataset.mobileView || 'chat');
$$('[data-ppt-view]', shell).forEach((button) => {
  button.addEventListener('click', () => setPptMobileView(shell, button.dataset.pptView));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell.dataset.mobileView === 'artifact') setPptMobileView(shell, 'chat');
});
```

- [ ] **Step 5: 添加移动端滚动与层级规则**

```css
@media (max-width: 767px) {
  body.ppt-artifact-open { overflow: hidden; }
  .ppt-chat-shell,
  .ppt-chat-pane,
  .ppt-artifact-canvas { width: 100%; max-width: 100%; min-width: 0; overflow-x: clip; }
  .ppt-artifact-canvas { overscroll-behavior: contain; }
}
```

- [ ] **Step 6: 运行单测**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: 共享视图状态相关断言 PASS；材料、大纲和预览布局断言仍可能失败。

- [ ] **Step 7: 提交共享状态实现**

```bash
git add prototype/assets/laoji.js prototype/assets/laoji.css prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: stabilize mobile ppt workbench view state"
```

---

### Task 3: 把素材确认页收敛为连续的移动对话流

**Files:**
- Modify: `prototype/laoji-ppt-materials.html:4-24`
- Modify: `prototype/assets/laoji.css`（PPT mobile block）
- Test: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- 页面根节点添加 `data-ppt-workbench="materials"`。
- 保留 `data-material-form`、`data-ppt-scope-choice`、`data-friend-opinion`、`data-generate-outline`、`data-ppt-inline-form`，不改变 `initMaterials()` 和 `initPptConversation()` 的业务输入。
- 桌面保留会话列表和右侧进度；手机仅隐藏这两个辅助栏。
- 绑定书籍在手机呈现单行摘要；输入框始终位于安全区上方。

- [ ] **Step 1: 扩充材料页静态契约**

```js
assert.match(materials, /data-ppt-workbench="materials"/);
assert.match(materials, /data-material-form/);
assert.match(materials, /data-generate-outline/);
assert.match(css, /\[data-ppt-workbench="materials"\][\s\S]*?\.chat-sessions/);
assert.match(css, /\[data-ppt-workbench="materials"\][\s\S]*?\.chat-context/);
```

- [ ] **Step 2: 运行单测，确认材料页契约失败**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: FAIL，报告材料页工作台锚点或手机辅助栏规则缺失。

- [ ] **Step 3: 给现有结构添加语义锚点，不重写表单**

```html
<main class="chat-layout" data-ppt-chat-shell data-ppt-workbench="materials" data-od-id="ppt-materials-conversation">
```

- [ ] **Step 4: 添加仅手机生效的连续流规则**

```css
@media (max-width: 767px) {
  [data-ppt-workbench="materials"] { display: block; min-height: calc(100dvh - var(--topbar) - var(--bottom-nav)); }
  [data-ppt-workbench="materials"] > .chat-sessions,
  [data-ppt-workbench="materials"] > .chat-context { display: none; }
  [data-ppt-workbench="materials"] .chat-main { width: 100%; min-width: 0; }
  [data-ppt-workbench="materials"] .chat-thread { width: 100%; }
  [data-ppt-workbench="materials"] .book-binding { grid-template-columns: 44px minmax(0, 1fr) auto; }
  [data-ppt-workbench="materials"] .book-binding > :last-child { grid-column: auto; width: auto; }
  [data-ppt-workbench="materials"] .chat-composer-wrap { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
```

- [ ] **Step 5: 检查主操作预算**

移动端同一视口只保留当前阶段的 `生成大纲` 为实心按钮；消息发送按钮继续属于固定输入器，不在内容区重复生成操作。

- [ ] **Step 6: 运行材料页与既有流程测试**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js && node prototype/tests/laoji-reading-ppt-redesign.test.js`

Expected: PASS。

- [ ] **Step 7: 提交材料页重排**

```bash
git add prototype/laoji-ppt-materials.html prototype/assets/laoji.css prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: refine mobile ppt materials conversation"
```

---

### Task 4: 将大纲页改为可退出的单列全屏编辑器

**Files:**
- Modify: `prototype/laoji-ppt-outline.html:20-31`
- Modify: `prototype/assets/laoji.css`（PPT mobile block）
- Modify: `prototype/assets/laoji.js:1529-1547`（仅补充活动页可访问状态）
- Test: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- 页面列表容器添加 `data-mobile-slide-strip`，手机端恢复显示并横向滚动。
- 顶栏手机只保留“返回对话”、标题和保存状态；“创建新版本”留在次级文字操作区。
- `data-confirm-outline` 移入 `data-mobile-artifact-actions` 底部栏，作为唯一实心主操作。
- 保留 `data-add-slide`、`data-delete-slide`、`data-slide-nav`、`data-slide-title`、`data-slide-points`、`#image-intent`。

- [ ] **Step 1: 写大纲布局失败断言**

```js
assert.match(outline, /data-mobile-slide-strip/);
assert.match(outline, /data-mobile-artifact-actions/);
assert.match(css, /\[data-mobile-slide-strip\][^{]*\{[^}]*overflow-x:\s*auto/s);
assert.doesNotMatch(css, /\.outline-canvas-grid > :first-child\s*\{\s*display:\s*none/);
```

- [ ] **Step 2: 运行单测，确认失败**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: FAIL，报告页面条仍被隐藏或移动操作栏缺失。

- [ ] **Step 3: 重排顶栏和操作位置，保留原按钮属性**

```html
<div class="artifact-topbar" data-od-id="outline-mobile-topbar">…</div>
<aside class="column-panel soft" data-mobile-slide-strip data-od-id="slide-list-panel">…</aside>
<div class="mobile-artifact-actions" data-mobile-artifact-actions>
  <button class="btn" type="button" data-dialog-open="regenerate-dialog">创建新版本</button>
  <button class="btn btn-primary" type="button" data-confirm-outline data-od-id="confirm-outline-button">确认并预览</button>
</div>
```

桌面可通过同一个 DOM 的布局规则把两个操作恢复到顶栏视觉位置；如需要桌面和手机各有一个入口，必须确保同一视口只显示一份，并让 JS 使用 `$$('[data-confirm-outline]')` 绑定全部可见实例，避免重复 ID。

- [ ] **Step 4: 把页面列表改为手机横向页面条**

```css
@media (max-width: 767px) {
  .outline-canvas-grid { display: flex; flex-direction: column; gap: 16px; }
  .outline-canvas-grid > [data-mobile-slide-strip] { display: block; order: 0; width: 100%; }
  [data-mobile-slide-strip] .slide-list { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 6px; }
  [data-mobile-slide-strip] .slide-item { flex: 0 0 auto; min-width: 118px; max-width: 168px; min-height: 44px; scroll-snap-align: start; }
  [data-mobile-slide-strip] [data-add-slide] { width: auto !important; min-height: 44px; }
}
```

- [ ] **Step 5: 将编辑区和底部操作栏限定在视口内**

```css
@media (max-width: 767px) {
  [data-od-id="current-slide-editor"] { order: 1; width: 100%; min-width: 0; }
  [data-mobile-artifact-actions] { position: sticky; bottom: calc(-16px - env(safe-area-inset-bottom)); z-index: 3; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; margin: 18px -16px -16px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  [data-mobile-artifact-actions] .btn { min-height: 44px; }
}
```

- [ ] **Step 6: 同步活动页语义**

在 `render()` 中给活动项同步 `aria-current="page"`，其余项移除；不改变 `slides` 数据结构。

- [ ] **Step 7: 运行大纲交互与回归测试**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js && node prototype/tests/laoji-reading-ppt-redesign.test.js`

Expected: PASS；新增、删除、上一页、下一页和确认预览仍使用现有处理函数。

- [ ] **Step 8: 提交大纲工作台**

```bash
git add prototype/laoji-ppt-outline.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: rebuild mobile ppt outline workbench"
```

---

### Task 5: 将预览页改为模板轨道 + 16:9 作品画布

**Files:**
- Modify: `prototype/laoji-ppt-preview.html:19-29`
- Modify: `prototype/assets/laoji.css`（PPT mobile block）
- Modify: `prototype/assets/laoji.js:1623-1688`（只同步状态语义）
- Test: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- 模板列表添加 `data-mobile-template-rail`，手机宽度每项 `76–82vw`，局部横向吸附。
- 页码工具条添加 `data-mobile-preview-controls`。
- 预览舞台保持 `data-slide-preview`，手机采用 `aspect-ratio: 16 / 9; width: 100%`。
- 底部栏添加 `data-mobile-artifact-actions`；“修改大纲”为次操作，“生成 PPT”为唯一实心主操作。
- 保留 `data-template`、`data-generate-ppt`、`data-preview-nav`、`data-preview-retry`、`data-download`、`data-preview-return` 和四个 `data-preview-state`。

- [ ] **Step 1: 写预览布局失败断言**

```js
assert.match(preview, /data-mobile-template-rail/);
assert.match(preview, /data-mobile-preview-controls/);
assert.match(preview, /data-mobile-artifact-actions/);
assert.match(css, /\[data-mobile-template-rail\][^{]*\{[^}]*overflow-x:\s*auto/s);
assert.match(css, /\.slide-preview\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
```

- [ ] **Step 2: 运行单测，确认失败**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: FAIL，报告模板轨道、16:9 预览或底部操作栏缺失。

- [ ] **Step 3: 拆分模板标题与配图开关行**

```html
<section data-od-id="template-selection">
  <div class="section-head"><div>…</div></div>
  <label class="status-label">…自动生成配图</label>
  <div class="template-list" data-mobile-template-rail>…</div>
</section>
```

- [ ] **Step 4: 把模板选择改为局部横向轨道**

```css
@media (max-width: 767px) {
  [data-mobile-template-rail] { display: flex; gap: 12px; margin-inline: -16px; padding: 0 16px 8px; overflow-x: auto; scroll-snap-type: x mandatory; }
  [data-mobile-template-rail] .template-option { flex: 0 0 80vw; max-width: 340px; min-width: 0; scroll-snap-align: center; }
}
```

- [ ] **Step 5: 将预览画布锁定为真机友好的 16:9**

```css
@media (max-width: 767px) {
  [data-od-id="ppt-preview-stage"] { width: 100%; min-width: 0; padding: 0; overflow: clip; }
  .preview-stage { width: 100%; min-width: 0; padding: 12px; }
  .slide-preview { width: 100%; min-width: 0; aspect-ratio: 16 / 9; padding: clamp(16px, 5vw, 24px); }
  [data-mobile-preview-controls] { min-height: 52px; padding: 4px 8px; }
}
```

- [ ] **Step 6: 重排移动底栏，不复制业务事件**

```html
<div class="mobile-artifact-actions" data-mobile-artifact-actions>
  <a class="btn" href="laoji-ppt-outline.html">修改大纲</a>
  <button class="btn btn-primary" type="button" data-generate-ppt data-od-id="generate-ppt-button">生成 PPT</button>
</div>
```

生成、错误重试和完成下载状态继续由 `initPreview()` 控制；不同状态只替换内容区与底栏按钮可见性，不改变工作台宽度。

- [ ] **Step 7: 为模板和生成状态同步语义**

`applyTemplate()` 同步 `aria-pressed`；`setState()` 把当前状态写入作品画布 `data-current-preview-state`，用于样式和测试，不新增业务状态。

- [ ] **Step 8: 运行预览与流程回归测试**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js && node prototype/tests/laoji-reading-ppt-redesign.test.js`

Expected: PASS；ready、generating、error、complete 均保留，生成重试和下载处理函数不变。

- [ ] **Step 9: 提交预览工作台**

```bash
git add prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: rebuild mobile ppt preview workbench"
```

---

### Task 6: 完成响应式、交互和视觉验收

**Files:**
- Verify: `prototype/laoji-ppt-materials.html`
- Verify: `prototype/laoji-ppt-outline.html`
- Verify: `prototype/laoji-ppt-preview.html`
- Verify: `prototype/assets/laoji.css`
- Verify: `prototype/assets/laoji.js`
- Verify: `prototype/tests/*.test.js`
- Optional output: `output/mobile-ppt-workbench-validation.png`

**Interfaces:**
- 视口矩阵：360、390、430、600、768、1024、1366px。
- 主路径：范围确认 → 生成大纲 → 展开编辑 → 返回对话 → 再次展开 → 确认预览 → 切换模板 → 逐页预览 → 生成 → 失败重试/完成下载。

- [ ] **Step 1: 运行新增测试**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: `laoji-mobile-ppt-conversation-workbench: all tests passed`。

- [ ] **Step 2: 运行全部原型回归测试**

Run: `for test_file in prototype/tests/*.test.js; do node "$test_file" || exit 1; done`

Expected: 全部 PASS；不得以删除既有断言或放宽桌面侧栏规则换取通过。

- [ ] **Step 3: 做静态完整性扫描**

Run: `rg -n "\{\{|TODO|FIXME|font-size:\s*0|overflow-x:\s*visible|width:\s*[4-9][0-9]{2}px" prototype/laoji-ppt-*.html prototype/assets/laoji.css prototype/assets/laoji.js`

Expected: 无模板占位符；移动 PPT 顶栏不再依赖 `font-size: 0` 和 `•••`；命中的固定宽度必须位于桌面规则或合理的上限中。

- [ ] **Step 4: 在真机宽度逐页检查布局**

逐一验证 360/390/430/600px：

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`。
- 作品画布打开后底部导航不可见，返回对话后恢复。
- 对话滚动位置恢复；Escape 和可见返回按钮都能退出作品态。
- 页面条和模板轨道只在自身内部横向滚动。
- 顶栏标题、保存/生成状态、按钮均无截断或重叠。
- 每个可点击目标至少 44px；键盘 `:focus-visible` 清晰。
- `prefers-reduced-motion: reduce` 下切换无明显位移动画。

- [ ] **Step 5: 检查桌面未回归**

在 768、1024、1366px 检查：对话与作品仍为双栏；材料页会话列表和进度栏仍可见；大纲左侧页面列表恢复纵向；预览模板恢复三列；桌面所有原功能可用。

- [ ] **Step 6: 仅在静态检查无法判断碰撞时导出一次视觉结果**

Run: `"$OD_NODE_BIN" "$OD_BIN" export prototype/laoji-ppt-preview.html --project "$OD_PROJECT_ID" --format image --out output/mobile-ppt-workbench-validation.png`

Expected: 预览作品完整、无左右裁切、顶栏和底栏不遮挡内容。若导出环境无法指定手机宽度，记录限制，以浏览器宽度矩阵为准，不重复导出。

- [ ] **Step 7: 最终差异审查**

Run: `git diff --check && git diff -- prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: 无空白错误；改动只覆盖已确认范围；没有新增页面、路由、数据模型或无关全局样式。

- [ ] **Step 8: 提交验收收口**

```bash
git add prototype/laoji-ppt-materials.html prototype/laoji-ppt-outline.html prototype/laoji-ppt-preview.html prototype/assets/laoji.css prototype/assets/laoji.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "test: validate mobile ppt conversation workbench"
```
