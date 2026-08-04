# 老己产品方案文档

本目录记录“老己”MVP 的产品、领域和技术方案，供后续 agent 和开发者作为共同上下文使用。

## 当前状态

- 阶段：原型 PRD 与 UI 设计规范已形成，下一步为完整 UI 设计稿；尚未进入开发。
- 产品与交互事实源：`prd/laoji-mvp-prototype-prd.md`。
- 视觉与组件事实源：`ui/laoji-mvp-ui-design-spec.md`。
- 日期：2026-08-04

## 按角色阅读

- UI：先读 `prd/laoji-mvp-prototype-prd.md`，再读 `ui/laoji-mvp-ui-design-spec.md`；不要从 ADR 反推具体视觉参数。
- 开发：先读原型 PRD 确认行为，再读 UI 设计规范实现视觉与组件，最后按需查 `glossary.md` 和相关 ADR。
- 产品与评审：读原型 PRD、`decisions/` 和 `glossary.md`。
- 后续 agent：先读 `self-evolution.md`，再按上述顺序读取产品文档。
- 技术方案阶段：在 UI 原型评审后再使用 `architecture/`，该目录不属于本次原型 PRD 交付。

## 文档规则

- 已确认的选择写入 ADR，未确认的方案只写在讨论记录中，不伪装成事实。
- 供应商能力、第三方接口和合规条款需要在开发前用真实账号和官方资料验证。
- 变更已确认决策时，新增 ADR 或更新原 ADR 的状态与后果，不直接删除历史理由。
- ADR 负责产品和架构决策；`self-evolution.md` 负责工作方法、错误复盘和预防规则。
- 文档状态使用：`提议`、`已接受`、`被替代`、`待验证`；状态必须与证据和用户确认一致。
- 旧 PRD 保留历史，但不得与 `prd/laoji-mvp-prototype-prd.md` 并列作为实现依据。
- 同一条规则只在一个事实源中维护：产品行为写入原型 PRD，具体色值、字体、尺寸和组件表现写入 UI 设计规范，ADR 只记录决策理由与后果。
- 发生冲突时，行为与状态以原型 PRD 为准，视觉呈现以 UI 设计规范为准；不得在实现中自行选择第三种解释。
