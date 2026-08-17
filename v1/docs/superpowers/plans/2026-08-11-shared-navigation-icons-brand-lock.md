# 老己共享导航图标与品牌尺寸锁定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地方案 A 的三枚本地 SVG 主导航图标，并统一所有共享侧栏页面的品牌、侧栏和导航项目尺寸，消除模块切换时的缩放与位移。

**Architecture:** 三枚单色 SVG 放入 `prototype/assets/icons/`，共享 CSS 使用 `mask-image` 和 `currentColor` 同时驱动桌面 `.nav-dot` 与移动 `.bottom-link::before`。品牌尺寸和侧栏节奏只在共享 CSS 定义，删除对话页与书架页的尺寸覆盖，不修改任何页面路由或业务脚本。

**Tech Stack:** 原生 SVG、CSS mask、HTML、Node.js `assert` 静态回归测试。

## Global Constraints

- 设计来源：`docs/superpowers/specs/2026-08-11-shared-navigation-icons-brand-lock-design.md`。
- 方案必须采用 A：24×24 SVG 网格，桌面 20px、移动 19px、视觉线宽约 1.75px。
- ≥1200px 侧栏 188px；768–1199px 侧栏 168px；≤767px 隐藏桌面侧栏。
- Logo 38px、“老己”25px、品牌区 62px；页面级样式不得再次覆盖这些尺寸。
- 不修改导航链接、页面内容、业务状态或设计令牌。
- 当前态只改变颜色与背景，不改变图标尺寸或位置。

---

### Task 1: 建立共享导航图标与品牌锁定回归测试

**Files:**
- Create: `prototype/tests/laoji-navigation-icons-brand-lock.test.js`
- Modify: `prototype/tests/laoji-premium-sidebar-responsive.test.js:21-28`
- Reference: `prototype/assets/laoji.css`
- Reference: `prototype/laoji-library.html:10-24`

**Interfaces:**
- 测试读取 `assets/laoji.css`、`laoji-library.html` 和三个 SVG 文件。
- 资产名固定为 `nav-chat.svg`、`nav-library.svg`、`nav-settings.svg`。

- [ ] **Step 1: 写缺失资产与共享尺寸的失败测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.css'), 'utf8');
const library = fs.readFileSync(path.join(prototypeDir, 'laoji-library.html'), 'utf8');
const iconDir = path.join(prototypeDir, 'assets', 'icons');

for (const name of ['nav-chat.svg', 'nav-library.svg', 'nav-settings.svg']) {
  assert.ok(fs.existsSync(path.join(iconDir, name)), `${name} 应存在`);
  const svg = fs.readFileSync(path.join(iconDir, name), 'utf8');
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(svg.replaceAll('#000', ''), /#[0-9a-f]{3,8}|rgb\(/i, `${name} 不应写死界面颜色`);
}

assert.match(css, /--sidebar:\s*188px/);
assert.match(css, /\.user-avatar\s*\{[^}]*width:\s*38px[^}]*height:\s*38px[^}]*flex:\s*0 0 38px/s);
assert.match(css, /\.brand-name\s*\{[^}]*25px\/1 var\(--brand\)/s);
assert.match(css, /\.nav-dot\s*\{[^}]*mask[^}]*nav-/s);
assert.match(css, /\.bottom-link::before\s*\{[^}]*mask/s);
assert.doesNotMatch(css, /\.chat-page\s*\{[^}]*--sidebar:\s*188px/s);
assert.doesNotMatch(library, /\.library-page \.brand-name|\.library-page \.brand-lockup \.user-avatar/);

console.log('laoji-navigation-icons-brand-lock: all tests passed');
```

- [ ] **Step 2: 更新旧测试的临时图标断言**

把 `laoji-premium-sidebar-responsive.test.js` 中“`.nav-dot` 必须 `display:none`”的断言替换为：

```js
assert.match(css, /\.nav-dot\s*\{[^}]*display:\s*block[^}]*mask/s, '桌面共享导航必须显示正式 SVG mask 图标');
assert.doesNotMatch(css, /\.bottom-link\[href\$="laoji-(?:chat|library|settings)\.html"\]::before\s*\{[^}]*border:/s, '手机底栏不得继续使用 CSS 边框拼图');
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node prototype/tests/laoji-navigation-icons-brand-lock.test.js`

Expected: FAIL，首先报告 `nav-chat.svg 应存在`。

- [ ] **Step 4: 提交测试基线**

```bash
git add prototype/tests/laoji-navigation-icons-brand-lock.test.js prototype/tests/laoji-premium-sidebar-responsive.test.js
git commit -m "test: define shared navigation icon contract"
```

---

### Task 2: 创建方案 A 的三个本地 SVG 资产

**Files:**
- Create: `prototype/assets/icons/nav-chat.svg`
- Create: `prototype/assets/icons/nav-library.svg`
- Create: `prototype/assets/icons/nav-settings.svg`
- Test: `prototype/tests/laoji-navigation-icons-brand-lock.test.js`

**Interfaces:**
- 每个文件使用 `viewBox="0 0 24 24"`。
- 几何使用黑色描边供 CSS mask 读取；不包含界面色、滤镜、阴影或文字。

- [ ] **Step 1: 创建对话图标**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7.1 5.4h9.8A3.6 3.6 0 0 1 20.5 9v5.8a3.6 3.6 0 0 1-3.6 3.6H11l-3.8 2.2.7-2.2h-.8a3.6 3.6 0 0 1-3.6-3.6V9a3.6 3.6 0 0 1 3.6-3.6Z"/>
  <circle cx="9" cy="12" r=".8" fill="#000" stroke="none"/>
  <circle cx="15" cy="12" r=".8" fill="#000" stroke="none"/>
</svg>
```

- [ ] **Step 2: 创建读书图标**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.8 5.5c2.7-.7 5.3-.2 8.2 1.8v12c-2.9-2-5.5-2.5-8.2-1.8v-12Z"/>
  <path d="M20.2 5.5c-2.7-.7-5.3-.2-8.2 1.8v12c2.9-2 5.5-2.5 8.2-1.8v-12Z"/>
</svg>
```

- [ ] **Step 3: 创建设置图标**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9.6 3.7h4.8l.7 2.2 2 .9 2.1-1 2.4 4.1-1.7 1.5v2.2l1.7 1.5-2.4 4.1-2.1-1-2 .9-.7 2.2H9.6l-.7-2.2-2-.9-2.1 1-2.4-4.1 1.7-1.5v-2.2L2.4 9.9l2.4-4.1 2.1 1 2-.9.7-2.2Z"/>
  <circle cx="12" cy="12.5" r="3"/>
</svg>
```

- [ ] **Step 4: 运行资产部分测试**

Run: `node prototype/tests/laoji-navigation-icons-brand-lock.test.js`

Expected: SVG 存在和 viewBox 断言 PASS；共享 CSS 尺寸或 mask 断言仍 FAIL。

- [ ] **Step 5: 提交图标资产**

```bash
git add prototype/assets/icons prototype/tests/laoji-navigation-icons-brand-lock.test.js
git commit -m "feat: add Image2-aligned navigation icons"
```

---

### Task 3: 共享桌面与移动导航使用正式 SVG

**Files:**
- Modify: `prototype/assets/laoji.css:106-115`
- Modify: `prototype/assets/laoji.css:704-710`
- Modify: `prototype/assets/laoji.css:916-918`
- Modify: `prototype/laoji-library.html:20-23`
- Test: `prototype/tests/laoji-navigation-icons-brand-lock.test.js`

**Interfaces:**
- `.nav-dot` 和 `.bottom-link::before` 通过 `--nav-icon` 复用相同资产。
- URL 相对 `prototype/assets/laoji.css`，使用 `icons/nav-*.svg`。

- [ ] **Step 1: 给三个导航目标分配资产变量**

```css
.nav-link[href$="laoji-chat.html"], .bottom-link[href$="laoji-chat.html"] { --nav-icon: url("icons/nav-chat.svg"); }
.nav-link[href$="laoji-library.html"], .bottom-link[href$="laoji-library.html"] { --nav-icon: url("icons/nav-library.svg"); }
.nav-link[href$="laoji-settings.html"], .bottom-link[href$="laoji-settings.html"] { --nav-icon: url("icons/nav-settings.svg"); }
```

- [ ] **Step 2: 把 `.nav-dot` 改为 SVG mask**

```css
.nav-dot {
  display: block;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  background-color: currentColor;
  -webkit-mask: var(--nav-icon) center / contain no-repeat;
  mask: var(--nav-icon) center / contain no-repeat;
}
.nav-link[aria-current="page"] .nav-dot { background-color: currentColor; }
```

- [ ] **Step 3: 把移动底栏伪元素改为同一 mask**

```css
@media (max-width: 767px) {
  .bottom-link { grid-template-rows: 20px 16px; }
  .bottom-link::before {
    content: "";
    width: 19px;
    height: 19px;
    background-color: currentColor;
    -webkit-mask: var(--nav-icon) center / contain no-repeat;
    mask: var(--nav-icon) center / contain no-repeat;
  }
}
```

- [ ] **Step 4: 删除旧临时图形规则**

删除以下规则，不添加替代边框：

- `.bottom-link[href$="laoji-chat.html"]::before/::after` 的气泡边框。
- `.bottom-link[href$="laoji-library.html"]::before` 的书本边框。
- `.bottom-link[href$="laoji-settings.html"]::before` 的圆环。
- `.chat-page .nav-dot`、library 内联 `.nav-dot` 的圆角和 inset shadow 拼图。

- [ ] **Step 5: 运行图标测试**

Run: `node prototype/tests/laoji-navigation-icons-brand-lock.test.js && node prototype/tests/laoji-premium-sidebar-responsive.test.js`

Expected: 图标资产和 mask 断言 PASS；品牌尺寸断言可能仍 FAIL。

- [ ] **Step 6: 提交共享图标实现**

```bash
git add prototype/assets/laoji.css prototype/laoji-library.html prototype/tests/laoji-navigation-icons-brand-lock.test.js prototype/tests/laoji-premium-sidebar-responsive.test.js
git commit -m "feat: use shared svg navigation icons"
```

---

### Task 4: 锁定共享品牌与侧栏尺寸

**Files:**
- Modify: `prototype/assets/laoji.css:1-115`
- Modify: `prototype/assets/laoji.css:530-540`
- Modify: `prototype/assets/laoji.css:847-918`
- Modify: `prototype/laoji-library.html:12-21`
- Test: `prototype/tests/laoji-navigation-icons-brand-lock.test.js`

**Interfaces:**
- 标准桌面由 `:root --sidebar:188px` 驱动。
- `@media (min-width:768px) and (max-width:1199px)` 覆盖为 168px。
- 所有页面使用同一 `.side-nav`、`.brand-lockup`、`.user-avatar`、`.brand-name`、`.nav-list`、`.nav-link` 尺寸。

- [ ] **Step 1: 把共享标准尺寸写入基础规则**

```css
:root { --sidebar: 188px; }
.side-nav { padding: 26px 14px 22px; }
.brand-lockup { gap: 12px; min-height: 62px; padding: 0 8px 24px; }
.user-avatar { width: 38px; height: 38px; flex: 0 0 38px; }
.brand-name { font: 500 25px/1 var(--brand); letter-spacing: .06em; }
.nav-list { gap: 6px; margin-top: 24px; }
.nav-link { min-height: 48px; gap: 13px; padding: 0 13px; border-radius: 9px; }
```

- [ ] **Step 2: 保留唯一紧凑桌面覆盖**

```css
@media (min-width: 768px) and (max-width: 1199px) {
  :root { --sidebar: 168px; }
}
```

删除 `@media (min-width:1200px) and (max-width:1439px)` 中的 `--sidebar:168px`，使所有 ≥1200px 页面保持 188px。

- [ ] **Step 3: 删除页面级尺寸覆盖**

从共享 CSS 删除 `.chat-page { --sidebar:188px; }` 以及 `.chat-page` 对侧栏宽度、品牌区、头像、品牌字、导航列表和导航项目的重复尺寸声明；保留对话页特有的颜色、内容布局和消息样式。

从 `laoji-library.html` 的内联样式删除 `.library-page { --sidebar:188px; }` 以及对侧栏宽度、品牌区、头像、品牌字、导航列表和导航项目的重复尺寸声明；保留书架内容布局和书封样式。

- [ ] **Step 4: 运行品牌锁定测试**

Run: `node prototype/tests/laoji-navigation-icons-brand-lock.test.js && node prototype/tests/laoji-premium-sidebar-responsive.test.js`

Expected: PASS。

- [ ] **Step 5: 提交品牌尺寸锁定**

```bash
git add prototype/assets/laoji.css prototype/laoji-library.html prototype/tests/laoji-navigation-icons-brand-lock.test.js
git commit -m "fix: lock shared navigation brand dimensions"
```

---

### Task 5: 完成跨模块与响应式验收

**Files:**
- Verify: `prototype/assets/icons/*.svg`
- Verify: `prototype/assets/laoji.css`
- Verify: `prototype/laoji-chat.html`
- Verify: `prototype/laoji-library.html`
- Verify: `prototype/laoji-settings.html`
- Verify: `prototype/laoji-wechat-book.html`
- Verify: `prototype/laoji-epub-reader.html`
- Verify: `prototype/laoji-pdf-reader.html`
- Verify: `prototype/laoji-ppt-*.html`
- Verify: `prototype/laoji-*-setup.html`
- Verify: `prototype/tests/*.test.js`

**Interfaces:**
- 视口：360、390、430、768、1024、1366px。
- 主切换：对话 → 读书 → 设置 → 对话。

- [ ] **Step 1: 运行导航专项测试**

Run: `node prototype/tests/laoji-navigation-icons-brand-lock.test.js && node prototype/tests/laoji-premium-sidebar-responsive.test.js`

Expected: 两个测试均输出 `all tests passed`。

- [ ] **Step 2: 运行全部原型回归测试**

Run: `for test_file in prototype/tests/*.test.js; do node "$test_file" || exit 1; done`

Expected: 全部 PASS。

- [ ] **Step 3: 做残留规则扫描**

Run: `rg -n "\.chat-page .*brand-(?:lockup|name)|\.library-page .*brand-(?:lockup|name)|\.library-page .*user-avatar|bottom-link\[href\$=.*::before.*border|nav-dot.*box-shadow|--sidebar:\s*176px" prototype/assets/laoji.css prototype/laoji-library.html`

Expected: 无命中。

- [ ] **Step 4: 检查桌面模块切换**

在 1366px 依次打开对话、读书、设置，确认：侧栏左边界与右边界不动；头像保持 38px；“老己”保持 25px；三个图标保持 20px；当前态切换不缩放。

- [ ] **Step 5: 检查紧凑桌面与移动端**

在 768/1024px 确认侧栏为 168px且品牌内容不缩放；在 360/390/430px 确认桌面侧栏隐藏、底栏三枚图标均为 19px、无页面横向滚动。

- [ ] **Step 6: 最终差异检查**

Run: `git diff --check && git diff -- prototype/assets/icons prototype/assets/laoji.css prototype/laoji-library.html prototype/tests/laoji-navigation-icons-brand-lock.test.js prototype/tests/laoji-premium-sidebar-responsive.test.js`

Expected: 改动只涉及共享导航图标、品牌尺寸和对应测试。

- [ ] **Step 7: 提交验收收口**

```bash
git add prototype/assets/icons prototype/assets/laoji.css prototype/laoji-library.html prototype/tests/laoji-navigation-icons-brand-lock.test.js prototype/tests/laoji-premium-sidebar-responsive.test.js
git commit -m "test: validate shared navigation consistency"
```
