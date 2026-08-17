# Compact Book PPT List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verbose book PPT record cards with a compact responsive work index and simplify the materials confirmation panel without changing PPT state or routing.

**Architecture:** Keep `LaojiState` and `renderBookPptLists()` as the single data source. Change only the semantic DOM produced by `createBookPptCard()`, its scoped `.book-ppt-list`/`.ppt-record-*` CSS, and the local materials-page copy. The three book types continue to share one renderer.

**Tech Stack:** Static HTML, shared vanilla JavaScript, shared CSS, Node assertion scripts.

## Global Constraints

- No new dependencies.
- Preserve loading, true-empty, request-failure, generating, finalizing, failed, and completed states.
- Mobile 360/390/430px must not scroll horizontally; all explicit controls remain at least 44px.
- Mobile and desktop both use a single-column horizontal work index.
- The visible materials primary action is `生成大纲`; its accessible name is `确认范围并生成大纲`.
- Completed records have no list-level `下载 PPTX` button; downloading remains available after opening the work.
- Existing celadon tokens, fonts, state storage, routing, and work recovery remain unchanged.

---

### Task 1: Lock the compact record contract with failing tests

**Files:**
- Modify: `prototype/tests/laoji-ppt-lifecycle-sync.test.js`
- Modify: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- Consumes: `createBookPptCard(record)`, `.book-ppt-list`, and `[data-generate-outline]`.
- Produces: regression assertions for card-wide links, concise copy, responsive columns, and materials copy.

- [ ] **Step 1: Add failing renderer assertions**

```js
assert.match(js, /article\.className = `card entity-card ppt-record-card[\s\S]*?const recordLink = document\.createElement\('a'\)/, '每条书籍 PPT 记录应由整卡链接进入作品');
assert.doesNotMatch(js, /download\.textContent = '下载 PPTX'/, '完成作品列表不得重复提供下载按钮');
assert.match(js, /resume\.textContent = '继续'/, '失败任务只保留简短继续操作');
assert.match(css, /\.book-ppt-list\s*\{[^}]*grid-template-columns:\s*1fr/s, '手机和桌面作品索引应统一为单列');
```

- [ ] **Step 2: Add failing materials assertions**

```js
assert.match(materials, /data-generate-outline[^>]*aria-label="确认范围并生成大纲"[^>]*>生成大纲</, '材料页主操作应使用简洁可见文案和完整可访问名称');
assert.doesNotMatch(materials, /原子习惯 · 读书 PPT|草稿已保存|补充要求可继续在左侧对话中发送/, '材料工作台应移除重复身份、静态状态和帮助句');
```

- [ ] **Step 3: Run tests and confirm red state**

Run:

```bash
node prototype/tests/laoji-ppt-lifecycle-sync.test.js
node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
```

Expected: both fail on the new compact-list or concise-material assertions.

### Task 2: Implement the shared compact record renderer

**Files:**
- Modify: `prototype/assets/laoji.js:1895-1949`
- Test: `prototype/tests/laoji-ppt-lifecycle-sync.test.js`

**Interfaces:**
- Consumes: `record`, `createBookPptCover(record, visualStatus)`, and `getPptRecordHref(record)`.
- Produces: one `.ppt-record-card` containing `.ppt-record-link` for generating/finalizing/completed records; failed records also expose `[data-delete-ppt-record]`.

- [ ] **Step 1: Replace repeated headings and descriptions with one metadata line**

```js
const meta = document.createElement('span');
meta.className = 'ppt-record-meta';
if (record.status === 'generating') meta.textContent = `正在生成第 ${record.currentPage} / ${record.totalPages} 页`;
if (record.status === 'finalizing') meta.textContent = '正在完成文件';
if (record.status === 'failed') meta.textContent = `生成失败 · 已完成 ${record.completedPages} / ${record.totalPages} 页`;
if (record.status === 'completed') meta.textContent = `${record.createdAt || '刚刚'} · ${record.totalPages} 页`;
```

- [ ] **Step 2: Make the record body a card-wide work link**

```js
const recordLink = document.createElement('a');
recordLink.className = 'ppt-record-link';
recordLink.href = getPptRecordHref(record);
recordLink.setAttribute('aria-label', `${meta.textContent}，${record.title}`);
recordLink.append(cover, body);
article.append(recordLink);
```

- [ ] **Step 3: Keep only necessary recovery controls**

```js
if (record.status === 'failed') {
  const resume = document.createElement('a');
  resume.className = 'btn btn-primary';
  resume.href = getPptRecordHref(record);
  resume.textContent = '继续';
  const remove = document.createElement('button');
  remove.className = 'btn btn-ghost ppt-record-delete';
  remove.type = 'button';
  remove.dataset.deletePptRecord = record.id;
  remove.textContent = '删除';
  actions.append(resume, remove);
}
```

- [ ] **Step 4: Run the lifecycle test**

Run: `node prototype/tests/laoji-ppt-lifecycle-sync.test.js`

Expected: renderer assertions pass; state lifecycle assertions remain green.

### Task 3: Implement a shared single-column mobile and desktop list

**Files:**
- Modify: `prototype/assets/laoji.css:1762-1866`
- Test: `prototype/tests/laoji-ppt-lifecycle-sync.test.js`

**Interfaces:**
- Consumes: `.book-ppt-list`, `.ppt-record-card`, `.ppt-record-link`, `.ppt-record-cover`, `.ppt-record-body`, `.ppt-record-meta`.
- Produces: the same single-column horizontal work rows on mobile and desktop without fixed page widths.

- [ ] **Step 1: Define the shared single-column list and card-wide link**

```css
.book-ppt-list { display: grid; grid-template-columns: 1fr; gap: 14px; }
.ppt-record-card { min-width: 0; padding: 0; overflow: hidden; }
.ppt-record-link { display: grid; grid-template-columns: 148px minmax(0, 1fr); gap: 16px; min-height: 132px; padding: 14px; color: var(--fg); }
.ppt-record-link:hover { background: var(--surface); }
.ppt-record-link:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: -3px; }
.ppt-record-meta { color: var(--muted); font-size: 13px; line-height: 1.45; }
```

- [ ] **Step 2: Define the mobile row**

```css
@media (max-width: 767px) {
  .book-ppt-list { grid-template-columns: 1fr; gap: 10px; }
  .ppt-record-link { grid-template-columns: 112px minmax(0, 1fr); gap: 14px; min-height: 112px; padding: 12px; }
  .ppt-record-link h2 { margin: 4px 0; font-size: 16px; }
  .ppt-record-note { font-size: 11px; }
}
```

- [ ] **Step 3: Run the lifecycle test**

Run: `node prototype/tests/laoji-ppt-lifecycle-sync.test.js`

Expected: compact responsive CSS assertions pass.

### Task 4: Simplify the materials confirmation panel

**Files:**
- Modify: `prototype/laoji-ppt-materials.html:37-51`
- Test: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

**Interfaces:**
- Consumes: existing `[data-material-form]` submit handler.
- Produces: concise labels while preserving `data-choice-value`, `data-draft-field`, `data-generate-outline`, and no-script fallback.

- [ ] **Step 1: Remove redundant header and helper copy**

```html
<div><h2 id="materials-scope-title">确认 PPT 范围</h2></div>
<button class="btn btn-ghost ppt-workbench-toggle" type="button" data-ppt-workbench-toggle aria-expanded="true" aria-label="收起作品工作台">收起</button>
```

- [ ] **Step 2: Compress visible choice labels without changing values**

```html
<button class="scope-choice is-selected" type="button" aria-pressed="true" data-choice-value="whole-book">整本书</button>
<button class="scope-choice" type="button" aria-pressed="false" data-choice-value="5">精简 · 5 页</button>
```

- [ ] **Step 3: Keep one concise submit action**

```html
<button class="btn btn-primary scope-confirm-submit" type="submit" data-generate-outline aria-label="确认范围并生成大纲" data-od-id="generate-outline-button">生成大纲</button>
```

- [ ] **Step 4: Run the materials test**

Run: `node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`

Expected: concise-copy assertions and submit-behavior assertions pass.

### Task 5: Synchronize current product and interface facts

**Files:**
- Modify: `docs/prd/laoji-mvp-prototype-prd.md:753-759,848-855`
- Modify: `docs/ui/laoji-mvp-ui-design-spec.md:138,260-274`

**Interfaces:**
- Consumes: approved visible copy and list behavior.
- Produces: current source-of-truth statements; no dated change log.

- [ ] **Step 1: Update the PRD current rules**

Record that the visible scope action is `生成大纲`, the accessible meaning remains confirmation plus generation, completed list records open the work without a list-level download control, and failed records retain continue/delete recovery.

- [ ] **Step 2: Update the UI specification current rules**

Record the shared mobile-and-desktop single-column work index, maximum three-line information hierarchy, card-wide focusable link, and concise failure controls.

- [ ] **Step 3: Scan for contradictory old copy**

Run:

```bash
rg -n "确认并生成大纲|下载 PPTX|完成作品|点击查看瀑布流预览|独立作品" docs/prd/laoji-mvp-prototype-prd.md docs/ui/laoji-mvp-ui-design-spec.md
```

Expected: remaining hits refer only to the outline/preview detail flow or are updated to the new list/material semantics.

### Task 6: Verify interaction, responsiveness, and regressions

**Files:**
- Verify: `prototype/laoji-wechat-book.html`
- Verify: `prototype/laoji-epub-reader.html`
- Verify: `prototype/laoji-pdf-reader.html`
- Verify: `prototype/laoji-ppt-materials.html`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: evidence that the change works in the actual prototype.

- [ ] **Step 1: Run all prototype tests**

```bash
set -e
for test_file in prototype/tests/*.test.js; do node "$test_file"; done
```

- [ ] **Step 2: Run static integrity checks**

```bash
git diff --check
rg -n "\{\{[^}]+\}\}" prototype/laoji-ppt-materials.html prototype/assets/laoji.js prototype/assets/laoji.css
```

- [ ] **Step 3: Inspect the actual book PPT list and materials flow**

Open the WeChat book with its `读书 PPT` tab selected and verify 360, 390, 430, 768, 1024, 1200, and 1440px. Confirm no horizontal scroll, no overlap, visible focus, card navigation, failed recovery controls, and materials submit navigation.

- [ ] **Step 4: Commit the completed change when repository write authority is available**

```bash
git add docs/prd/laoji-mvp-prototype-prd.md docs/ui/laoji-mvp-ui-design-spec.md docs/superpowers/specs/2026-08-14-book-ppt-list-density-design.md docs/superpowers/plans/2026-08-14-book-ppt-list-density.md prototype/assets/laoji.js prototype/assets/laoji.css prototype/laoji-ppt-materials.html prototype/tests/laoji-ppt-lifecycle-sync.test.js prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
git commit -m "feat: compact book PPT work index"
```

Expected: commit succeeds outside the current read-only `.git` sandbox.
