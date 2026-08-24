# SelfAlone LLM Wiki 索引

> 本文件是知识查询与收录入口，不是新的产品、视觉、技术或执行事实源。它负责定位结构化事实、必要原始资料、Wiki 页面和收录日志，避免每次恢复都重新读取整个仓库。

## 1. 查询顺序

1. 先读取用户最新要求和 [`TASK_LEDGER.md`](TASK_LEDGER.md) 当前活动项。
2. 按问题类型读取下表中的唯一结构化事实源。
3. 只有结构化事实不足、存在冲突或需要核验来源时，才追溯 Wiki、原始资料、参考图、官方文档、代码、测试或 Git 历史。
4. 外部事实可能变化时重新核验，不把旧摘要当成当前事实。

## 2. 结构化知识地图

| 问题 | 先读 | 必要时追溯 |
| --- | --- | --- |
| 当前做什么、做到哪里、为什么阻塞 | [`TASK_LEDGER.md`](TASK_LEDGER.md) | 当前 diff、测试、提交与环境证据 |
| 产品目标、对象、行为、流程、状态、验收 | [`redesign-v2/SPEC.md`](redesign-v2/SPEC.md) | 用户最新明确决定 |
| 共享视觉与端侧视觉 | [`redesign-v2/DESIGN.md`](redesign-v2/DESIGN.md)；目标端的 [`DESIGN-WEB.md`](redesign-v2/DESIGN-WEB.md) 或 [`DESIGN-MINIAPP.md`](redesign-v2/DESIGN-MINIAPP.md) | [`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 中对应原稿与证据 |
| 架构、数据、接口、任务、安全、Harness | [`redesign-v2/TECHNICAL.md`](redesign-v2/TECHNICAL.md) | 当前代码、迁移、测试与官方文档 |
| 项目背景、技术栈、目录、命令与协作禁区 | [`AGENTS.md`](AGENTS.md) | `package.json`、当前目录与用户最新要求 |
| 写作、执行、判断、验收和落档风格 | [`SKILL.md`](SKILL.md) | 用户最新明确要求 |
| 跨会话稳定结论 | [`MEMORY.md`](MEMORY.md) | 条目中的证据指针 |
| 可复用方法与错误预防 | [`EVOLUTION.md`](EVOLUTION.md) | 对应真实案例、测试或提交 |
| 里程碑范围与顺序 | [`docs/superpowers/plans/2026-08-23-mvp-launch.md`](docs/superpowers/plans/2026-08-23-mvp-launch.md) | [`TASK_LEDGER.md`](TASK_LEDGER.md) 当前项 |

## 3. 当前知识目录

```text
raw_sources/
└── README.md
wiki/
└── README.md
logs/
└── ingestion/
    └── README.md
```

- 当前没有已摄取的原始资料、编译 Wiki 页面或摄取记录；三份 README 只定义边界，不代表已有知识资产。
- 本次三篇上下文治理文章用于更新全局 `adaptive-delivery` Skill，不作为 SelfAlone 产品资料入库。

## 4. 当前知识资产

| 类型 | 当前状态 | 查询入口 |
| --- | --- | --- |
| Raw Sources | 无项目资料 | [`raw_sources/README.md`](raw_sources/README.md) |
| Wiki 页面 | 无编译页面 | [`wiki/README.md`](wiki/README.md) |
| 摄取日志 | 无摄取记录 | [`logs/ingestion/README.md`](logs/ingestion/README.md) |

## 5. SelfAlone 资料边界

- 视觉原稿、认可层级、适用范围、尺寸和哈希只由 [`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 索引；图片本身不能独立定义产品或视觉规则。
- 外部官方资料优先保留直接链接和最近核验时间；只有链接不稳定、审计需要且许可允许时，才把副本放入 `raw_sources/external/`。
- 已删除旧版只在 Git 历史中用于追溯，不默认恢复为当前规则。
- 敏感信息、凭证、个人数据、未经验证的猜测和一次性会话内容不得进入 Wiki。

## 6. 收录入口

后续资料按全局 `adaptive-delivery` Skill 的 Ingest / Query / Lint 流程处理，并更新本索引的“当前知识资产”。项目原始资料、Wiki、日志和记忆都不能直接改变台账状态。
