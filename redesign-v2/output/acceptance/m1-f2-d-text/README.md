# M1-F2-D-TEXT 共享集成候选收据

本候选闭合文本标注的共享 contracts、domain export、PostgreSQL migration、server runtime/routes、account resolver 和 text publisher 接缝；不包含 Web、Mini Program、视觉、PDF 或引用到会话。

## 已验证

- `TextLocator` / `ReadingLocator` 继续来自 `packages/contracts`；文本首包只接受 `kind: "text"`。划线与无标题手工笔记使用统一 `highlights` / `notes` 表，创建幂等键按 account + book 唯一。
- 正式 migration 位于 `infra/migrations/20260825_text_annotations.sql`，由 `apps/server/src/text-annotation-migration.ts` 在生产组合入口中、runtime readiness 前执行；同名 advisory lock、错误同名表 / DDL 和 receipt 回滚有真实 PostgreSQL 测试。
- annotation 写事务与 publisher 统一按 `books → current book_files` 加锁；同 fileVersion 且 section、title、body、order、count 全一致时 no-op，任何漂移 fail closed，不删除或重插已有 section。
- `updateNote` 无法读取服务端既有 note 时返回 `NOTE_SOURCE_UNVERIFIED`，保留草稿正文但不把客户端 source 冒充为已验证来源。

## 验证命令

```bash
pnpm exec vitest run apps/server/src/text-annotation-migration.test.ts
pnpm exec vitest run apps/server/src/text-annotation-runtime.test.ts
pnpm exec vitest run apps/server/src/text-annotation-integration.test.ts
pnpm exec vitest run apps/server/src/text-reader.test.ts
pnpm typecheck
pnpm test
pnpm build
```

集成测试使用真实 PostgreSQL 隔离 schema，覆盖 owner/fileVersion 隔离、真实路由、重启恢复、幂等并发、section FK、发布 no-op / 漂移拒绝、publisher 与 annotation mutation 交错及 migration 并发。该收据不代替 Web 真实浏览器验收，也不表示父项 D 已完成。
