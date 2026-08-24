# M1-F2-B EPUB/TXT 文本阅读验收收据

基线：`main@44b81ea`；范围分支：`codex/m1-f2-b`。本目录只保存该工作包的真实 Case 启动入口、浏览器截图与集成接缝，不替代 SPEC、DESIGN、TECHNICAL 或任务台账。

## 真实 Case

- `acceptance-server.ts` 在隔离 PostgreSQL schema 和临时对象目录中，经现有书库导入链路写入一个真实 EPUB ZIP 与一个真实 UTF-8 TXT，再调用文本发布模块生成正文。
- EPUB 的 spine 顺序为 `epub:one`（雨停以后）→ `epub:two`（山路尽头）；TXT 的源偏移顺序为 `txt:00000000`（序章）→ `txt:00000013`（第一章 风从海上来）→ `txt:00000500`（第二章 靠岸以后）。
- 浏览器在 TXT 末章保存 `TextLocator={kind:"text",fileVersion:1,sectionId:"txt:00000500",offset:0}` 与深色背景；刷新后 `/reading` 返回同一定位，刷新前后首个活动章节均为 `txt:00000500`，截图 11 为恢复结果。
- 服务集成测试另行用两账户、两个真实文件证明 owner 隔离；旧文件版本写入返回 `409 STALE_VERSION`，并证明数据库中的先前定位不被覆盖。
- 保存失败 Case 让背景变更写入持续失败到用户重试；截图 07 与浏览器 DOM 同时证明正文、当前章节、当前浅色背景和重试入口仍保留；点击“重试保存”后变为“阅读位置已保存”。

## 真实 Chrome 证据

浏览器为已连接的真实 Chrome；主基准是未设 viewport override 的原生 `1440×844`、`devicePixelRatio=2`，截图文件也均按实际像素核验。1200、1024、768 是 Chrome 的响应式 viewport override，仅用于断点验证，完成后已 reset 回原生 1440×844，不冒充原生窗口尺寸。

| 文件 | 证据 |
| --- | --- |
| `01-epub-light-native-1440x844.png` | EPUB 浅色正文 `#FAFBF8` 与浅色左栏 `#E7EAE8` |
| `02-epub-dark-native-1440x844.png` | EPUB 深色正文 `#171B1A` 与深色左栏 `#202624` |
| `03-trusted-cache-first-frame-native-1440x844.png` | API 延迟 2 秒时，可信深色缓存首帧直接显示整栏和深色 loading，无默认闪回 |
| `04-epub-normal-native-1440x844.png` | EPUB 连续正文和第二节正常态 |
| `05-txt-deduplicated-native-1440x844.png` | 真实 TXT 的三节顺序，章节标题首行不在正文重复 |
| `06-directory-filtered-empty-native-1440x844.png` | 非 modal、无遮罩目录与筛选空 |
| `07-save-failure-retained-native-1440x844.png` | 保存失败保留正文与当前背景，并显示刷新风险和重试 |
| `08-true-empty-native-1440x844.png` | 真空态与禁用阅读工具 |
| `09-load-failure-native-1440x844.png` | 失败态、非颜色提示、重新载入与禁用阅读工具 |
| `10-txt-responsive-768x844.png` | 768×844 响应式断点，80px 私有左栏与无横向溢出 |
| `11-refresh-restored-txt-dark-native-1440x844.png` | TXT 末章与深色背景刷新恢复 |

真实浏览器额外检查：

- 无缓存首帧、跨账户缓存、跨 `fileVersion` 缓存和存储拒绝首帧均 fail closed 为浅色，左栏 `opacity=1`；仅 `accountId+bookId+fileVersion` 全匹配的缓存首帧使用深色。
- 浏览器以 `account-a` 请求 `account-b` 的真实私有 TXT 时得到失败态，私有正文“不可跨账户读取。”未进入 DOM，全部阅读工具禁用。
- 主题与专注在 TXT 第 2 段、第 6 段和末段分别保持 `scrollTop=520`、`1030`、`2005`；末段切换前后均在 viewport 内。鼠标与键盘路径都把焦点恢复到“切换阅读背景”或“进入/退出专注阅读”。
- 目录打开后焦点为 `#text-reader-directory-query`；Escape 关闭后回到“打开目录”，关闭态没有悬空 `aria-controls`。目录为 `aria-modal=false` 且无阻断 scrim。
- TXT 章节 ID 顺序为 `txt:00000000`、`txt:00000013`、`txt:00000500`；首个正文局部源偏移为 3、10、9，章节标题未重复渲染，源定位未改写。
- 选择正文后复制按钮和“和老己聊聊”同时可用；成功时系统剪贴板与 `aria-live` 都为“灯塔在傍晚亮起。”；拒绝时选区、按钮、对话入口均保留，`aria-live` 为“复制失败，选区已保留，请重试。”，控制台没有未处理拒绝。
- 保存失败时浅色画面与 2 节正文保留，工具仍可用；文案明确“刷新后可能恢复上次选择”，手动重试后变回“阅读位置已保存”。
- 深色正文主文字、次文字、左栏主文字、次文字、active 对比分别为 15.35:1、9.57:1、13.6:1、8.48:1、10.81:1。
- `prefers-reduced-motion: reduce` 下 rail、main、toolbar、icon、directory 的 transition 均为 `0s`，directory animation 为 `none`。
- 1200×844、1024×844、768×844 的 document/main 横向溢出均为 0；正文宽度分别为 720、约 717、约 639px，768 时左栏为 80px。768 下选区已激活复制与“和老己聊聊”后，工具区宽 288px，横向溢出仍为 0。
- 验收入口模拟路由替换后 `.text-reader-shell` 数量为 0，共享外壳 probe 恢复静态定位，正文主题没有污染 `body` 或共享 nav token。生产共享入口仍由总控集成。
- Chrome console 的 warning/error 为 0。普通/专注文本阅读均无坐姿桌宠或固定气泡，仅保留左栏品牌头像与选中文本入口。

原生 200%：当前 Chrome 控制接口发送浏览器原生放大快捷键后，`innerWidth/devicePixelRatio` 仍为 `1440/2`，未能证明缩放生效。因此本候选明确登记为未完成浏览器证据；旧的 CSS `zoom:2` 截图和 query 已删除，不用 override 或 CSS zoom 冒充原生 200%。

## 本地复验

从仓库根运行：

```sh
apps/server/node_modules/.bin/tsx redesign-v2/output/acceptance/m1-f2-b/acceptance-server.ts
API_TARGET=http://127.0.0.1:3001 apps/web/node_modules/.bin/vite --config apps/web/vite.config.ts --host 127.0.0.1 --port 4174 --strictPort
```

打开 `http://127.0.0.1:4174/redesign-v2/output/acceptance/m1-f2-b/index.html?book=epub`。可用 query：`book=txt|empty|private|missing`、`delay=2000`、`saveFail=1`、`select=1`、`clipboardFail=1`、`loadFail=1`、`cache=light|dark`、`seedAccount=account-b`、`seedVersion=2`、`storageDenied=1`、`noScope=1`、`leave=1`。

## 总控集成接缝

当前范围禁止修改共享入口、contracts 与迁移；总控集成时需完成以下精确连接：

1. 由总控在 `packages/domain/src/index.ts` 导出 `extractTextBook`，并在 Worker/导入解析成功后调用 `TextReaderRuntime.publishTextBook(accountId, bookId)`；不要另建 locator 或文件版本语义。
2. 将 `registerTextReaderRoutes(app, runtime, resolveAccountId)` 接入 `apps/server/src/app.ts`；三条路由固定为 `GET /api/v1/books/:bookId/reading`、`GET /content/sections`、`PUT /position`。
3. contracts 复用冻结的 `TextLocator={kind:"text",fileVersion,sectionId,offset}`；将本模块的结构相同本地类型换为共享导入即可。
4. 迁移需建 `book_sections(account_id,book_id,file_version,section_id,section_order,title,body)` 和 `reading_positions(account_id,book_id,locator,background,version,updated_at)`；`book_sections` 必须同时有 `(account_id,book_id)` 与 `(account_id,book_id,file_version)` 复合 owner 外键，唯一顺序为 `(account_id,book_id,file_version,section_order)`；`reading_positions` 主键为 `(account_id,book_id)` 并引用 owner 复合键。
5. 在 `apps/web/src/main.ts` 的书籍阅读路由挂载 `mountTextReader(root,{bookId})`，离开路由时调用 `destroy()`；共享 `styles.css` 不需复制本模块样式。
