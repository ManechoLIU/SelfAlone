# 老己移动设置导航系统实施计划

> **执行说明：** 本计划基于已批准的方案 A。实施在当前 Design Files 共享工作区完成；由于 `.git` 在当前运行环境只读且工作区包含用户已有修改，本轮不创建提交，只在每个任务后保留测试与差异检查点。

**目标：** 将个人资料、AI 服务和微信读书从“设置页内部面板 / 桌面卡片缩窄”统一为可扩展的独立设置详情页，消除移动端裁切，并保留现有业务行为与桌面侧栏。

**架构：** `laoji-settings.html` 只承担设置聚合；三个详情页使用 `.settings-detail-page` 与 `data-settings-page` 共享协议。共享 CSS 负责移动视口、顶部返回栏、内容列、安全区、底部主导航隐藏与桌面兼容；共享 JS 只解析安全返回目标与初始化返回链接，业务表单继续由现有模块管理。

**技术栈：** 静态 HTML、共享 CSS、原生 JavaScript、Node.js 断言测试。

---

## 任务 1：先建立独立详情页回归契约

**文件：**

- 修改：`prototype/tests/laoji-mobile-settings-native.test.js`
- 修改：`prototype/tests/laoji-settings-profile-email.test.js`
- 新建：`prototype/tests/laoji-mobile-settings-navigation-system.test.js`

**步骤 1：把旧的内嵌面板断言替换为独立页面断言**

测试应明确要求：

```js
assert.match(settings, /href="laoji-profile-settings\.html"/);
assert.doesNotMatch(settings, /data-mobile-settings-panel="profile"/);
assert.doesNotMatch(script, /function setMobileSettingsView/);
```

**步骤 2：为三页共享协议写失败测试**

```js
for (const [id, html] of Object.entries(details)) {
  assert.match(html, new RegExp(`class="[^"]*settings-detail-page[^"]*"[^>]*data-settings-page="${id}"`));
  assert.match(html, /data-settings-detail-header/);
  assert.match(html, /data-settings-detail-back/);
  assert.match(html, /class="settings-detail-main"/);
}
```

同时覆盖：个人资料 URL、共享安全返回函数、非法目标回退、移动底部导航隐藏、`min-width: 0`、自然滚动、桌面侧栏、禁止整页 `translateX`。

**步骤 3：运行目标测试并确认按预期失败**

```bash
node prototype/tests/laoji-mobile-settings-native.test.js
node prototype/tests/laoji-settings-profile-email.test.js
node prototype/tests/laoji-mobile-settings-navigation-system.test.js
```

预期：仅因新页面、共享契约和安全返回尚未实现而失败。

---

## 任务 2：拆出独立个人资料页并精简设置首页

**文件：**

- 新建：`prototype/laoji-profile-settings.html`
- 修改：`prototype/laoji-settings.html`
- 修改：`prototype/assets/laoji.js`

**步骤 1：把个人资料业务表单迁移到独立页面**

新页面保留同一组业务钩子，避免复制状态：

```html
<body class="settings-detail-page" data-settings-page="profile">
  <div class="app-shell settings-detail-shell">
    <header class="settings-detail-header" data-settings-detail-header>
      <a class="settings-detail-back" href="laoji-settings.html" data-settings-detail-back>设置</a>
      <h1>个人资料</h1>
      <span class="settings-detail-status" data-profile-save-state aria-live="polite"></span>
    </header>
    <main class="settings-detail-main">
      <div class="settings-detail-content">…现有头像、昵称、邮箱表单…</div>
    </main>
  </div>
</body>
```

邮箱两步验证对话框随业务表单迁移到新页面，并保留 `data-change-email-dialog` 等现有钩子。

**步骤 2：设置首页只保留个人资料摘要入口**

```html
<a class="mobile-settings-profile-summary" href="laoji-profile-settings.html">
  …头像、昵称、邮箱摘要…
</a>
```

删除 `data-mobile-settings-panel`、`data-mobile-settings-open/close` 和内嵌表单，但保留服务状态、账户安全与底部一级导航。

**步骤 3：删除旧内嵌面板状态机**

从 `assets/laoji.js` 删除 `setMobileSettingsView` 与 `initMobileSettings`，并保持 `initProfileSettings`、`initEmailChangeDialog` 在新页面继续按 DOM 存在性初始化。

**步骤 4：运行个人资料目标测试**

```bash
node prototype/tests/laoji-mobile-settings-native.test.js
node prototype/tests/laoji-settings-profile-email.test.js
```

预期：个人资料入口、表单、邮箱流程和无内嵌位移全部通过。

---

## 任务 3：建立共享设置详情页壳和安全返回

**文件：**

- 修改：`prototype/assets/laoji.css`
- 修改：`prototype/assets/laoji.js`
- 修改：`prototype/laoji-profile-settings.html`

**步骤 1：增加严格作用域的共享 CSS**

共享规则只以 `.settings-detail-page` 为根：

```css
.settings-detail-page .settings-detail-main,
.settings-detail-page .settings-detail-content,
.settings-detail-page .settings-detail-section { min-width: 0; max-width: 100%; }

@media (max-width: 767px) {
  .settings-detail-page .side-nav,
  .settings-detail-page .topbar,
  .settings-detail-page .bottom-nav { display: none; }
  .settings-detail-page .settings-detail-shell { display: block; min-height: 100dvh; }
  .settings-detail-page .settings-detail-header { position: sticky; top: 0; }
}
```

移动内容采用自然文档流、44px 触控目标、可换行字段、顶部与底部安全区；桌面仍使用侧栏和内容列。不要使用隐藏整页的位移。

**步骤 2：实现允许列表返回解析**

```js
const SETTINGS_RETURN_ALLOWLIST = new Set([
  'laoji-settings.html',
  'laoji-library.html',
  'laoji-chat.html',
  'laoji-ppt-materials.html',
  'laoji-ppt-outline.html',
  'laoji-ppt-preview.html'
]);

function resolveSettingsReturnTarget(value, fallback = 'laoji-settings.html') {
  return SETTINGS_RETURN_ALLOWLIST.has(value || '') ? value : fallback;
}
```

`initSettingsDetailPage()` 将解析后的目标应用到 `[data-settings-detail-back]` 与 `[data-setup-cancel]`，非法、跨域、路径穿越目标回退设置首页。

**步骤 3：运行共享协议测试**

```bash
node prototype/tests/laoji-mobile-settings-navigation-system.test.js
```

预期：个人资料页共享壳与安全返回通过；AI、微信读书仍因尚未迁移而失败。

---

## 任务 4：迁移 AI 与微信读书设置页

**文件：**

- 修改：`prototype/laoji-ai-setup.html`
- 修改：`prototype/laoji-weread-setup.html`
- 修改：`prototype/assets/laoji.css`
- 修改：`prototype/assets/laoji.js`

**步骤 1：统一页面元数据与导航壳**

两页分别声明 `data-settings-page="ai"`、`data-settings-page="weread"`，使用同一顶部返回、标题、状态槽、内容列和桌面设置选中态。

**步骤 2：把桌面卡片缩窄改为移动任务分组**

- 说明、凭证字段、状态和动作分为相邻扁平内容组；
- 手机端主动作占满内容宽度，次级与危险操作分开；
- 已连接、验证中、失效与错误使用稳定状态区，字段内容不因失败被清空；
- 桌面端只重排同一业务表单，不复制表单。

**步骤 3：复用安全返回和现有业务逻辑**

连接成功继续返回安全来源；取消链接与顶部返回一致；保留现有 `data-ai-setup-form`、`data-weread-setup-form` 等业务钩子和恢复路径。

**步骤 4：运行设置详情与连接文案测试**

```bash
node prototype/tests/laoji-mobile-settings-navigation-system.test.js
node prototype/tests/laoji-setup-user-facing-copy.test.js
node prototype/tests/laoji-prototype-links.test.js
node prototype/tests/laoji-preview-scope-navigation.test.js
```

---

## 任务 5：同步体验规范与页面映射

**文件：**

- 修改：`docs/ui/laoji-mvp-ui-design-spec.md`
- 修改：`prototype/README.md`
- 核对：`docs/prd/laoji-mvp-prototype-prd.md`
- 核对：`docs/decisions/`、`docs/architecture/`、术语与项目 README

**步骤 1：同步 UI 体验底线**

记录设置首页聚合、独立详情页、统一返回与安全区、移动端不使用压缩桌面卡片、详情页隐藏一级底栏等体验边界，不冻结具体布局参数。

**步骤 2：更新页面映射**

把 `laoji-profile-settings.html` 加入原型 README，并明确 `laoji-settings.html` 是聚合页。

**步骤 3：完成影响扫描**

PRD 业务能力、ADR 和架构未改变时不编辑，仅在交付说明中记录“无需修改”，避免把实现细节升级为产品行为。

---

## 任务 6：完整验证与视觉检查

**文件：**

- 验证：`prototype/tests/*.test.js`
- 视觉检查：`prototype/laoji-settings.html`
- 视觉检查：`prototype/laoji-profile-settings.html`
- 视觉检查：`prototype/laoji-ai-setup.html`
- 视觉检查：`prototype/laoji-weread-setup.html`

**步骤 1：运行全量自动化测试**

```bash
for f in prototype/tests/*.test.js; do node "$f" || exit 1; done
```

**步骤 2：检查残留旧实现**

```bash
rg -n "data-mobile-settings-panel|setMobileSettingsView|mobile-settings-panel-open|translateX\(100%\)" \
  prototype/laoji-settings.html prototype/laoji-profile-settings.html prototype/assets/laoji.js prototype/assets/laoji.css
```

预期：设置系统内不再存在旧内嵌个人资料面板；其他模块若有独立业务转场不在本轮误删。

**步骤 3：浏览器视觉验证**

依次在 360、390、430、768、1024px 检查：

- 设置首页进入三个详情页；
- 顶部返回与浏览器刷新；
- 个人资料长邮箱、头像操作、邮箱验证；
- AI/微信读书未配置、错误与已连接表现；
- 手机无横向溢出、无截断、滚动到底无遮挡；
- 桌面侧栏、表单与设置选中态无回归。

**步骤 4：复核工作区差异**

只保留本计划列出的文件变化，避免覆盖用户已有文档和原型修改。

---

## 任务 7：修正个人资料编辑与登录邮箱归属

**文件：**

- 修改：`prototype/tests/laoji-settings-profile-email.test.js`
- 修改：`prototype/tests/laoji-mobile-settings-navigation-system.test.js`
- 修改：`prototype/tests/laoji-prototype-links.test.js`
- 修改：`prototype/laoji-profile-settings.html`
- 新建：`prototype/laoji-account-email.html`
- 修改：`prototype/laoji-settings.html`
- 修改：`prototype/assets/laoji.js`
- 修改：`prototype/assets/laoji.css`

**步骤 1：先建立失败契约**

测试必须明确要求：个人资料页不包含登录邮箱；设置首页“账户与安全”提供 `laoji-account-email.html` 入口；邮箱详情页继续承载两步验证；头像本身拥有 `data-avatar-trigger`；页面不再出现“选择图片”和格式常驻说明；昵称表单拥有 `data-profile-name-save`，脚本不再监听昵称 `blur` 自动保存。

**步骤 2：运行目标测试并确认失败原因**

```bash
node prototype/tests/laoji-settings-profile-email.test.js
node prototype/tests/laoji-mobile-settings-navigation-system.test.js
node prototype/tests/laoji-prototype-links.test.js
```

预期：因邮箱尚未迁移、头像入口仍是按钮组、昵称仍为失焦保存以及第 16 个页面尚不存在而失败。

**步骤 3：实现最小页面与交互变更**

- 个人资料页将头像包裹为可聚焦的圆形按钮，使用正式相机 SVG 角标；保留隐藏文件输入、恢复默认和就地错误。
- 昵称增加显式保存按钮；输入变化产生 `dirty` 状态，保存成功后禁用按钮，失败保留输入并聚焦字段。
- 设置首页个人摘要的第二行改为“头像与昵称”；“账户与安全”增加显示当前邮箱的独立入口。
- 新建共享壳协议的 `account-email` 页面，把现有邮箱摘要和两步验证任务完整迁入；不复制邮箱状态逻辑。

**步骤 4：运行目标与完整回归**

```bash
node prototype/tests/laoji-settings-profile-email.test.js
node prototype/tests/laoji-mobile-settings-navigation-system.test.js
node prototype/tests/laoji-prototype-links.test.js
for f in prototype/tests/*.test.js; do node "$f" || exit 1; done
```

预期：个人资料编辑、邮箱信息架构、共享壳、第 16 个页面及所有既有原型契约通过。
