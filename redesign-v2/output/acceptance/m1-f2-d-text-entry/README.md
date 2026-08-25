# M1-F2-D-TEXT-WEB-ENTRY

当前验收记录绑定 `codex/m1-f2-d-text-entry` 的冻结实现候选 `a12f2c0c5da03ac3b456dee7731ade5f662f54e7`。入口适配基线为 `deba32594438b9c7c26267266ecaf4d1b5c4901a`，来源私有候选为 `d65ab3bd93b667f3ae8ecba21aba725c5e4ac5a8`；本次 README 是该冻结候选之后的验收收据修订，不以 handoff 或未来提交替代版本绑定。本包只写 Desktop Web 入口与私有 reader / text annotation / book detail 模块；未修改 shared Desktop shell、Mini、contracts、server、schema、lock、TASK_LEDGER 或 DESIGN*。

## 真实 Case

- 隔离 PostgreSQL：`selfalone_dentry`（Docker `infra-postgres-1`，仅用于本次验收）；API `127.0.0.1:4110`；Vite `127.0.0.1:4173`；对象目录在 `/tmp/selfalone-dentry-books`，不是仓库完成证据。
- 通过真实 `POST /api/v1/books/import` 导入并等待 `ready_text`：TXT `34aac19a-7b7c-4808-a3de-7dddd1d85bf5`，EPUB `9332d12b-3f97-45e1-8501-d823b7de7555`。无 fixture / 内存适配器。
- 书架 ready 项进入 `#/book/:id` BookDetailShell；详情真实显示与书架一致的动态默认封面、右侧“基于本书制作 PPT”入口，以及“阅读 / 划线与想法 / 老己笔记 / PPT作品”四个入口。“阅读”进入连续正文 `#/reading/:id`；关闭详情返回书架；后退/前进重新建立详情状态。
- “PPT作品”是可切换的真实 tab/tabpanel；当前书籍没有作品时显示真实空态和可达的制作入口，不伪造生成中的页面、PPTX 或作品数据。详情入口携带 `book` 与真实 `bookTitle` 到 `#/conversation?stage=requirements...`，共享会话显示可恢复的书籍制作意图；刷新与阶段切换保留该 intent。
- TXT Chrome Case：真实正文拖选→划线单次保存，工具面关闭、`Range` 清除；刷新后真实 `/annotations` 恢复 1 条划线；再次拖选→写想法→保存后恢复 2 条记录，想法关联原文。
- 独立“新建笔记”进入 notes tab、textarea 聚焦、无引用 blockquote；编辑/删除通过真实 notes API 验证。真实第二页并发更新制造 409：第一页输入保留，原位错误与 44px retry 首屏可见，焦点落到 retry；重新取最新版本后 retry 保存，无需重做输入。
- EPUB Chrome Case：从书架进入详情、阅读，3 段连续正文真实选区划线；刷新后 mark 恢复，`Range` 为 0。

## 视口与浏览器收据

CSS viewport 均为 `height=844`、`deviceScaleFactor=2`；截图文件记录 CSS viewport 的物理像素尺寸（不是将 DPR 再乘一次）：`768×844`、`1024×844`、`1200×844`、`1440×844`。每个真实 Case 检查 `scrollWidth === clientWidth`；当前 Chrome error/warn 日志为空。

- [01-reader-768-dpr2.jpg](./01-reader-768-dpr2.jpg)
- [02-reader-1024-dpr2.jpg](./02-reader-1024-dpr2.jpg)
- [03-reader-1200-dpr2.jpg](./03-reader-1200-dpr2.jpg)
- [04-reader-1440-dpr2.jpg](./04-reader-1440-dpr2.jpg)
- [05-detail-1440-dpr2.jpg](./05-detail-1440-dpr2.jpg)：panel `left=184`、`width=1256`；共享 reader rail `0–184` 保持可见，panel 不覆盖 rail。
- [06-detail-768-dpr2.jpg](./06-detail-768-dpr2.jpg)：panel `left=80`、`width=688`；768 断点 rail `0–80` 保持可见，底层 main/rail 在 modal 期间 inert，焦点由详情 panel 管理。
- [07-selection-toolbar-1440-dpr2.jpg](./07-selection-toolbar-1440-dpr2.jpg)：工具面位于章节 header 下方，真实几何检测无重叠。
- [08-detail-cover-ppt-dpr2.jpg](./08-detail-cover-ppt-dpr2.jpg)：1440 详情封面、右侧 PPT 入口、三 tab 表面；panel `left=184`、`width=1256`。
- [09-detail-cover-ppt-dpr2.jpg](./09-detail-cover-ppt-dpr2.jpg)：1200 同状态详情；panel `left=184`、`width=1016`。
- [10-detail-cover-ppt-dpr2.jpg](./10-detail-cover-ppt-dpr2.jpg)：1024 同状态详情；panel `left=184`、`width=840`。
- [11-detail-cover-ppt-dpr2.jpg](./11-detail-cover-ppt-dpr2.jpg)：768 同状态详情；panel `left=80`、`width=688`，rail `0–80` 保持可见。
- [12-detail-ppt-empty-1440-dpr2.jpg](./12-detail-ppt-empty-1440-dpr2.jpg) / [13-detail-ppt-empty-768-dpr2.jpg](./13-detail-ppt-empty-768-dpr2.jpg)：PPT 作品 tab 激活、隐藏 panel 退出视觉与命中流，真实空态在两档视口可见。
- [14-ppt-handoff-1440-dpr2.jpg](./14-ppt-handoff-1440-dpr2.jpg)：点击详情 CTA 后进入共享 Desktop conversation shell；URL 携带 `book`/`bookTitle`，主画布显示恢复意图，rail 与任务工作区仍为共享实现。

已用 CDP emulated media 验证 `prefers-reduced-motion: reduce`：reader rail transition 为 `none`，详情 tab panel hidden/inert/focus 规则仍成立。Chrome 控制面未能改变原生页面缩放至 200%（Meta+/Meta= 后 `innerWidth` 未变），该项保留为 VERIFY，未冒充已验证。

## 入口接缝与限制

- 共享 `renderDesktopAppShell` / `ui/desktop-shell.ts` 未改；reader 使用已有私有 rail，详情 surface 通过 `var(--reader-rail)` 留出同一 rail，不再全屏覆盖。详情 modal 的 rail 保持视觉可见但 inert，底层导航不进入 Tab/AX/命中流。
- 选区“和老己聊聊”在没有真实会话 handoff 时 disabled、fail-closed；本包不伪造 conversation 引用路由。PPT CTA 只携带可恢复的书籍制作意图并进入当前共享会话，未宣称已生成 AI 内容、PPTX 或作品；当前 PPT 作品数据没有额外私有假适配器。
- 详情 modal 通过私有 reader 入口保留共享 rail；正向与反向 Tab 均圈定在 panel，Esc/关闭恢复正文触发点，inactive panel 使用 `hidden`，底层导航与 rail 使用 inert。原生浏览器 200% 缩放控制面未能改变 `innerWidth`，该项继续诚实标为 VERIFY。
- 本 README 的截图文件记录 CSS viewport 与 `deviceScaleFactor=2`；PNG/JPEG 物理像素仍分别为 `1440×844`、`1200×844`、`1024×844`、`768×844`，没有把 DPR 再乘一次。上述冻结实现候选 hash 与截图集合构成当前收据，仍需总控与非作者按同一真实 Case 复验，不能由本记录替代视觉审查。
