# Local Book Detail Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EPUB and PDF imports use one user-facing local-book detail model while retaining only renderer-level reading differences.

**Architecture:** Both HTML pages adopt the same `data-local-*` contracts for summary, navigation, notes, PPT cards, progress, and dialogs. Shared behavior moves to `prototype/assets/laoji.js`; renderer-specific EPUB text and PDF pages remain inside the reading panel.

**Tech Stack:** Static HTML, shared CSS, vanilla JavaScript, Node.js `node:test` regression tests.

## Global Constraints

- Do not show EPUB, PDF, or local-import source labels in user-facing page chrome.
- Keep the visible page hierarchy and operations identical across both local readers.
- Preserve renderer-specific chapter/page controls and scanned-PDF degradation.
- Reuse existing design tokens and components; do not redesign unrelated pages.

---

### Task 1: Lock the unified local-book contract

**Files:**
- Create: `prototype/tests/laoji-local-reader-unification.test.js`
- Test: `prototype/tests/laoji-local-reader-unification.test.js`

**Interfaces:**
- Consumes: `prototype/laoji-epub-reader.html`, `prototype/laoji-pdf-reader.html`
- Produces: Regression contract for `data-local-book-summary`, `data-local-note-list`, `data-local-note-card`, and unified PPT cards.

- [ ] **Step 1: Write the failing test** asserting identical three-view navigation, book metadata, note actions, PPT card structure, and absence of format labels.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test prototype/tests/laoji-local-reader-unification.test.js`

Expected: FAIL because PDF still has legacy notes and lacks the unified summary.

- [ ] **Step 3: Preserve the failing output** as the red-phase evidence before implementation.

### Task 2: Unify EPUB and PDF page structure

**Files:**
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`
- Test: `prototype/tests/laoji-local-reader-unification.test.js`

**Interfaces:**
- Consumes: unified data contracts from Task 1
- Produces: Same summary, navigation, notes, PPT list, dialogs, empty states, and progress markers on both pages.

- [ ] **Step 1: Remove format/source wording** from titles, side footers, and summary metadata.
- [ ] **Step 2: Add the same summary and button-based navigation structure** to both pages.
- [ ] **Step 3: Replace PDF legacy notes markup** with the EPUB-approved flat cards and hover toolbar.
- [ ] **Step 4: Normalize EPUB note attributes** to the shared `data-local-*` names.
- [ ] **Step 5: Normalize both PPT panels** to the same entity-card structure.
- [ ] **Step 6: Run the focused test**

Run: `node --test prototype/tests/laoji-local-reader-unification.test.js`

Expected: PASS.

### Task 3: Share note and progress behavior

**Files:**
- Modify: `prototype/assets/laoji.js`
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`
- Test: `prototype/tests/laoji-local-reader-unification.test.js`

**Interfaces:**
- Consumes: `[data-local-note-list]`, `[data-local-note-card]`, `[data-local-note-editor]`, `[data-local-reading-progress]`
- Produces: `initLocalBookNotes()` and `initLocalReadingProgress()` initialized on `DOMContentLoaded`.

- [ ] **Step 1: Add shared note behavior** for copy, edit-field hydration, removal, and last-card empty state.
- [ ] **Step 2: Add shared progress behavior** using each page's `data-local-book-key`, start percentage, and scroll range.
- [ ] **Step 3: Remove EPUB-only inline implementations** after the shared functions pass the focused test.
- [ ] **Step 4: Run syntax and focused checks**

Run: `node --check prototype/assets/laoji.js && node --test prototype/tests/laoji-local-reader-unification.test.js`

Expected: both commands exit 0.

### Task 4: Full regression verification

**Files:**
- Modify if required by accepted behavior: `prototype/tests/laoji-source-action-popover.test.js`
- Verify: all files under `prototype/tests/`

**Interfaces:**
- Consumes: completed unified local-reader implementation
- Produces: verified prototype with no regressions in links, library, WeRead, notes, or PPT workflow.

- [ ] **Step 1: Run all tests**

Run: `node --test prototype/tests/*.test.js`

Expected: 0 failures.

- [ ] **Step 2: Run static validation**

Run: `node --check prototype/assets/laoji.js && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Review the final diff** to confirm only the two local readers, shared behavior, tests, and these approved documents changed.

