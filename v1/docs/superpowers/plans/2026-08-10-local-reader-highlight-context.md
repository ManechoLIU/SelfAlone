# 本地书籍划线上下文侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EPUB 与 PDF 共用“点击划线后查看该划线全部想法”的本地书籍阅读交互。

**Architecture:** 两个示例页面使用相同的 `data-local-reader-*` 标记和相同侧栏结构，`prototype/assets/laoji.js` 提供一次共享初始化。桌面端侧栏默认不占宽度，打开后成为第三列；中屏使用右侧抽屉，手机使用底部抽屉。

**Tech Stack:** 静态 HTML、CSS、原生 JavaScript、Node.js 断言测试。

## Global Constraints

- EPUB 与 PDF 都是“本地导入书籍”，不得向用户展示文件类型差异。
- 两页的书籍详情结构、划线交互、笔记侧栏和响应式行为必须一致。
- 一条划线允许关联多条老己想法；取消划线不得自动删除想法。
- 不修改无关页面、全局设计令牌或现有书籍摘要结构。
- 当前共享工作区含用户改动，不执行自动提交或清理。

---

### Task 1: 锁定统一交互契约

**Files:**
- Modify: `prototype/tests/laoji-local-reader-unification.test.js`

**Interfaces:**
- Consumes: 两个本地书籍页面与 `prototype/assets/laoji.js`
- Produces: `data-local-reader-highlight`、`data-local-reader-context-panel`、`initLocalReaderHighlightContext()` 的共同契约

- [x] **Step 1: 写入失败断言**

  ```js
  assert.match(html, /data-local-reader-highlight/, `${name} 应提供可激活划线`);
  assert.match(html, /data-local-reader-context-panel[^>]*hidden/, `${name} 的上下文侧栏应默认收起`);
  assert.match(html, /data-local-reader-context-note-list/, `${name} 应显示当前划线的全部想法`);
  assert.match(html, /data-local-reader-context-add/, `${name} 应允许继续添加想法`);
  assert.match(js, /function initLocalReaderHighlightContext\(\)/, '本地书应使用共享划线上下文交互');
  ```

- [x] **Step 2: 验证红灯**

  Run: `node prototype/tests/laoji-local-reader-unification.test.js`

  Expected: FAIL，原因是上下文侧栏或共享初始化函数尚不存在。

### Task 2: 实现共用侧栏和数据切换

**Files:**
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`
- Modify: `prototype/assets/laoji.js`
- Modify: `docs/superpowers/specs/2026-08-09-local-book-detail-unification.md`

**Interfaces:**
- Consumes: `data-local-reader-highlight-quote` 和 `data-local-reader-highlight-notes` 字符串数据
- Produces: `initLocalReaderHighlightContext()`，负责打开、切换、关闭、Esc 与键盘激活

- [x] **Step 1: 同步页面结构**

  两页为每条示例划线添加一致的数据属性，并以同构的 `aside[data-local-reader-context-panel]` 替换常驻文本框。

- [x] **Step 2: 添加共享逻辑**

  在 `laoji.js` 中解析划线数据，生成全部想法，维护 `aria-expanded`、焦点和打开状态；空白点击与关闭按钮收起侧栏。

- [x] **Step 3: 添加响应式样式**

  桌面默认两列、打开后第三列；中屏为右侧抽屉；手机为底部抽屉。保留现有青瓷配色、字体和低动效偏好。

- [x] **Step 4: 固化产品规则**

  在本地书籍统一规范中明确 EPUB/PDF 不作为用户可见类型，后续不得再次分别设计。

- [x] **Step 5: 验证绿灯**

  Run: `node prototype/tests/laoji-local-reader-unification.test.js`

  Expected: PASS。

### Task 3: 回归验证

**Files:**
- Verify: `prototype/tests/*.test.js`

**Interfaces:**
- Consumes: 完整原型测试集与两个页面内联脚本
- Produces: 可复验的通过结果

- [x] **Step 1: 定向验证**

  Run: `node prototype/tests/laoji-local-reader-unification.test.js && node prototype/tests/laoji-pdf-mobile-focus.test.js`

- [x] **Step 2: 全量验证**

  Run: `node --test prototype/tests/*.test.js`

- [x] **Step 3: 语法与空白检查**

  Run: `node -e 'const fs=require("fs"); for (const f of ["prototype/laoji-epub-reader.html","prototype/laoji-pdf-reader.html"]) [...fs.readFileSync(f,"utf8").matchAll(/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi)].forEach(m=>new Function(m[1]))'`

  Run: `git diff --check`
