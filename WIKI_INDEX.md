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

## 3. 规划目录

以下是首份真实资料到来后的目标结构；目录在有内容时才创建，不保留空壳：

```text
knowledge/
├── raw_sources/
│   ├── product/
│   ├── design/
│   ├── technical/
│   └── external/
├── wiki/
│   ├── topics/
│   ├── entities/
│   └── decisions/
└── logs/
    └── ingestion/
```

- `raw_sources/`：保存允许入库、无法只靠链接稳定复核的原始资料；只读保留，不在原件上改写结论。
- `wiki/`：整合两份以上来源的可查询知识页；不复制当前事实源正文，也不承载任务状态。
- `logs/ingestion/`：记录资料进入、更新、替代、冲突或失败的审计信息；不保存聊天流水、凭证、敏感数据或完整工具输出。
- 当前仓库没有需要单独落档的新原始资料，因此本次不创建上述空目录。

## 4. 命名、页面和日志字段

- 原始资料文件名：`YYYY-MM-DD-来源-主题.ext`；同日同主题有多个版本时追加可核验版本号或短哈希。
- Wiki 页面文件名：稳定主题的英文短横线名，例如 `account-ownership.md`；页面必须包含 `范围 / 状态 / 摘要 / 来源 / 最近核验 / 相关事实源 / 复核触发`。
- 收录日志文件名：`YYYY-MM-DD.md`；每条记录包含 `时间 / 来源 / 版本或哈希 / 保存位置 / 提取结论 / 冲突 / 去向 / 经办者 / 状态`。
- 状态至少区分 `CURRENT / SUPERSEDED / UNVERIFIED`；被替代内容保留指向新版本，不与当前结论并列生效。

## 5. 原始资料边界

- 视觉原稿、认可层级、适用范围、尺寸和哈希只由 [`redesign-v2/design-reference/README.md`](redesign-v2/design-reference/README.md) 索引；图片本身不能独立定义产品或视觉规则。
- 外部官方资料优先保留直接链接和最近核验时间；只有链接不稳定、审计需要且许可允许时，才把副本放入 `raw_sources/external/`。
- 已删除旧版只在 Git 历史中用于追溯，不默认恢复为当前规则。
- 敏感信息、凭证、个人数据、未经验证的猜测和一次性会话内容不得进入 Wiki。

## 6. 后续资料进入 Wiki

1. 登记来源、授权范围、主题、版本或日期、可变性与敏感性。
2. 判断是否需要保存原件；需要时按类别写入 `raw_sources/`，同时记录哈希，不允许时只保留可核验链接。
3. 提取事实并先写入唯一对应的权威文档；发现冲突时标记 `UNVERIFIED`，不得静默覆盖。
4. 只有需要跨来源查询时才创建或更新 `wiki/` 页面，并为每个结论附来源与最近核验信息。
5. 跨会话仍稳定且可复用的结论写入 `MEMORY.md`；可复用方法写入 `EVOLUTION.md`。
6. 在 `logs/ingestion/` 记录本次进入、更新、替代或拒收结果，再更新本索引的入口。
7. 检查重复规则、失效链接、孤立页面、未标状态的旧结论和意外敏感信息。

原始资料、Wiki、日志和项目记忆都不能直接改变台账状态；只有当前验收证据可以把工作包推进到 `DONE`。
