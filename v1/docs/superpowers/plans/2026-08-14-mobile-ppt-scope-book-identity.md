# Mobile PPT Scope Book Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the repeated bound-book identity strip from the mobile PPT scope artifact while preserving it on tablet and desktop.

**Architecture:** Keep the existing `.scope-book-identity` DOM and desktop styling intact. Add one scoped mobile override inside the existing `@media (max-width: 767px)` PPT conversation block, then verify the mobile artifact with the existing shared conversation test and real responsive rendering.

**Tech Stack:** Static HTML, shared CSS, Node assertion tests, local browser preview.

## Global Constraints

- Modify only the mobile PPT scope artifact identity strip.
- `<=767px`: hide `.scope-book-identity` completely.
- `>=768px`: preserve the existing identity strip.
- Do not modify PDF/EPUB reader pages, other PPT stages, routes, state, or design tokens.
- Keep all remaining controls at least 44px and preserve keyboard focus behavior.

---

### Task 1: Lock the responsive identity-strip contract

**Files:**
- Modify: `prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js`
- Modify: `prototype/assets/laoji.css:2272-2285`

**Interfaces:**
- Consumes: `.scope-book-identity` from `prototype/laoji-chat.html` and the existing `@media (max-width: 767px)` PPT conversation block.
- Produces: a mobile-only hidden identity strip while the base desktop `.scope-book-identity` remains a grid.

- [ ] **Step 1: Write the failing regression assertions**

Add these assertions after the existing scope workbench CSS checks:

```js
assert.match(css, /\.scope-book-identity\s*\{[^}]*display:\s*grid/s, '桌面范围工作台应继续显示绑定书籍身份条');
assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.ppt-conversation-page \.scope-book-identity\s*\{[^}]*display:\s*none/s, '手机范围作品层应移除重复书籍身份条');
```

- [ ] **Step 2: Run the target test and verify RED**

Run:

```bash
node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
```

Expected: FAIL with `手机范围作品层应移除重复书籍身份条` because no mobile override exists.

- [ ] **Step 3: Add the minimal mobile override**

Inside the existing `@media (max-width: 767px)` block in `prototype/assets/laoji.css`, add:

```css
.ppt-conversation-page .scope-book-identity { display: none; }
```

- [ ] **Step 4: Run target and related tests and verify GREEN**

Run:

```bash
node prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js
node prototype/tests/laoji-mobile-conversation-system.test.js
node prototype/tests/laoji-desktop-ppt-continuity.test.js
```

Expected: all three commands exit 0.

- [ ] **Step 5: Verify real responsive behavior**

Open `prototype/laoji-chat.html`, enter the PPT scope artifact, and check 360, 390, 430, 768, 1024, 1200, and 1440px.

Expected:

- 360/390/430px: `.scope-book-identity` is not rendered, “内容范围” begins directly after the artifact header, and there is no horizontal overflow.
- 768/1024/1200/1440px: `.scope-book-identity` remains visible.
- “确认并生成大纲” remains focusable and at least 44px tall.

- [ ] **Step 6: Run final regression and integrity checks**

Run:

```bash
for test_file in prototype/tests/*.test.js; do node "$test_file"; done
node --check prototype/assets/laoji.js
git diff --check
```

Expected: all tests pass, JavaScript syntax is valid, and `git diff --check` exits 0.

- [ ] **Step 7: Commit when repository metadata is writable**

```bash
git add docs/superpowers/specs/2026-08-14-mobile-ppt-scope-book-identity-design.md docs/superpowers/plans/2026-08-14-mobile-ppt-scope-book-identity.md prototype/tests/laoji-mobile-ppt-conversation-workbench.test.js prototype/assets/laoji.css
git commit -m "fix: simplify mobile ppt scope header"
```

If `.git` is read-only, leave the verified files in the workspace and report that limitation instead of retrying destructive or elevated operations.
