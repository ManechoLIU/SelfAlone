# 老己桌宠素材

本目录只记录桌宠文件身份；角色造型、摆放和视觉规则以 [`../../DESIGN.md`](../../DESIGN.md) 的“品牌资产与角色视觉”为准，产品行为以 [`../../SPEC.md`](../../SPEC.md) 为准。

| 文件 | 状态 |
| --- | --- |
| `laoji-character-master-v1.png` | 当前标准透明背景角色素材。 |
| `laoji-character-master-v1-local-v2.png` | 边缘处理过程稿。 |
| `laoji-character-master-v1-local-v3.png` | 边缘处理过程稿。 |

过程稿只用于追溯，不作为实现默认素材。

`laoji-character-master-v1.png` 是站立角色素材，不能经图像模型改造成坐姿桌宠。当前已确认的坐姿持书桌宠原始像素来自 `../../output/ui-design-preview/product-design/settings/settings-service-overview-v8.png`；Compact 对话输入框的趴卧持书造型以 `../../design-reference/12-mobile-composer-prone-mascot.png` 为认可视觉参考。后者没有透明通道且棋盘格已写入像素，因此不是运行时素材；在独立透明素材确认前不得直接接入原型或实现，也不得将棋盘格抠图结果静默标记为已确认资产。
