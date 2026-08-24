# M1-F2-A 验收证据

> 当前状态：`VERIFY`，等待候选提交与 `main` 集成复验。本地 EPUB / TXT / PDF 的账户归属、对象保存、解析状态、元信息、固定批准底图的稳定哈希封面、搜索、刷新恢复和账户隔离已形成真实纵向闭环。书架在用户 Chrome `1440×844 @ DPR 2 / 100%` 及 `200%` 重排下已复验；受本机物理屏幕限制无法取得真实 `1440×1024` 内容视口，因此按 `DESIGN-WEB.md` 另以明确标注的 composition-only 证据检查完整页面构图，不把 viewport override 冒充真实窗口。

## 2026-08-25 视觉门重开候选（当前）

- 任务：M1-F2-A visual reopen；worktree `/Users/echoman/.codex/worktrees/59ae/SelfAlone`，分支 `codex/m1-f2-a-visual-reopen`，固定基线 `2298f633a16e0b6e97e32529aa1ff5018b5e4279`。
- 隔离运行：PostgreSQL schema `m1_f2_a_visual_reopen_20260825_59ae`、Server `4320`、Web `4390`、对象目录 `/tmp/selfalone-m1-f2-a-59ae/books`；未使用审查者 `4380` 或既有 `4310`。
- 当前状态仍是 `VERIFY / BLOCKED_BY_RIGHT_SCENERY_REVIEW`，不是 `DONE`。正式 `03-reading-library.png` 与用户定稿图的解码原始像素 MD5 均为 `0fc27276fc13aee7199eb230408a66c4`；本轮右下山水与定稿冲突，已按总控要求冻结。
- 冻结边界：工作树中的 `.library-main::after` 和 `library-visual-contract.test.ts` 对应右山断言不得继续修改、暂存或提交。`25-reopen-normal-1440x844.png`、`26-reopen-reference-03-top844-comparison.png` 是失败诊断图，不属于通过证据，也不进入当前候选提交。

### 本轮真实交互结论

- 搜索：300ms 输入防抖；Enter 立即请求；原生清除与 Escape 立即请求空查询。输入中保留旧书架并只在搜索框内显示 `正在搜索…`；快速 `paper → 远山` 的第一请求以 `net::ERR_ABORTED / canceled: true` 结束，第二请求写回《远山来信》，输入焦点始终保留。
- 搜索失败：断开 `4320` 后保留查询和 10 本未筛选书，明确显示 `搜索“网络失败”失败，当前显示未筛选的 10 本书。`，并提供“重试搜索”“清除搜索”；恢复服务后重试与清除均成功。初始加载失败只出现独立“重新载入”，恢复后重新载入 10 本，不混用搜索动作。
- 空账户可访问性：顶部“导入书籍”和中央“导入一本书”均为独立 button，共用唯一隐藏 file input；Tab 顺序不进入隐藏 input，顶部 `152×52px`、中央 `144×44px`，Space / Enter 均打开原生文件选择器，焦点样式可见。
- 导入：隔离服务真实保存并解析 EPUB《远山来信》、TXT、PDF；不支持 `.md` 保留 15 本并给出格式原因；断网时 `网络中断恢复样本.txt` 保留 15 本，恢复后经历 `processing → ready_text`；`浏览器损坏样本.pdf` 经 `processing → failed / PDF_INVALID`；服务重启与刷新后记录仍在，控制台 warning/error 为 0。
- 原生文件选择器的 Enter / Space 激活已由真实 Chrome 验证；Chrome 插件未获本机“允许访问文件网址”权限，不能用插件把本地路径注入原生 chooser。后续文件 payload 通过当前页面的 Chrome DevTools 主世界赋给共享 input，触发生产 `change → fetch → 保存 → 解析 → 轮询` 路径；因此“用户在 chooser 中选中本地文件”这一最后一步仍是明确未闭合边界。

### 本轮截图索引

以下截图只证明对应交互、状态、尺寸或放大压力；它们都包含已冻结且判定 FAIL 的右山，不能作为右山视觉通过证据。

| 证据 | 尺寸 | SHA-256 | 用途 |
| --- | ---: | --- | --- |
| `27-reopen-search-loading-retains-shelf.png` | `1440×844` | `d561fb3937fc041a7ca65717812dcc50dac572082f3396dc4ba4de938638f309` | 输入中局部 loading、旧书架保留 |
| `28-reopen-search-matched-focus.png` | `1440×844` | `872faa338cabda9de79c987384560dce3d34f7e8dcf0af45443547458096ee49` | 匹配结果与焦点保留 |
| `29-reopen-filtered-empty.png` | `1440×844` | `3ea390d37f7f0ea1ebd3f55894528b9b3532e46857e5a349cffbe0e57da3c987` | 筛选空态 |
| `30-reopen-search-failure-retains-unfiltered.png` | `1440×844` | `54e8ac6ba370c21efc48a90cddf38425515b50a34b6933e3e312da5ac0613c89` | 搜索失败、旧书架与双动作 |
| `31-reopen-initial-load-failure.png` | `1440×844` | `29afd11d82d2b9c31997ba5022e2b85ccdf8ae7e7878285b0f8a405bb9b63c0f` | 独立初始加载失败 |
| `32-reopen-import-processing.png` | `1440×844` | `c15c0a12c399c3ae76b28923df5a9bb8ce9dca15a16896d0d3fa45fbb51b6b12` | 真实解析中卡片与旧书架同屏 |
| `34-reopen-import-network-recovery.png` | `1440×844` | `665eb90eac3bfd6e0b64f6e804bf0d815ca4d040edb2e8eab6116a217772a93a` | 断网恢复后的 ready_text |
| `35-reopen-import-damaged-pdf.png` | `1440×844` | `61da0dc4c405ea68c7af26b7317910adadd05673b0b7745bb52bf73f82e41ee7` | 损坏 PDF 失败原因 |
| `33-reopen-scale-200-percent.png` | `720×422` | `437fe4485337591c3077cdc8d77bc3827dcbb5c6683c9977789b7bd9e4e09cb5` | DevTools page scale 2 的工具区压力补证 |
| `36-reopen-scale-200-long-title.png` | `720×422` | `12323b79a9454b81337f4be96f635238e0c2fe42fc08700f5893be3c5fc1cba2` | DevTools page scale 2 的长标题/作者/24px 状态带补证 |

`27–32 / 34–35` 使用显式 `1440×844` viewport override，实测 DPR 1、zoom 1、`visualViewport.scale = 1`、横向溢出 0，属于交互补证而非“无 override 的 DPR 2”同态证据。`33 / 36` 使用 `pageScaleFactor = 2`，视觉视口 `720×422`、文档横向溢出 0；长标题盒 `259–337.61`、作者 `349.61–366.41`、状态带 `397–421`，互不碰撞。结束后已清除 scale 与 viewport override，恢复原生 Chrome `1440×900 @ DPR 2 / visualViewport.scale 1`；本轮没有重新取得要求的无 override `1440×844 @ DPR 2`，该项与右山新 brief 一并留待复验。

## 现场与范围

- 候选分支：`codex/m1-f2-a`；当前恢复 HEAD：`353b4fd`。
- 隔离环境：PostgreSQL schema `m1_f2_a_47b4`、Server `4310`、Web `4380`、对象根 `data/artifacts/m1-f2-a-47b4/`。
- 当前真实书架为 11 本：`ready_text` 9、`ready_pages` 1、`failed` 1；第二账户为 0。本轮新增真实长标题 TXT 位于 `fixtures/这是一本用于验证超长书名在窄屏封面中不会与作者和状态带发生碰撞的真实业务案例.txt`，经原生文件选择器上传、服务端保存和解析后进入书架。
- `TASK_LEDGER.md` 由项目总控独占写入；本候选不得暂存或提交该文件。

## 功能与持久化

- 真实样本覆盖：可解析 EPUB《远山来信》（作者林野）、UTF-8 TXT《山海札记》、带文字 PDF《远山来信》、仅页面图像 PDF《扫描书页》、损坏 PDF，以及本轮长标题 TXT。
- 上传后先进入 `processing`，轮询后落入 `ready_text`、`ready_pages` 或 `failed`；错误状态保留完整可访问名称，封面内显示 24px 紧凑状态带。
- 同名异源仍保留为不同书籍；作者缺失显示“作者未知”；搜索、筛选空、服务失败保留旧快照、刷新恢复和第二账户隔离均通过真实入口验证。
- 三张正式本地封面底图均位于 `redesign-v2/assets/book-covers/`，运行时按 `book.id` 稳定哈希选图并叠加真实书名、作者；刷新和排序不换图，不做运行时图片生成。
- 封面比例为 5:7，无描边，只保留一层轻阴影；进度/解析状态在封面底部，来源在封面下方。

## 当前视觉实现

- 左栏 `#E7EAE8`、主画布 `#F1F1EF`；书架 Token 只限定在 `.library-shell`，未改写旧对话/PPT 工作区的根 Token。
- 左栏使用正式透明素材 `desktop-left-rail-vintage-transparent-v2.png`：贴底居中、宽约栏宽 120%、透明度 `.44`、上缘渐隐；窄栏降为 `.28`。
- 右下主画布复用同一批准素材的中段远山裁切：只显示远山，不旋转、不显示亭子或大树；透明度 `.14`、径向渐隐、`pointer-events: none`，不增加滚动或命中遮挡。
- 桌面书架为五列、封面 `160×224px`；工具区搜索/按钮高 52px、按钮宽 152px。状态带为 `12px / 18px`，高 24px。
- 右下桌宠使用正式坐姿阅读透明素材；常规人物 104px，≤1199px 为 72px，≤900px 为 60px；气泡命中区始终 44px，可见圆面 38px。

## 真实 Chrome 证据

### 1440×844，100%

- 证据：`22-real-chrome-1440x844-final-visual.jpg`
- 文件尺寸：`1440×844`；SHA-256：`0906acda1f8d1d0471c96a5df15dddab5fed86debd1d60b31dfca7c71c37dedf`。
- 外窗 `1440×900`，CSS 视口 `1440×844`，DPR `2`，根 zoom `1`，`visualViewport.scale = 1`。
- 五列 `160×224px`；页面 `clientWidth / scrollWidth = 1440 / 1440`。右下远山可辨但保持低对比，无亭子、大树、矩形边界，不压住桌宠。
- 长标题三行省略，但 article / cover 的可访问名称保留完整书名。标题盒 `y 259–337.61`、作者 `349.61–366.41`、状态带 `397–421`，标题/作者及作者/状态两处均无碰撞。
- 导入控件 `152×52px`，`aria-label` 和 `title` 均为“导入书籍”。搜索框 Tab 到文件输入时外层显示 3px 焦点轮廓，Shift+Tab 返回搜索框。控制台 error/warning 为 0。

### 200% 浏览器缩放重排

- 证据：`23-real-chrome-200pct-companion-safe.jpg`
- 文件尺寸：`720×422`；SHA-256：`93d116efc6afbec4aecbe7e527cbba7eff57bd5e63a171037cd7417060d5f799`。
- 真实 Chrome CSS 视口 `720×422`，DPR `4`，根 zoom `1`，`visualViewport.scale = 1`；三列、无横向溢出、控制台 error/warning 为 0。
- 三列封面右缘依次为 `264 / 444 / 624px`；桌宠容器左缘 `630px`，与第三列保留 6px 安全间距。人物为 `60×60px`，气泡命中区保持 `44×44px`。
- 长标题、作者与 24px 状态带无碰撞；导入图标按钮 `56×48px` 且可访问名称为“导入书籍”。复验后已用浏览器原生命令恢复 100%，恢复指标为 `1440×844 @ DPR 2`。

### 响应式补证

这些截图在最终右下远山和 12px 状态带调整前抓取，只证明相应真实宽度的列数与无横向溢出，不作为最终同态视觉证据：

| 真实 CSS 视口 | 列数 | 封面 | 横向溢出 | 证据与 SHA-256 |
| --- | ---: | ---: | --- | --- |
| `1200×648` | 4 | `160×224` | 无 | `15-real-chrome-1200x648-cover-status.png` · `040b34d9d3ff39795362a6f722025d67f6348949407dd28cb1321db97ccc936a` |
| `1024×648` | 3 | `160×224` | 无 | `17-real-chrome-1024x648-cover-status.png` · `9c5a6fc010b705007ab99b44dd1eb5ad79278a7e103f501ecb462ebb2820d06c` |
| `768×648` | 3 | `160×224` | 无 | `18-real-chrome-768x648-cover-status.png` · `c44fc85d48f89b0066597bc065736d6e40212e44b9ef0cebffe5af3aa792ca03` |

误拍为 PPT 页的 `16-real-chrome-1440x844-cover-status.png` 以及本轮中间对照图已删除，不进入验收索引。

## 1440×1024 真实窗口限制与构图检查

- 本机物理桌面为 `1440×900`。用户 Chrome 的最大真实外窗为 `1440×900`，内容视口为 `1440×844`；系统会把尝试扩展到屏幕外的窗口重新钳制到该尺寸。
- 另以隔离临时配置启动两次真实、可见 Chrome，分别保持 DPR 2 和强制 DPR 1，均未设置 DevTools viewport override；macOS 仍将外窗钳制到 `1440×825`，内容视口为 `1440×738`。
- 因此当前硬件环境无法提供真实 `1440×1024` 内容视口；未使用 headless、截图裁切或页面缩放冒充真实窗口。
- 构图证据：`24-composition-only-1440x1024-final.png`，`1440×1024`，SHA-256 `833b14c27ee692c1b11bbfe7cfa6e26c5e0cf1b4b5dde1af4f062bc9ee6fece6`。该图只使用临时 viewport override 检查完整页面构图，明确不属于真实 Chrome 窗口证据。
- 构图量测为 CSS `1440×1024 @ DPR 2`、五列，列起点 `236 / 451 / 666 / 881 / 1096px`，`clientWidth / scrollWidth = 1440 / 1440`；11 本书保持 `5 + 5 + 1` 排布，右下远山、左栏山水、桌宠和气泡无碰撞。截图后已清除 override，并恢复真实 `1440×844 @ DPR 2`、无横向溢出。

## 自动验证

- 定向：`pnpm --filter @selfalone/web exec vitest run src/library-visual-contract.test.ts src/library-state.test.ts`，2 文件 / 16 项通过。
- 全量：`pnpm verify` 通过；13 个测试文件 / 50 项测试、全仓类型检查与生产构建均成功。测试与构建只证明回归，不替代上述真实浏览器门。
