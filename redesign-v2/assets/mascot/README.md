# 老己桌宠素材

本目录只记录桌宠文件身份；角色造型、摆放和视觉规则以 [`../../DESIGN.md`](../../DESIGN.md) 的“品牌资产与角色视觉”为准，产品行为以 [`../../SPEC.md`](../../SPEC.md) 为准。

| 文件 | 状态 |
| --- | --- |
| `laoji-character-master-v1.png` | 当前标准透明背景角色素材。 |
| `laoji-mascot-seated-reading-transparent-v1.png` | 当前坐姿持书透明运行时素材。 |
| `laoji-mascot-prone-reading-transparent-v1.png` | 当前趴卧扶书透明运行时素材。 |
| `laoji-mascot-seated-reading-approved-v1.png` | 用户确认的坐姿持书造型源图；无 Alpha，仅用于造型溯源。 |
| `laoji-mascot-prone-reading-approved-v1.png` | 用户确认的趴卧扶书造型源图；无 Alpha，仅用于造型溯源。 |
| `laoji-character-master-v1-local-v2.png` | 边缘处理过程稿。 |
| `laoji-character-master-v1-local-v3.png` | 边缘处理过程稿。 |

过程稿只用于追溯，不作为实现默认素材。

`laoji-character-master-v1.png` 是站立角色素材，不能经图像模型改造成坐姿桌宠。坐姿持书和趴卧扶书的确认造型分别以 `laoji-mascot-seated-reading-approved-v1.png`、`laoji-mascot-prone-reading-approved-v1.png` 为准，趴卧构图同时服从 `../../design-reference/12-mobile-composer-prone-mascot.png` 的输入框依附关系。两张源图的棋盘格已经写入像素，不能直接接入界面；运行时分别使用同尺寸、保留原角色像素并经本地前景分割取得真实 Alpha 的 `laoji-mascot-seated-reading-transparent-v1.png`、`laoji-mascot-prone-reading-transparent-v1.png`。
