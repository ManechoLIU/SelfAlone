# Mobile Settings Native Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将老己设置页的移动端从桌面表单单列堆叠改为“摘要首页 + 全屏个人资料编辑层”，同时保留现有功能与桌面布局。

**Architecture:** `laoji-settings.html` 继续作为唯一设置首页。移动端增加账户摘要入口并复用现有个人资料 DOM 作为全屏层；`setMobileSettingsView(shell, nextView)` 管理视图、滚动、焦点和 Escape 返回。桌面端通过媒体查询保持现有结构。

**Tech Stack:** 语义化 HTML、现有 CSS tokens、原生 JavaScript、Node.js 静态回归测试。

## Global Constraints

- 只修改设置页、设置页专属样式/交互和对应测试。
- 保留头像、昵称、邮箱验证、服务入口和账户操作的现有 data attributes。
- 不新增依赖，不使用 CSS 线框占位图标，不调用图片生成。
- 360、390、430px 不得产生页面级横向滚动，触控目标至少 44px。
- 768px 及以上桌面结构不得退化。
- 当前工作区包含用户现有改动，本计划不自动执行 Git 提交。

---

### Task 1: 建立移动设置结构回归测试

**Files:**
- Create: `prototype/tests/laoji-mobile-settings-native.test.js`
- Test: `prototype/tests/laoji-settings-profile-email.test.js`

**Interfaces:**
- Consumes: 当前 `laoji-settings.html`、`assets/laoji.css`、`assets/laoji.js`
- Produces: 对 `data-mobile-settings-summary`、`data-mobile-settings-panel="profile"`、`data-mobile-settings-view` 和 `setMobileSettingsView(shell, nextView)` 的回归契约

- [x] **Step 1: Write the failing test**

创建 Node assert 测试，验证：首页账户摘要、全屏资料层、返回入口、危险操作分离、移动 overflow 约束、背景滚动锁定、Escape 返回和桌面资料结构仍存在。

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/laoji-mobile-settings-native.test.js`  
Expected: FAIL，首个缺失项为 `data-mobile-settings-summary`。

- [x] **Step 3: Keep the test focused**

测试只验证结构与状态契约，不复写头像文件读取或邮箱验证码逻辑；这些继续由现有测试覆盖。

### Task 2: 重组设置页移动语义结构

**Files:**
- Modify: `prototype/laoji-settings.html`
- Test: `prototype/tests/laoji-mobile-settings-native.test.js`

**Interfaces:**
- Consumes: `data-user-avatar`、`data-user-name`、`data-profile-email-value`、`data-profile-form`
- Produces: `data-mobile-settings-shell`、`data-mobile-settings-summary`、`data-mobile-settings-panel="profile"`、`data-mobile-settings-open="profile"`、`data-mobile-settings-close`

- [x] **Step 1: Add the mobile account summary**

在设置首页内容开头增加按钮式账户摘要，内部复用用户头像、昵称与邮箱同步标记；桌面端隐藏。

- [x] **Step 2: Mark the existing profile section as the full-screen panel**

为现有个人资料 section 增加移动面板标记和移动专用返回顶栏，不复制表单和输入控件。

- [x] **Step 3: Separate destructive action semantics**

为删除账户行增加 `settings-danger-row`，移动样式中与普通账户操作形成独立边界；保留原对话框触发器。

- [x] **Step 4: Run structural tests**

Run: `node prototype/tests/laoji-mobile-settings-native.test.js`  
Expected: HTML 结构断言通过，CSS/JS 断言仍失败。

### Task 3: 实现移动设置视图状态

**Files:**
- Modify: `prototype/assets/laoji.js`
- Test: `prototype/tests/laoji-mobile-settings-native.test.js`

**Interfaces:**
- Consumes: `data-mobile-settings-shell`、`data-mobile-settings-open`、`data-mobile-settings-close`
- Produces: `setMobileSettingsView(shell, nextView)`，其中 `nextView` 为 `home | profile`

- [x] **Step 1: Add the shared state function**

进入 profile 前保存 `window.scrollY`；更新根节点 `data-mobile-settings-view`；通过 `mobile-settings-panel-open` 锁定 body；同步入口 `aria-expanded`。

- [x] **Step 2: Bind open, close, Escape and focus restoration**

打开后聚焦返回按钮；关闭后恢复滚动位置并把焦点交还账户摘要。仅当视图为 profile 时拦截 Escape。

- [x] **Step 3: Keep summary data synchronized**

账户摘要使用现有 `data-user-*` 和 `data-profile-email-value` 批量同步机制；将资料初始化从单个邮箱节点改为所有邮箱节点。

- [x] **Step 4: Run JavaScript and regression tests**

Run: `node --check prototype/assets/laoji.js && node prototype/tests/laoji-mobile-settings-native.test.js && node prototype/tests/laoji-settings-profile-email.test.js`  
Expected: PASS。

### Task 4: 建立移动端专属视觉系统

**Files:**
- Modify: `prototype/laoji-settings.html`（页面内设置专属样式）
- Test: `prototype/tests/laoji-mobile-settings-native.test.js`

**Interfaces:**
- Consumes: 现有 `--bg`、`--surface`、`--white`、`--border`、`--accent`、`--danger` tokens
- Produces: 64px 移动顶栏、账户摘要、原生分组列表、全屏资料层和危险操作分离样式

- [x] **Step 1: Style the mobile home**

在 `max-width: 767px` 中隐藏桌面资料 section 的页面占位，只展示账户摘要、服务列表和账户列表；统一 16px 页面边距、24px 组距、56px 行高。

- [x] **Step 2: Style the profile panel**

个人资料 section 使用 `position: fixed; inset: 0; z-index: 60`，形成独立滚动层；打开时横向进入，关闭时退出；顶部返回栏固定，内容不使用嵌套卡片。

- [x] **Step 3: Preserve desktop styles**

所有新视觉规则限定在设置页作用域和移动媒体查询内；桌面账户摘要、移动顶栏和返回按钮保持隐藏。

- [x] **Step 4: Add reduced motion and width guards**

为设置根、摘要、列表、面板和表单添加 `min-width: 0` / `max-width: 100%`；减少动态偏好下取消位移。

- [x] **Step 5: Run focused tests**

Run: `node prototype/tests/laoji-mobile-settings-native.test.js`  
Expected: PASS。

### Task 5: 全量验证

**Files:**
- Verify: `prototype/laoji-settings.html`
- Verify: `prototype/assets/laoji.css`
- Verify: `prototype/assets/laoji.js`
- Verify: `prototype/tests/*.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 outputs
- Produces: 可交付的移动设置页

- [x] **Step 1: Run all prototype tests**

Run: `for test in prototype/tests/*.test.js; do node "$test" || exit 1; done`  
Expected: 所有测试退出码为 0。

- [x] **Step 2: Verify syntax and residual desktop stacking**

Run: `node --check prototype/assets/laoji.js`，并搜索手机首页是否仍直接暴露头像上传、昵称输入和邮箱修改按钮。

- [x] **Step 3: Review requirements line by line**

核对设计规范第 7 节七项验收标准；任何未满足项都在本任务内修正并重新运行全量测试。
