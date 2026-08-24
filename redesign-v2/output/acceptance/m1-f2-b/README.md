# M1-F2-B EPUB/TXT 文本阅读验收收据

原始实现基线：`main@44b81ea`；范围分支：`codex/m1-f2-b`；实现候选止于 `804f952`。本目录保存该工作包的真实 Case、浏览器截图与 main 集成收据，不替代 SPEC、DESIGN、TECHNICAL 或任务台账。

## 真实 Case

- `acceptance-server.ts` 在隔离 PostgreSQL schema 和临时对象目录中，经现有书库导入链路写入一个真实 EPUB ZIP 与一个真实 UTF-8 TXT，再调用文本发布模块生成正文。
- EPUB 的 spine 顺序为 `epub:one`（雨停以后）→ `epub:two`（山路尽头）；TXT 的源偏移顺序为 `txt:00000000`（序章）→ `txt:00000013`（第一章 风从海上来）→ `txt:00000500`（第二章 靠岸以后）。
- 浏览器在 TXT 末章保存 `TextLocator={kind:"text",fileVersion:1,sectionId:"txt:00000500",offset:0}` 与深色背景；刷新后 `/reading` 返回同一定位，刷新前后首个活动章节均为 `txt:00000500`，截图 11 为恢复结果。
- 服务集成测试另行用两账户、两个真实文件证明 owner 隔离；旧文件版本写入返回 `409 STALE_VERSION`，并证明数据库中的先前定位不被覆盖。follow-up Case 再从已有 v1 位置发布 v2 sections：v1 写入继续 409；两个同时以 v2 `expectedVersion=0` 发起的写入恰有一个成功为单调版本 2、另一个 409，数据库保留胜者。
- EPUB 上限 follow-up Case 分别证明：central directory 声明超过 100 MiB 时不调用 inflate；伪造偏小 `uncompressedSize` 的 deflate 条目只能按剩余额度膨胀且 zlib 超限统一为 `EPUB_INVALID`；stored 超限条目在复制正文 Buffer 前拒绝。
- 保存失败 Case 让背景变更写入持续失败到用户重试；截图 07 与浏览器 DOM 同时证明正文、当前章节、当前浅色背景和重试入口仍保留；点击“重试保存”后变为“阅读位置已保存”。

## 真实 Chrome 证据

浏览器为已连接的真实 Chrome；主基准是未设 viewport override 的原生 `1440×844`、`devicePixelRatio=2`，截图文件也均按实际像素核验。1200、1024、768 是 Chrome 的响应式 viewport override，仅用于断点验证，完成后已 reset 回原生 1440×844，不冒充原生窗口尺寸。

| 文件 | 证据 |
| --- | --- |
| `01-epub-light-native-1440x844.jpg` | EPUB 浅色正文 `#FAFBF8` 与浅色左栏 `#E7EAE8` |
| `02-epub-dark-native-1440x844.jpg` | EPUB 深色正文 `#171B1A` 与深色左栏 `#202624` |
| `03-trusted-cache-first-frame-native-1440x844.jpg` | API 延迟 2 秒时，可信深色缓存首帧直接显示整栏和深色 loading，无默认闪回 |
| `04-epub-normal-native-1440x844.jpg` | EPUB 连续正文和第二节正常态 |
| `05-txt-deduplicated-native-1440x844.jpg` | 真实 TXT 的三节顺序，章节标题首行不在正文重复 |
| `06-directory-filtered-empty-native-1440x844.jpg` | 非 modal、无遮罩目录与筛选空 |
| `07-save-failure-retained-native-1440x844.jpg` | 保存失败保留正文与当前背景，并显示刷新风险和重试 |
| `08-true-empty-native-1440x844.jpg` | 真空态与禁用阅读工具 |
| `09-load-failure-native-1440x844.jpg` | 失败态、非颜色提示、重新载入与禁用阅读工具 |
| `10-txt-responsive-768x844.jpg` | 768×844 响应式断点，80px 私有左栏与无横向溢出 |
| `11-refresh-restored-txt-dark-native-1440x844.jpg` | TXT 末章与深色背景刷新恢复 |
| `12-main-integration-library-1440x900-dpr2.png` | main 共享接缝候选的真实书架，两本真实导入书均为可聚焦阅读链接；SHA-256 `1a447438bc93864727e32d3ba042095f557fc0b88195a082c5a67a62dfabf77c` |
| `13-main-integration-epub-dark-focus-1440x900-dpr2.png` | main 真实 EPUB 深色专注态；全局 rail 与非阅读操作退出视觉和可访问树；SHA-256 `62d00eff1765aa4223e201375a4db1ae1fbb2f8ac9be60518c50800b18eedeae` |
| `14-main-integration-txt-1440x900-dpr2.png` | main 真实 TXT 浅色普通态，标题去重、作者回退与共享外壳恢复；SHA-256 `2754b659bf7a18d86de153a19408f2a9cef0c5f1f8a0bd3ed800aeb5a974a511` |

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

follow-up 在 2026-08-25 再用未设 viewport override 的真实 Chrome（`1440×900`、`devicePixelRatio=2`）复验 Selection：选中 EPUB 的“第一章”并滚动至 `scrollTop=773.5` 后，以真实鼠标切换 dark→light，选区、Range、复制按钮、“和老己聊聊”、按钮焦点和 `scrollTop` 全部不变，light 山水 opacity 为 `.34`；随后进入并退出专注阅读，两次仍保持同一 Selection 与 `scrollTop=773.5`。成功复制提示在 2.4 秒后清空但选区继续保留；拒绝复制提示在 3.1 秒后仍保留，选区、复制按钮与对话入口仍可用，console warning/error 为 0。该轮没有用 viewport override 冒充原生 `1440×844`。

总控 main 集成候选另以隔离 PostgreSQL schema、独立对象目录、Server `4315` 与 Web `4395` 从真实书架入口复验：真实 TXT 与真实 EPUB 均经 `202 → processing → ready_text`，只有章节发布完成后才暴露为可阅读；书架点击进入真实路由，EPUB 目录跳转产生 `scrollTop=92`，浅→深保存后刷新仍为 `is-dark`，专注态只保留目录 / 背景 / 退出三个 `46×44px` 控件。返回书架再进入 TXT 成功，`1440×900 @ DPR2 / scale1` 全程 document 横向溢出为 0，Chrome console warning/error 为 0。截图 12–14 均来自本次 main 集成候选，不冒充缺失的精确 `1440×844` 或原生 200%。

原有 11 个截图经 `file` 核验均为 JPEG/JFIF，现已只改扩展名为 `.jpg` 并同步本表，没有重编码或重拍；像素尺寸仍为十张 `1440×844` 与一张 `768×844`。

原生 200%：当前 Chrome 控制接口发送浏览器原生放大快捷键后，`innerWidth/devicePixelRatio` 仍为 `1440/2`，未能证明缩放生效。因此本候选明确登记为未完成浏览器证据；旧的 CSS `zoom:2` 截图和 query 已删除，不用 override 或 CSS zoom 冒充原生 200%。

## 本地复验

从仓库根运行：

```sh
apps/server/node_modules/.bin/tsx redesign-v2/output/acceptance/m1-f2-b/acceptance-server.ts
API_TARGET=http://127.0.0.1:3001 apps/web/node_modules/.bin/vite --config apps/web/vite.config.ts --host 127.0.0.1 --port 4174 --strictPort
```

打开 `http://127.0.0.1:4174/redesign-v2/output/acceptance/m1-f2-b/index.html?book=epub`。可用 query：`book=txt|empty|private|missing`、`delay=2000`、`saveFail=1`、`select=1`、`clipboardFail=1`、`loadFail=1`、`cache=light|dark`、`seedAccount=account-b`、`seedVersion=2`、`storageDenied=1`、`noScope=1`、`leave=1`。

## 总控 main 集成收据

- `packages/contracts` 现只定义一份 `TextLocator / PdfLocator / ReadingLocator`、浅 / 深背景、文本阅读响应与位置写入结构；domain、Server 与 Web 已改为共享类型。
- `book_sections` 同时使用 `(account_id,book_id)` 与 `(account_id,book_id,file_version)` 复合外键；`reading_positions` 按 owner + book 唯一并使用递增版本。根集成测试现同时证明真实 TXT 与真实 EPUB 均从上传进入 `processing`，发布章节、保存各自位置，并在服务重启后恢复。
- 文本提取在数据库事务外准备；章节、标题 / 作者 / 章节数、`ready_text` 状态和解析收据随后在同一数据库事务提交。故障注入测试在章节写入后主动抛错，证明事务会回滚全部章节并把书籍关闭为明确失败，不留下半发布或“可阅读但无章节”的状态。
- Server 组合入口已注册 `/reading`、`/content/sections`、`/position`；Web 仅把 `ready_text` 卡片变成阅读链接，预取当前 `fileVersion` 后再提供完整 cache scope 并挂载阅读器，页面卸载时销毁控制器。
- 原生 Chrome 200% 与同 revision 无 override `1440×844` 仍是完整视觉 `DONE` 门；PDF 页面一致性留在 M1-F2-C，不由本次文本集成冒充完成。
