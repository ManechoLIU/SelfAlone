# 设计参考图

本目录保存 v2 经用户确认、但确认层级不同的设计参考副本；本 README 是全项目设计或开发可用图片、确认层级、适用范围和原稿链接的唯一索引。完整视觉定稿可直接对照页面风格；已认可页面参考可以约束明确列出的页面布局与视觉节奏；流程 / 结构参考只说明对应流程和内容组织，不能单独决定应用外壳。原始视觉稿和探索稿保留在 [`../output/ui-design-preview/product-design/`](../output/ui-design-preview/product-design/) 与 [`../work/mobile-design/`](../work/mobile-design/)；这里的图片不替代产品与视觉事实源。

实现时先读 [`../SPEC.md`](../SPEC.md) 和 [`../DESIGN.md`](../DESIGN.md)，再按参考图所属客户端读取 [`../DESIGN-WEB.md`](../DESIGN-WEB.md) 或 [`../DESIGN-MINIAPP.md`](../DESIGN-MINIAPP.md)。参考图中的错字、伪图标、占位内容或与事实源冲突的细节不得照搬。

## 完整视觉定稿

| 顺序 | 界面 | 文件 | 原稿 |
| --- | --- | --- | --- |
| 01 | 桌面 Web / 登录与注册 | [`01-auth-login-register.png`](01-auth-login-register.png) | [`auth-login-register-approved-v1.png`](../output/ui-design-preview/product-design/auth-login-register-approved-v1.png) |
| 02 | 桌面 Web / 对话与 PPT 范围需求 | [`02-conversation-and-scope.png`](02-conversation-and-scope.png) | [`guided-compact-workbench-v3.png`](../output/ui-design-preview/product-design/task-workspace-source-selection/guided-compact-workbench-v3.png) |
| 03 | 桌面 Web / 统一书架 | [`03-reading-library.png`](03-reading-library.png) | [`library-unified-compact-v3.png`](../output/ui-design-preview/product-design/library/library-unified-compact-v3.png) |
| 09 | 桌面 Web / 设置服务总览 | [`09-settings-overview.png`](09-settings-overview.png) | [`settings-service-overview-v8.png`](../output/ui-design-preview/product-design/settings/settings-service-overview-v8.png) |

`01-auth-login-register.png` 继续完整约束桌面 Web 账户入口的水墨书页构图、左右分区、字体、颜色、角色比例与控件质感；图中的具体邮箱表单、标签和操作文案已由当前账户规则局部替代。实现按 `SPEC.md`、`DESIGN.md` 和 `DESIGN-WEB.md` 使用微信主登录与邮箱备选，不增加手机号，也不把该桌面构图照搬为微信小程序登录页；无需仅为这处内容调整重新生成整张视觉稿。

其中 `02-conversation-and-scope.png` 是桌面应用共享外壳的主基准。2026-08-19 用户再次明确将所附定稿截图纳入开发参考；该截图、当前开发副本与原稿逐字节一致，尺寸均为 `1440×1024`，SHA-256 均为 `d84ffbae4a483be35c4c9c32192c05aa6e1ae111c966c6ee01599bcb28fd94f6`。应用内页面都必须延续其青瓷绿层次、老己头像与桌宠、左侧复古远山 / 树木 / 亭子背景；书架和设置稿补充较宽导航下的裁切与内容密度。

## 已认可页面参考，不是完整视觉定稿

| 顺序 | 界面 | 文件 | 原稿 | 可采用 | 不得照搬 |
| --- | --- | --- | --- | --- | --- |
| 08 | 桌面 Web / 书籍详情·PPT 作品 | [`08-book-detail-ppt-works.png`](08-book-detail-ppt-works.png) | [`book-detail-ppt-works-reference-v1.png`](../output/ui-design-preview/product-design/book-detail/book-detail-ppt-works-reference-v1.png) | 紧凑书籍信息条与标签层级、最多两列的 `16:9` 作品网格、生成中与已完成项的统一比例、作品名 / 日期或状态 / 下载操作层级 | 示例文案与日期、生成内容、截图中的头像和桌宠像素、偏暖或偏黄背景 |
| 10 | 桌面 Web / 书籍详情·老己笔记与划线想法 | [`10-book-detail-laoji-notes.png`](10-book-detail-laoji-notes.png) | [`book-detail-laoji-notes-reference-v1.png`](../output/ui-design-preview/product-design/book-detail/book-detail-laoji-notes-reference-v1.png) | 两个标签共享的单列全宽内容流、充足上下留白、细分隔线、行尾操作、轻量引用竖线与元信息；老己笔记保留唯一“新建笔记”主操作 | 标题式首行或独立标题字段、重复“我的想法”标签或笔形图标、截图中的示例文案 / 时间 / 头像 / 桌宠像素、偏暖或偏黄背景 |
| 11 | 微信小程序 / 会话抽屉打开态 | [`11-mobile-conversation-drawer.png`](11-mobile-conversation-drawer.png) | [`04-mountain-pavilion-refinement.png`](../work/mobile-design/visual-exploration-v2/04-mountain-pavilion-refinement.png) | 会话抽屉的单任务层级、顶部品牌 / 新建对话 / 搜索顺序、无卡片最近会话列表、充足留白、底部导航、小程序大圆角，以及列表下方贴底并向上消隐的远山亭子视觉落款 | 图像模型重绘的头像与图标、示例会话与时间、首条会话的书签形标记和时间线圆点、被遮罩主画布中的示例内容、截图像素尺寸 |
| 13 | 微信小程序 / 通用会话主画面 | [`13-mobile-conversation-shell.png`](13-mobile-conversation-shell.png) | [`mobile-conversation-shell-codex-imagegen-v1-original.png`](../work/mobile-design/conversation-shell-v2/mobile-conversation-shell-codex-imagegen-v1-original.png) | 全屏会话层级、一行通用会话名称、消息内的条件式任务阶段、单列消息层级、青瓷渐变与非对称留白、输入框左上低存在感趴卧桌宠，以及下部低对比远山亭子视觉落款 | 每个选项一张独立描边卡片、用圆形单选外观表达多选、过小且脱离选择关系的确认按钮、重复“已选 N 项”、过高的初始输入框；以及示例书名、任务文案、时间与进度，图像模型生成的头像 / 桌宠 / 图标像素、截图尺寸和整张图作为运行时素材 |
| 14 | 微信小程序 / 统一书架 | [`14-mobile-reading-library.png`](14-mobile-reading-library.png) | [`reading-library-codex-imagegen-v1-original.png`](../work/mobile-design/reading-library-v1/reading-library-codex-imagegen-v1-original.png) | 菜单 / “读书” / 导入页头、单一大圆角搜索框、连续双列封面网格、封面底部阅读进度、一行书名与无底色来源小图标，以及不依赖桌宠或底部导航的内容优先布局 | 示例封面、书名、进度与生成图标像素，最近阅读大卡片、来源分区、同步时间、被内容覆盖的山亭背景、截图尺寸，以及把整张图作为运行时素材 |
| 15 | 微信小程序 / 沉浸阅读默认态 | [`15-mobile-reading-immersive.png`](15-mobile-reading-immersive.png) | [`mobile-reading-immersive-v1.png`](../work/mobile-design/reading-detail-v2/mobile-reading-immersive-v1.png) | 一屏一页的正文排版、宋体层级、舒适页边距、灰绿纸白底色、极淡边缘纸纹，以及默认隐藏页头、工具栏、桌宠和气泡的沉浸状态 | 示例章节、正文、进度与生成字体像素，固定行数或把整张图作为运行时页面 |
| 16 | 微信小程序 / 阅读操作层呼出态 | [`16-mobile-reading-controls.png`](16-mobile-reading-controls.png) | [`mobile-reading-controls-v1.png`](../work/mobile-design/reading-detail-v2/mobile-reading-controls-v1.png) | 顶部返回 / 书名 / 更多、底部目录 / 内容 / 背景 / PPT 的贴边等距工具栏，以及右上沿趴卧桌宠与墨绿色圆形对话入口的整体位置关系 | 示例正文、图像模型生成的桌宠 / 图标像素、把角色当成工具栏按钮、让操作层常驻或把整图作为运行时素材 |
| 17 | 微信小程序 / 书籍介绍首屏 | [`17-mobile-book-introduction.png`](17-mobile-book-introduction.png) | [`mobile-book-introduction-v1.png`](../work/mobile-design/reading-detail-v2/mobile-book-introduction-v1.png) | 封面、书名、作者、来源、必要简介和轻量进度组成的扉页式纵向层级，底部低对比“上滑翻页阅读”手势提示，以及与正文共用纸面和分页节奏 | 示例封面、书名、作者、简介、进度和图像模型生成文字像素，继续阅读按钮、卡片化详情页或把整图作为运行时素材 |
| 18 | 微信小程序 / 书籍内容·划线与想法 | [`18-mobile-book-content-highlights.png`](18-mobile-book-content-highlights.png) | [`mobile-book-content-highlights-v1.png`](../work/mobile-design/reading-detail-v2/mobile-book-content-highlights-v1.png) | 阅读页遮罩之上的大圆角底部面板、三段内容切换、按章节入口、单列引用与关联想法、细分隔线，以及底部阅读工具栏保持可见的层级 | 示例章节、原文、想法、时间、图标像素与固定面板高度；不得为每条内容增加卡片或复制整图 |
| 19 | 微信小程序 / 书籍内容·老己笔记 | [`19-mobile-book-content-notes.png`](19-mobile-book-content-notes.png) | [`mobile-book-content-notes-v1.png`](../work/mobile-design/reading-detail-v2/mobile-book-content-notes-v1.png) | 与划线页共享的底部面板外壳、老己笔记选中态、轻量“新建笔记”、单列正文 / 引用 / 元信息 / 行尾更多及细分隔节奏 | 示例章节、笔记、引用、时间、生成图标像素，独立标题字段、标题式首行、笔记卡片或把整图作为运行时素材 |
| 20 | 微信小程序 / 书籍内容·PPT 作品 | [`20-mobile-book-content-ppt-works.png`](20-mobile-book-content-ppt-works.png) | [`mobile-book-content-ppt-works-v1.png`](../work/mobile-design/reading-detail-v2/mobile-book-content-ppt-works-v1.png) | PPT 作品选中态、按时间入口、紧凑双列 `16:9` 网格、生成中与已完成项的统一比例、进度 / 日期 / 下载层级，以及空余网格位保留呼吸空间 | 示例作品、日期、进度、预览图与生成图标像素，额外创建按钮、非 `16:9` 缩略图、卡片套卡片或把整图作为运行时素材 |
| 21 | 微信小程序 / 登录页 | [`21-mobile-auth-login.png`](21-mobile-auth-login.png) | [`mobile-auth-login-approved-v1.png`](../output/ui-design-preview/product-design/mobile-auth-login-approved-v1.png) | 单列登录层级、只出现一次的趴卧老己、较矮微信主按钮、无边框邮箱次入口、协议位置、冷象牙纸白与低饱和青灰绿，以及“上方山亭 / 中央留白 / 底部极淡远山”的背景分区 | 生成图中的角色、微信 / 邮箱图标、印章和文字像素，截图尺寸，以及把整张图作为运行时界面素材 |
| 22 | 微信小程序 / 设置总览 | [`22-mobile-settings-overview.png`](22-mobile-settings-overview.png) | [`mobile-settings-overview-approved-v1.png`](../work/mobile-design/settings-overview-v1/mobile-settings-overview-approved-v1.png) | 菜单 / “设置”页头、“账户 / 服务”短分组、修改邮箱与修改密码入口、单行服务状态、无卡片整行列表、细分隔线、中性纸白背景，以及下部留白中的低对比远山亭子 | 图像模型生成的图标像素、固定状态值、截图尺寸，把桌面说明列或账户汇总行压缩进小程序，以及把整张图作为运行时素材 |
| 23 | 微信小程序 / PPT·范围与需求 | [`23-mobile-ppt-range-requirements.png`](23-mobile-ppt-range-requirements.png) | [Figma `3:3`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-3) | 紧凑阶段页头、轻量“已确认范围”摘要、用途与受众选择框、页数预设加自定义、多行补充要求，以及吸底“确认”主操作 | 示例范围与字段值、固定截图尺寸，把表单包成设置卡片、恢复行分割线或设置项式右箭头，以及把整图作为运行时素材 |
| 24 | 微信小程序 / PPT·大纲 | [`24-mobile-ppt-outline.png`](24-mobile-ppt-outline.png) | [Figma `3:4`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-4) | 阶段页头、页数摘要、页面 / 一级要点 / 二级说明的清晰层级、轻量分隔与吸底推进操作 | 示例书名、大纲、页数和辅助文案，固定可见条目数量、把大纲改成设置列表或卡片堆叠，以及把整图作为运行时素材 |
| 25 | 微信小程序 / PPT·编辑大纲 | [`25-mobile-ppt-outline-editing.png`](25-mobile-ppt-outline-editing.png) | [Figma `3:5`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-5) | 接近全屏的高位底部面板、直接编辑分层文本、自动保存状态、明确关闭和吸底“完成编辑” | 示例文本与光标位置、固定面板高度，升级 / 降级 / 删除 / 排序按钮、格式工具栏，以及把整图作为运行时素材 |
| 26 | 微信小程序 / PPT·选择模板 | [`26-mobile-ppt-template-selection.png`](26-mobile-ppt-template-selection.png) | [Figma `3:6`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-6) | 双列真实 `16:9` 封面、模板名称直接作为封面标题、边框加对勾的选中反馈，以及稳定的底部生成操作 | 示例模板名称与封面图形、额外风格说明、单列巨型卡片、非 `16:9` 预览，以及把整图作为运行时素材 |
| 27 | 微信小程序 / PPT·生成中 | [`27-mobile-ppt-generating.png`](27-mobile-ppt-generating.png) | [Figma `3:7`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-7) | “第 N / 总页数”轻量状态、连续单列 `16:9` 页面瀑布流、末尾同尺寸当前页骨架和吸底停止操作 | 示例页数、PPT 文案、装饰图形和骨架行数，尚未开始页面的提前占位，以及把预览或整图作为运行时素材 |
| 28 | 微信小程序 / PPT·生成失败 | [`28-mobile-ppt-generation-failed.png`](28-mobile-ppt-generation-failed.png) | [Figma `3:8`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-8) | 已完成页面继续保留、失败页占用原 `16:9` 位置、原位错误说明、单一“重新生成”主操作和返回修改大纲次操作 | 示例页数、PPT 内容和固定错误原因，拆分内部图片或模板重试策略、清空已完成页面，以及把整图作为运行时素材 |
| 29 | 微信小程序 / PPT·生成完成 | [`29-mobile-ppt-complete.png`](29-mobile-ppt-complete.png) | [Figma `3:9`](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh?node-id=3-9) | 完成状态与总页数、连续 `16:9` 页面瀑布流、“下载 PPTX”唯一主操作，以及更换模板和修改大纲的次级层级 | 示例书名、页数、PPT 文案和装饰图形，把重新生成结果覆盖旧作品、把预览或整图作为运行时素材 |
| 30 | 微信小程序 / 会话·底部半屏多选 | [`30-mobile-conversation-selection-sheet.png`](30-mobile-conversation-selection-sheet.png) | [`01-selection-sheet.png`](../output/ui-design-preview/product-design/mobile-conversation/imagegen-v3-bottom-sheet/01-selection-sheet.png) | 原会话留在遮罩后的空间关系、单一大圆角底部半屏表面、开放式多选列表、成熟复选反馈、底部安全区内唯一“确认”主操作，以及趴宠依附面板左上沿的关系 | 示例书名、消息、选项、时间与任务进度，固定面板高度，图像模型生成的头像 / 趴宠 / 图标 / 字体像素、截图尺寸和整张图作为运行时素材 |
| 31 | 微信小程序 / 会话·确认后普通输入 | [`31-mobile-conversation-confirmed-input.png`](31-mobile-conversation-confirmed-input.png) | [`02-confirmed-normal-input.png`](../output/ui-design-preview/product-design/mobile-conversation/imagegen-v3-bottom-sheet/02-confirmed-normal-input.png) | 选择层关闭后的轻量范围摘要与“修改”入口、紧凑吸底输入面、独立图片入口、稳定发送操作、完整趴宠和下部山亭留白 | 示例范围、消息、书名、时间与任务进度，图像模型生成的头像 / 趴宠 / 图标 / 字体像素、截图尺寸和整张图作为运行时素材 |
| 32 | 微信小程序 / 会话·图片附件输入 | [`32-mobile-conversation-image-attachments.png`](32-mobile-conversation-image-attachments.png) | [`03-image-attachment-input.png`](../output/ui-design-preview/product-design/mobile-conversation/imagegen-v3-bottom-sheet/03-image-attachment-input.png) | 图片在文字输入行上方组成同一输入面、不显示容量计数、浅色轻量移除操作、底边与发送按钮保持锚定，以及趴宠完整覆盖输入框左上边界 | 示例范围、缩略图、消息、书名、时间与任务进度，图中偏大的缩略图和输入面高度、色块式范围摘要，图像模型生成的头像 / 趴宠 / 图标 / 字体像素、截图尺寸和整张图作为运行时素材 |

`08-book-detail-ppt-works.png` 是 2026-08-19 用户明确认可的桌面 Web 书籍详情“PPT 作品”页面参考，尺寸为 `1487×1058`，SHA-256 为 `5944dffa44247538b561381e1f2775ff3a220d59ea3fc1b40abb9ac03f4b2632`。它约束该标签页的内容密度和状态组织，但不覆盖共享视觉、桌面 Web 外壳、冷调 `app-paper`、原始头像与桌宠资产规则，也不自动成为运行时图片素材。

`10-book-detail-laoji-notes.png` 是 2026-08-19 用户明确认可的书籍详情内容列表参考，尺寸为 `1486×1058`，SHA-256 为 `b27d3863033fea8fe39e03d971a44e2b8d672fc2fdc39dfb70e9827dc6eadbdf`。它同时约束“老己笔记”和“划线与想法”的列表节奏，但不改变两类内容各自的字段与交互。两个标签都不设置独立标题，也不把正文首行标题化，因此图中放大的首行只能视为示例瑕疵；“划线与想法”仍按 `SPEC.md` 处理可选定位、只读引用与关联想法。头像、桌宠和背景继续服从原始资产与冷调 `app-paper` 规则。

`11-mobile-conversation-drawer.png` 是 2026-08-19 用户明确认可的微信小程序会话抽屉打开态参考，尺寸为 `853×1844`，SHA-256 为 `9e764e60189845b6f46eb1181c97bbc622a363c067274ae479cfb7a15c68c36e`。它只约束会话导航的布局层级、留白、圆角与下部山亭背景，不扩展为其他小程序页面的通用构图，也不自动成为运行时整图素材；实现必须使用已确认头像资产、统一会话图标和真实数据，并按 `DESIGN-MINIAPP.md` 保证长列表、焦点与触控目标不被装饰背景遮挡。

`13-mobile-conversation-shell.png` 是 2026-08-20 用户纳入的微信小程序通用会话主画面参考，尺寸为 `853×1844`，SHA-256 为 `38569bae11f33492523b3546bed1d9a8e297a9be55a0cbdf23d44f7cf4117d5e`。2026-08-22 用户再次审查后明确撤回其结构化选择、确认按钮和输入框高度样式：这些局部视觉不再属于有效基线，现由 30–32 三张认可参考补齐；13 继续约束整页构图、青瓷层次、非对称留白、桌宠关系和山亭视觉落款。普通对话必须省略任务阶段；实现继续使用已确认头像、另行确认的透明桌宠资产、成熟图标和真实数据，不得直接铺设整张参考图。

`14-mobile-reading-library.png` 是 2026-08-20 用户明确认可并纳入的微信小程序统一书架参考，尺寸为 `853×1844`，SHA-256 为 `3e80d4a9d64567c439ffab09b8e90d0444f0025a794a44e8d4100d69d7465212`。它约束小程序书架的页头、搜索、双列封面密度、进度与来源层级，并与 11、13 共用同一小程序外壳气质；正常内容态不放浮动桌宠或底部导航。图片中的示例书籍、封面、进度和图标仅用于说明层级，运行时必须使用真实书籍数据、真实封面、成熟图标和可访问名称，不得直接铺设整张参考图。

`15-mobile-reading-immersive.png`、`16-mobile-reading-controls.png` 和 `17-mobile-book-introduction.png` 是 2026-08-20 用户明确认可并纳入的微信小程序本地阅读主流程参考。15、16 的尺寸均为 `852×1846`，SHA-256 分别为 `82c09e3849e000dbe3b4a4cf796b1498e9de94efc323a933d1395903652537e3`、`dcaacd30403fabfd8d01d12704ea8b5ab40572ac299f1dd2685756242393df36`；17 的尺寸为 `853×1844`，SHA-256 为 `a847e81aad0d1935cb91586ea761fb8f1abfd6ad905f4f1c2b457056a12d9608`。三图共同约束“介绍首屏 → 上滑翻页 → 沉浸正文 → 轻点呼出操作层”的状态链、纸面色调、正文排版、操作位置和角色组关系；运行时仍须使用真实书籍数据、真实封面、正式字体、成熟图标与已确认透明桌宠资产，不能截取或铺设参考图。

`18-mobile-book-content-highlights.png`、`19-mobile-book-content-notes.png` 和 `20-mobile-book-content-ppt-works.png` 是 2026-08-20 用户明确认可并纳入的微信小程序“书籍内容”底部面板三种状态参考。18 的尺寸为 `852×1846`，19、20 的尺寸均为 `853×1844`；SHA-256 分别为 `2ddebcb614497d88efc79e0bf77197fc26192c5641ea2833d2a7a820cef8152f`、`23d078e390f6fc2b4422587b81b990f50154ca6e98535a94ccf65c418ec76077`、`e76a281751844095d080d8564980f13cc2d0ed7b9112dc3b842f6262b98b19cb`。三图锁定共享面板外壳、分段切换、内容密度和底部工具栏层级；具体数据、排序结果、生成进度和下载可用性继续以 `SPEC.md` 为准，面板须支持内容滚动、动态高度、安全区和五类数据状态，不得按截图固定裁切。

`21-mobile-auth-login.png` 是 2026-08-20 用户明确认可并纳入的微信小程序登录页参考，尺寸为 `841×1871`，SHA-256 为 `65b2028810188027eddea61cb3b6455dca30103cdf607e6434bdbcc54b26bf00`。它约束登录页的单列层级、微信与邮箱的主次关系、趴卧老己的位置、协议区域、文字色阶和背景留白分区；标语固定为“亲爱的老己，爱你哟~”。图片中的角色、印章、图标和文字像素均只用于说明构图，运行时必须使用已确认角色资产、成熟图标、真实文字与可访问名称，不得直接铺设整张参考图。

`22-mobile-settings-overview.png` 是 2026-08-20 用户明确认可并纳入的微信小程序设置总览参考，尺寸为 `853×1844`，SHA-256 为 `ce28f93874444d6877713576716b1395dff6752da36650d6a5792e293f657288`。它约束微信小程序设置页的页头、账户与服务分组、开放式单列入口、状态层级、中性纸白底色和下部山亭留白；小程序不得复用桌面设置稿的说明列、状态中列或“账户与登录方式”汇总行。运行时必须使用成熟图标、真实状态和可访问名称，不得直接铺设整张参考图。

`23-mobile-ppt-range-requirements.png` 至 `29-mobile-ppt-complete.png` 是 2026-08-22 用户明确认可并纳入的微信小程序 PPT 全流程页面参考，均从同一 [Figma 原稿](https://www.figma.com/design/gSFpfW3vLc6XbiW3AzGhSh) 的当前确认节点重新导出，尺寸均为 `430×932`。SHA-256 依次为 `053018567a03dcef79c0c70ba3e0b3d944aa0667694ecc3fd08e714267d84ef3`、`e3b115b90a53b1066ab469455d1e315eed19e1c666f1b08547d0efcf8e7bd11c`、`fb130b9de0aa9f33537ee9219ac01f677ef77a3816d0fd57a199867d1c9f7e74`、`13591782f4ae0ff98d80c3addecbab85ff79825cefb4b8ff61a2a5cde42d6046`、`7c604274a732769251b07f27308dfa66dbfaea16c94e1a79a1af2a7c787ca36b`、`fa5fdc4b6bc36986f268f22328b9178ebb3d1ab18ab035673c1f1fdaaa19c3f8`、`4ed985f4aadafa9769d9e732228cec7768e452de4d9d21598d54bf713e1dc960`。七图共同约束小程序 PPT 的阶段页头、内容密度、控件形态、双列模板、连续大图瀑布流以及生成中 / 失败 / 完成的状态连续性；具体数据、错误原因、页数、键盘避让和动态长度继续以 `SPEC.md` 与 `DESIGN-MINIAPP.md` 为准。

`30-mobile-conversation-selection-sheet.png`、`31-mobile-conversation-confirmed-input.png` 和 `32-mobile-conversation-image-attachments.png` 是 2026-08-22 用户明确认可并纳入的微信小程序会话局部状态参考，尺寸均为 `853×1844`，SHA-256 分别为 `5b231f018b55b535bca2659403d6e46c33e356f129ee4a85ab21fc55d5077728`、`bc286413ddbf0ecd87bde39793b7197e1abea0032891c13eb4356c751863127f`、`8bdb333b34314303fcf01ac37d91bdd80b05844490af64878daf18da1361b0fa`。三图依次补齐底部半屏多选、确认后的普通输入和图片附件输入；局部状态与 13 冲突时以 30–32 为准，具体尺寸、触控目标、动态高度、附件上限与失败保留继续以 `SPEC.md` 和 `DESIGN-MINIAPP.md` 为准。三图是实现参考而不是运行时整图或角色资产。

## 已认可视觉元素，不是运行时资产

| 顺序 | 元素 | 文件 | 原稿 | 可采用 | 不得照搬 |
| --- | --- | --- | --- | --- | --- |
| 12 | 微信小程序 / 对话输入框趴卧桌宠 | [`12-mobile-composer-prone-mascot.png`](12-mobile-composer-prone-mascot.png) | [`laoji-prone-peek-v1.png`](../work/mobile-design/mascot-exploration-v1/laoji-prone-peek-v1.png) | 老己的头像身份、青瓷衣装、微歪头表情、双臂趴靠输入框上沿、双手扶小书、只露头部与少量上半身的低矮探头构图 | 棋盘格背景、方形画布留白、截图像素尺寸，以及把角色当成输入按钮或让它覆盖输入 / 附件 / 发送操作 |

`12-mobile-composer-prone-mascot.png` 是 2026-08-19 用户明确认可的微信小程序对话输入框桌宠造型参考，尺寸为 `1254×1254`，SHA-256 为 `c8c7dac388c2e1437db2f483b7e83837b58020e80932516cf22405a288457721`。本次认可锁定姿态、构图、角色身份与小书道具，但不把文件升级为运行时素材：该 PNG 没有透明通道，棋盘格已经写入像素，开发前仍需另行取得并确认干净透明的独立资产。

## 已确认流程 / 结构，不是完整视觉定稿

| 顺序 | 界面 | 文件 | 仅可参考 |
| --- | --- | --- | --- |
| 04 | 桌面 Web / PPT 大纲编辑工作区 | [`04-ppt-outline-editing.png`](04-ppt-outline-editing.png) | 行式大纲、插入 / 新增页面、阶段和操作结构 |
| 05 | 桌面 Web / PPT 模板选择 | [`02-template-selection.png`](02-template-selection.png) | 模板预览、选中反馈和底部操作结构 |
| 06 | 桌面 Web / PPT 生成中 | [`03-generation-progress-waterfall-v2.png`](03-generation-progress-waterfall-v2.png) | 连续大图瀑布流、当前页骨架和生成进度结构 |
| 07 | 桌面 Web / 微信读书书籍详情 | [`07-weread-book-detail.png`](07-weread-book-detail.png) | 紧凑书籍信息条、PPT 入口、标签与工具区层级、选区工具面、桌宠与气泡位置；产品内容和背景色按 `SPEC.md`、`DESIGN.md`、`DESIGN-WEB.md` |

04–06 缺少或偏离完整视觉定稿中的复古共享外壳，尤其不能继承其书页 Logo、空白左栏、旧头像、会话封面和过淡绿色。实现桌面 Web 时保留上述流程结构，同时以 `02-conversation-and-scope.png`、[`../DESIGN.md`](../DESIGN.md) 和 [`../DESIGN-WEB.md`](../DESIGN-WEB.md) 重建页面主体与左侧远山亭子背景。

`07-weread-book-detail.png` 是 2026-08-19 用户明确指定的桌面 Web 微信读书书籍详情参考图，原稿为 [`weread-book-detail-reference-v1.png`](../output/ui-design-preview/product-design/book-detail/weread-book-detail-reference-v1.png)，尺寸 `1487×1058`，SHA-256 为 `604e0c36ad6f9a80d7e815bdc94eb63c3cfe686ac8de9f364aae3888339dec0e`。该图不是完整视觉定稿：其中“本地导入”、完整正文、目录 / 阅读设置 / 专注阅读和偏暖纸白均不得用于微信读书详情；桌面 Web 只采用表中列出的布局关系，并以 `SPEC.md` 的微信读书内容边界、`DESIGN.md` 的共享规则和 `DESIGN-WEB.md` 的桌面布局规则为准。微信小程序本地阅读不从本图推断；其介绍首屏、沉浸正文、操作层和三种“书籍内容”面板状态统一以 15–20、当前 `SPEC.md`、`DESIGN.md` 和 `DESIGN-MINIAPP.md` 为准。

## PPT 视觉缺口

桌面 Web 目前只有 02 所示“对话 + 范围与需求”具备完整视觉定稿；04、05、06 只完成流程 / 结构确认，仍缺套用共享复古外壳后的完整视觉稿，桌面端生成失败和生成完成工作区也尚无认可页面参考。书籍详情的“PPT 作品”标签已有 08 认可页面参考，但它不替代桌面生成工作区的完成态定稿；对应旧探索稿仍在 [`../output/ui-design-preview/product-design/ppt-flow/`](../output/ui-design-preview/product-design/ppt-flow/)，不得复制回来补齐流程或作为实现依据。

微信小程序 PPT 流程的视觉缺口已经由 23–29 七张认可页面参考补齐；后续设计与开发按 `DESIGN-MINIAPP.md` 和本索引列出的采用点实施，不从桌面流程图或更早的会话截图反向推断。
