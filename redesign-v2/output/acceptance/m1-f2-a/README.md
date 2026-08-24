# M1-F2-A 验收证据

> 当前状态：`VERIFY`，等待候选提交与 `main` 集成复验。本地 EPUB / TXT / PDF 的账户归属、对象保存、解析状态、元信息、固定批准底图的稳定哈希封面、搜索、刷新恢复和账户隔离已形成真实纵向闭环。书架在用户 Chrome `1440×844 @ DPR 2 / 100%` 及 `200%` 重排下已复验；受本机物理屏幕限制无法取得真实 `1440×1024` 内容视口，因此按 `DESIGN-WEB.md` 另以明确标注的 composition-only 证据检查完整页面构图，不把 viewport override 冒充真实窗口。

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
