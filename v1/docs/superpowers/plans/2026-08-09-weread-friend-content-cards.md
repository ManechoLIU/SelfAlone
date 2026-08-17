# 微信读书书友内容卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把微信读书详情中的书友内容拆成清晰的热门划线与书友评价卡片，并删除面向实现的说明文字。

**Architecture:** 只改 `public-panel` 的 HTML 内容结构，并在现有共享样式表中增加该区域专用类。保留现有标签切换、复制和写笔记交互，不改变其他书籍详情页面。

**Tech Stack:** 静态 HTML、CSS、Node.js 断言测试

## Global Constraints

- 沿用现有青瓷色彩、字体和基础卡片组件，不引入新颜色或依赖。
- 热门划线显示原文与划线人数；书友评价显示头像、昵称、评分、正文、点赞数和日期。
- 删除“同步上限”“各最多 20 条”和“默认不会用于 PPT”说明。
- 桌面和手机均保持单列阅读，不增加横向滚动。
- 不修改 PDF、EPUB、PPT 或其他标签页内容。

---

### Task 1: 书友内容结构与视觉

**Files:**
- Create: `prototype/tests/laoji-weread-friend-content.test.js`
- Modify: `prototype/laoji-wechat-book.html`
- Modify: `prototype/assets/laoji.css`

**Interfaces:**
- Consumes: `#public-panel`、`.content-list`、`.source-card`、`.source-tools` 和现有青瓷设计变量。
- Produces: `[data-od-id="friend-highlights-section"]` 与 `[data-od-id="friend-reviews-section"]` 两个可检查内容区。

- [x] **Step 1: 写失败测试**

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('prototype/laoji-wechat-book.html', 'utf8');
const publicPanel = html.match(/<div id="public-panel"[\s\S]*?<div id="notes-panel"/)[0];
assert.match(publicPanel, /data-od-id="friend-highlights-section"/);
assert.match(publicPanel, /data-od-id="friend-reviews-section"/);
assert.doesNotMatch(publicPanel, /同步上限|各最多 20 条|默认不会用于 PPT/);
```

- [x] **Step 2: 运行测试并确认因缺少新结构而失败**

Run: `node prototype/tests/laoji-weread-friend-content.test.js`

Expected: FAIL，提示缺少 `friend-highlights-section`。

- [x] **Step 3: 实现最小 HTML 结构**

```html
<section class="friend-content-section" data-od-id="friend-highlights-section">
  <h2>热门划线 <span>20</span></h2>
  <article class="card friend-highlight-card"><blockquote>划线原文</blockquote><span>285 人划线</span></article>
</section>
<section class="friend-content-section" data-od-id="friend-reviews-section">
  <h2>书友评价 <span>20</span></h2>
  <article class="card friend-review-card"><strong>书友昵称</strong><p>评价正文</p></article>
</section>
```

- [x] **Step 4: 添加区域专用响应式样式**

```css
.friend-content-section { display: grid; gap: 12px; }
.friend-content-heading { display: flex; align-items: baseline; gap: 8px; }
.friend-review-head, .friend-review-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
```

- [x] **Step 5: 运行目标测试和全部原型测试**

Run: `node prototype/tests/laoji-weread-friend-content.test.js && for test_file in prototype/tests/*.test.js; do node "$test_file"; done`

Expected: 全部退出码为 0，无失败和警告。
