# SelfAlone 知识索引

> 本文件是知识查询入口，不是新的需求、视觉或技术事实源。它说明“先查哪份结构化知识、何时追溯原始资料”，避免每次恢复都重新读完整仓库。

## 查询顺序

1. 先读取用户最新要求和 [`PROJECT_STATUS.md`](PROJECT_STATUS.md) 当前活动项。
2. 按问题类型读取下表中的唯一结构化事实源。
3. 只有结构化事实不足、存在冲突或需要核验来源时，才追溯参考图索引、官方文档、代码、测试或 Git 历史。
4. 外部事实可能变化时重新核验，不把旧摘要当成当前事实。

## 结构化知识地图

| 问题 | 先读 | 必要时追溯 |
| --- | --- | --- |
| 当前做什么、做到哪里、为什么阻塞 | [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | 当前 diff、测试与提交 |
| 产品目标、对象、行为、流程、状态、验收 | [`redesign-v2/SPEC.md`](redesign-v2/SPEC.md) | 用户最新明确决定 |
| 共享视觉与端侧视觉 | [`redesign-v2/DESIGN.md`](redesign-v2/DESIGN.md)；目标端的 [`DESIGN-WEB.md`](redesign-v2/DESIGN-WEB.md) 或 [`DESIGN-MINIAPP.md`](redesign-v2/DESIGN-MINIAPP.md) | [`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 中对应原稿与证据 |
| 架构、数据、接口、任务、安全、Harness | [`redesign-v2/TECHNICAL.md`](redesign-v2/TECHNICAL.md) | 当前代码、迁移、测试与官方文档 |
| 协作、授权、台账、Goal 和恢复规则 | [`AGENTS.md`](AGENTS.md) | 用户最新要求 |
| 跨会话稳定结论 | [`MEMORY.md`](MEMORY.md) | 条目中的证据指针 |
| 可复用方法与错误预防 | [`EVOLUTION.md`](EVOLUTION.md) | 对应真实案例、测试或提交 |
| 里程碑范围与顺序 | [`docs/superpowers/plans/2026-08-23-mvp-launch.md`](docs/superpowers/plans/2026-08-23-mvp-launch.md) | [`PROJECT_STATUS.md`](PROJECT_STATUS.md) 当前项 |

## 原始资料边界

- 视觉原稿、认可层级、适用范围、尺寸和哈希只由 [`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 索引；图片本身不能独立定义产品或视觉规则。
- 外部官方资料在结构化事实源中保留直接链接和最近核验信息；需要当前准确性时重新访问官方来源。
- `v1/` 和 Git 历史只用于追溯，不默认恢复为当前规则。
- 当前仓库没有必须单独保存的新原始资料，因此不创建空的 `raw_sources/` 或 `wiki/` 目录；出现第一份真实资料或独立知识页时再按职责创建。

## 知识收录流程

1. 标记来源、范围、版本或日期以及是否可能过期。
2. 将有效结论写入唯一对应的结构化事实源；本索引只增加入口，不复制结论。
3. 若形成跨会话稳定判断，向 `MEMORY.md` 增加证据指针；若形成可复用方法，更新 `EVOLUTION.md`。
4. 检查冲突、重复规则、失效链接、孤立页面和未标明状态的旧结论。

原始资料、Wiki 结论和项目记忆都不能直接改变台账状态；只有当前验收证据可以把工作包推进到 `DONE`。
