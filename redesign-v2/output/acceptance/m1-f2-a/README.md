# M1-F2-A 验收证据

- 候选分支：`codex/m1-f2-a`；回退基线：`f89a4b77131c7e13676de15901cfd6712d504d10`。
- 隔离环境：PostgreSQL schema `m1_f2_a_47b4`、Server `4310`、Web `4380`、对象根 `data/artifacts/m1-f2-a-47b4/`。
- 真实样本：可解析 EPUB《远山来信》（作者林野）、UTF-8 TXT《山海札记》、带文字 PDF《远山来信》、仅页面图像 PDF《扫描书页》、损坏 PDF。样本只保存在忽略目录，未作为生产资源提交。
- 持久化结果：默认账户 10 个文件对象、10 个唯一对象键，全部以账户 ID 开头；状态为 `ready_text` 8、`ready_pages` 1、`failed` 1。第二账户列表为 0；服务重启后全部恢复。
- 行为验收：真实文件选择器上传；上传后先显示 `processing`，轮询后落入可读/页面可用/失败；同名 TXT 保持为两本；缺作者显示“作者未知”；书名搜索、筛选空、服务失败保留原书架、刷新恢复均经真实浏览器入口验证。
- 视觉合同：共享左栏使用已确认运行时资产 `desktop-left-rail-landscape-approved-v1.png`（SHA-256 `cb3999d50772e0963b0a9c2204c4d5891a2e84a824a4c597f7eee3eeb0d07700`）；正常态与 `design-reference/03-reading-library.png` 同状态审查，参考示例彩色封面替换为产品规定的 `5:7` 动态默认封面，解析状态派生为封面底部状态带。
- 无障碍与键盘：搜索框有显式标签并由 Enter 提交；Tab 从搜索框进入文件选择器时，导入按钮显示 `3px` 焦点轮廓；导航、文件选择器与陪伴入口均有可访问名称；交互目标不小于 44 px，并尊重 `prefers-reduced-motion`。

## 浏览器矩阵

最终证据使用 Chrome 的显式视口覆盖，CSS 视口、DPR 与 PNG 位图逐项核对；四张截图均为 `DPR 1`，文件像素与表中视口一一相等。

| 视口 | 列数 | 封面宽度 | 横向溢出 | 证据 |
| --- | ---: | ---: | --- | --- |
| 1440×1024 | 5 | 180 px | 无 | `02-normal-1440x1024.png` |
| 1200×1024 | 4 | 180 px | 无 | `02-normal-1200x1024.png` |
| 1024×1024 | 3 | 180 px | 无 | `02-normal-1024x1024.png` |
| 768×1024 | 3 | 180 px | 无 | `02-normal-768x1024.png` |

状态证据：`00-loading-1440x1024.png`（真实请求挂起）、`01-empty-1440x1024.png`（独立空 schema）、`03-filtered-empty-1440x1024.png`（Enter 搜索）、`04-failure-retained-1440x1024.png`（服务离线且保留 7 本旧快照）、`05-processing-1440x1024.png`（真实对象上传后、10 秒解析延迟）。恢复后的浏览器控制台无 error/warning。

## 自动验证

- 定向测试：`pnpm exec vitest run packages/domain/src/book-import.test.ts apps/server/src/library-runtime.test.ts apps/web/src/library-state.test.ts`，3 个文件、10 项通过。
- 完整验证：`pnpm verify` 通过，类型检查、10 个测试文件 / 33 项测试与生产构建全部成功；`git diff --check` 通过。
