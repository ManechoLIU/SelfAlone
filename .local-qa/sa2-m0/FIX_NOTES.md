# SA2-M0 旁路 A：develop + 显式 QA 开关走真 HTTP

默认 **OFF**。无开关时 `develop` 仍走 `DevelopmentClient`（fake），与现网一致。不要把开关写进生产路径，也不要 git push。**不要**宣称 M0/M1 DONE。

## 如何打开开关

优先级（前者覆盖后者）：

1. 调用选项 `qaRealHttp: true`（单测 / 组合入口）
2. 本地 gitignore 文件 `apps/miniapp/runtime-config.local.json` 或 `apps/miniapp/src/runtime-config.local.json`
3. 微信 `extConfig.sa2QaRealHttp`
4. `wx` storage 键 `sa2QaRealHttp`

本地文件示例（不要提交；已加入 `apps/miniapp/.gitignore`）：

```json
{
  "sa2QaRealHttp": true,
  "apiBaseUrl": "http://127.0.0.1:4100"
}
```

微信开发者工具：

- extConfig：`{ "sa2QaRealHttp": true, "apiBaseUrl": "http://127.0.0.1:4100" }`
- 或调试器：`wx.setStorageSync("sa2QaRealHttp", true)`，并把 `apiBaseUrl` 放进 extConfig / 本地 json

开关只在 `environment === "develop"` 生效。`trial` / `release` 忽略它，仍只接受公网 HTTPS origin。

## 如何指向 4100

QA 打开后，`resolveMiniappRuntimeConfig(..., { allowLoopback: true })` **仅**接受：

- `http://127.0.0.1:4100`
- `http://localhost:4100`

（允许末尾 `/`，会归一成无斜杠 origin。）

不接受任意内网 IP、其他端口、HTTPS loopback、IPv6、带 path/query/credentials 的 URL。公网 `https://...` origin 在 QA 下仍可用。

`apiBaseUrl` 来源：`options.apiBaseUrl` > 本地 json（仅 QA 打开时）> extConfig。

此时 library 客户端与 production 同合同：`createLibraryHttpClient`（内含 `PptWorkspaceHttpClient`；`client.development === false`，`client.kind === "production"`）。

## 测试命令

仓库根：

```sh
pnpm --filter @selfalone/miniapp exec vitest run apps/miniapp/src/adapters/index.test.ts apps/miniapp/src/runtime-config.test.ts apps/miniapp/src/app.test.ts
pnpm --filter @selfalone/miniapp typecheck
```

若 filter 不可用：

```sh
cd apps/miniapp && pnpm test
cd apps/miniapp && pnpm typecheck
```

box 等价验证（本环境 pnpm 因 Node 版本不可用）：

```sh
./node_modules/.bin/vitest run apps/miniapp/src/adapters/index.test.ts apps/miniapp/src/runtime-config.test.ts apps/miniapp/src/app.test.ts
./node_modules/.bin/tsc -p apps/miniapp/tsconfig.json --noEmit
```

结果（2026-09-17 16:51 CST）：vitest 3 files / **56 passed**；typecheck **PASS**。

## 改动文件

- `apps/miniapp/src/runtime-config.ts`
- `apps/miniapp/src/runtime-config.test.ts`
- `apps/miniapp/src/adapters/index.ts`
- `apps/miniapp/src/adapters/index.test.ts`
- `apps/miniapp/src/app.ts`
- `apps/miniapp/src/app.test.ts`
- `apps/miniapp/.gitignore`
- `.local-qa/sa2-m0/FIX_NOTES.md`

未改 `apps/server`、`apps/web`，未做模板 / PPTX。

## 基线 / 产物

| 字段 | 值 |
| --- | --- |
| 代码基线 HEAD | `9127163`（Mac PROBE / origin/main 对齐） |
| 产物包 | `/home/box/team/rd/tasks/selfalone-sa2/evidence/SA2-M0/sa2-m0-bypass-a.tgz` |
| Mac 回写脚本 | `evidence/SA2-M0/APPLY_ON_MAC.sh` |
| box 参考 commit | `bfefe33`（detached，基于 `9127163`；**非** Mac 仓） |
| Mac 本地 commit | **待总控 machineId 回写后给出** |
| 状态 | 旁路 A **代码已落地待审查**；**未**标 M0/M1 DONE |

Mac 回写（总控 machineId Shell；子代理无 machineId）：

```bash
# CopyFromBox: evidence/SA2-M0/sa2-m0-bypass-a.tgz → Mac /tmp/
# CopyFromBox: evidence/SA2-M0/APPLY_ON_MAC.sh → Mac /tmp/
bash /tmp/APPLY_ON_MAC.sh /tmp/sa2-m0-bypass-a.tgz
# 不要 push / 不要合 main
```
