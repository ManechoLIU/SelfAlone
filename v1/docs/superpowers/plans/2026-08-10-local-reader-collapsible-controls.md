# 本地书籍折叠操作栏 Implementation Plan

**Goal:** 让 EPUB 与 PDF 在桌面和移动端都默认收起阅读操作栏，点击正文后按需显示，并统一为轻量胶囊视觉。

**Architecture:** 两个页面使用完全相同的用户控制结构与 `data-local-reader-*` 语义标记，通过各自内部适配将“缩小、标准、放大”映射到 EPUB 字号或 PDF 页面缩放。格式差异只存在于实现层，不进入界面文案、控件顺序或状态表达。样式继续局部放在两个阅读器页面中，避免扩大到无关页面和全局设计令牌。

**Tech Stack:** 静态 HTML、CSS、原生 JavaScript、Node.js 断言测试。

## Global Constraints

- EPUB 与 PDF 对用户统一称为本地书籍，不展示格式差异。
- 两页都只显示目录、缩小、当前显示级别、放大、阅读进度和专注阅读。
- PDF 页码、适合宽度和缩放术语不得出现在操作栏；EPUB 字号术语也不得出现在操作栏。
- 普通阅读与专注阅读的控制层均默认隐藏、点击正文唤起、3 秒自动收起、滚动立即收起。
- 只调整两个本地阅读器及直接相关测试，不修改对话页、书架、设置页或全局设计令牌。
- 保留目录、划线想法、阅读进度和专注全屏能力。
- 不回退用户已有改动，不执行自动提交或工作区清理。

---

### Task 1: 锁定统一显隐与视觉契约

**Files:**
- Modify: `prototype/tests/laoji-local-reader-unification.test.js`
- Modify: `prototype/tests/laoji-compact-settings-and-reader-controls.test.js`
- Modify: `prototype/tests/laoji-pdf-mobile-focus.test.js`

- [ ] 断言两页普通工具栏默认具有隐藏状态，且由 `local-reader-controls-visible` 显式显示。
- [ ] 断言显隐规则不再限制于 `max-width: 760px`，桌面端同样生效。
- [ ] 断言两页均监听正文点击、滚动、选择状态和操作栏焦点。
- [ ] 断言两页使用相同的控件顺序、可访问名称和当前显示级别文案。
- [ ] 断言操作栏不包含页码、适合宽度、缩放或字号等格式专属表达。
- [ ] 断言工具栏为内容自适应的浮层，不再使用横跨正文的常驻色块。
- [ ] 运行定向测试并确认新增断言先失败。

### Task 2: 统一普通阅读操作栏结构与样式

**Files:**
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`

- [ ] 为两页普通操作栏使用一致的目录、缩小、当前显示级别、放大、阅读进度和专注阅读顺序。
- [ ] 将 EPUB 的缩小与放大映射到字号变化，将 PDF 的缩小与放大映射到页面缩放，但保持相同界面反馈。
- [ ] 移除 PDF 操作栏中的页码和适合宽度，统一显示阅读进度百分比。
- [ ] 将普通操作栏改为固定在阅读工作区底部中央的内容自适应浮层。
- [ ] 去掉组内大面积底色，改用轻边框、弱阴影、透明按钮和细分隔。
- [ ] 在移动断点将浮层定位到底部导航上方并处理安全区。
- [ ] 为 `prefers-reduced-motion` 提供无位移动画的显隐规则。

### Task 3: 统一桌面与移动点击唤起逻辑

**Files:**
- Modify: `prototype/laoji-epub-reader.html`
- Modify: `prototype/laoji-pdf-reader.html`

- [ ] 移除普通操作栏显隐逻辑的手机断点限制。
- [ ] 页面初始化时清除 `local-reader-controls-visible`。
- [ ] 点击正文空白区域切换显示状态，并启动 3 秒自动收起计时。
- [ ] 正文滚动时立即收起；选中文字、点击划线、目录或操作栏时不误触发。
- [ ] 操作栏获得焦点时保持显示，焦点离开后恢复自动收起。
- [ ] 保持专注模式现有状态类、目录抽屉和全屏回退逻辑不变。

### Task 4: 回归与视觉校验

**Files:**
- Verify: `prototype/tests/*.test.js`
- Verify: `prototype/laoji-epub-reader.html`
- Verify: `prototype/laoji-pdf-reader.html`

- [ ] 运行 `node prototype/tests/laoji-local-reader-unification.test.js`。
- [ ] 运行 `node prototype/tests/laoji-compact-settings-and-reader-controls.test.js`。
- [ ] 运行 `node prototype/tests/laoji-pdf-mobile-focus.test.js`。
- [ ] 解析两个页面的全部内联脚本，确认 JavaScript 语法通过。
- [ ] 运行全部 `prototype/tests/*.test.js`。
- [ ] 运行 `git diff --check` 检查空白错误。
- [ ] 在桌面和手机宽度下检查：初始隐藏、点击显示、自动隐藏、滚动隐藏、目录和专注模式无回归。
