# SelfAlone 微信小程序运行壳

这个目录是 M2-F0-A 的原生微信小程序基础工作包，覆盖登录、会话外壳、统一书架、自然连续阅读、PPT 四阶段与设置的导航和状态边界。

## 当前边界

- `develop` 环境才启用 `DevelopmentClient`；`trial` 与 `release` 环境会以 `CLIENT_ADAPTER_UNAVAILABLE` 明确失败，不会回退到假服务。
- 开发适配器的书架、阅读位置和 PPT 草稿只在当前小程序运行内存中存活，每个页面都标注了这个边界；它不代表服务端持久化或跨端恢复已接入。
- `state=loading|empty|filtered-empty|failed|normal` 仅用于开发环境的状态验收，不会在非开发环境开启。
- 正文与介绍处于同一条自然纵向滚动流；阅读块只是定位与保存边界，不会造成强制分页或整页吸附。
- 浅色 / 暗色阅读背景会随开发适配器的阅读位置保存在当前运行内存中；切换失败保留当前可见选择并提示，不代表服务端持久化或跨端恢复。
- 真实账户、书架 / 导入、正文 / 笔记 / 跨端位置、会话 / 额度和 PPTX 产物由后续工作包逐项替换当前适配器。

## 本地验证

从仓库根目录运行：

```sh
./node_modules/.bin/tsc -p apps/miniapp/tsconfig.json --noEmit
./node_modules/.bin/vitest run apps/miniapp/src
./node_modules/.bin/tsc -p apps/miniapp/tsconfig.build.json
```

然后把 `src/` 中的 WXML、WXSS、JSON 和资产复制到 `dist/`，并用微信开发者工具导入本目录。`project.config.json` 已将 `miniprogramRoot` 设为 `dist/`。稳定版开发者工具的本机私有配置不进入 Git。

`project.config.json` 将微信基础库固定为本轮验收使用的 `3.17.1`。它与运行时 `wx.getAccountInfoSync().miniProgram.envVersion` 是两套独立概念：后者才决定 `develop` 启用内存适配器，`trial` / `release` 仍按 fail-closed 边界运行。

`package.json` 也保留了等价的 `build` / `typecheck` / `test` 命令；由于本工作包不得修改根锁文件，最终验证使用上述根目录已安装的二进制。

## 运行时资产溯源

下列 PNG 是已确认源资产的本地等比缩小派生文件，仅为让小程序主包保持在 2 MiB 内；没有复制任何参考截图、截图文字或伪图标。

| 运行文件 | 尺寸 | 运行文件 SHA-256 | 已确认源文件 SHA-256 |
| --- | ---: | --- | --- |
| `assets/avatar/laoji-avatar.png` | 192×192 | `6f9ec73dc79aae78e79a00963f36adffc981aa058c208b48ecbbc796cc891457` | `2240c8ceb40922b4c289a1515ecd347d1c9a4d4c48ae16e734c9084328b4666a` |
| `assets/mascot/laoji-prone-reading.png` | 384×384 | `56db1f532b9348211ab3def600a4f93e25c31a587615f1bf368d4b76aa4cd9c5` | `92fe6c1c35cad88d654075dfd71e2af4a693ba66a6e3cca110dc6d4f65870854` |
| `assets/book-covers/local-default-amber-lamp-v1.png` | 365×512 | `7051d8ddff9b94f68d69781d9f1e81fbea921906ff087f271f0e2c884499294c` | `dde0cec465fcf131cea06e55f1b22951cc23e2cec4be2774f61f246a2c9fa1d1` |
| `assets/book-covers/local-default-celadon-ink-v1.png` | 365×512 | `937032abe4298286709818fd0ce298a2228d6cb698d8a64c38441891c8e4a1de` | `b7c79385b385b404155b89ca685e90ac5e2f6887d7cc10e71d7cc0fb3351eae8` |
| `assets/book-covers/local-default-indigo-sea-v1.png` | 365×512 | `552a4530f14911641f0908133307ecf3acaf1558549835133df324b0b5c76278` | `e539f0db602a10383e0ff86f7b2905708b5c959f5d1f0c4c3440322b61d42d52` |

线性图标来自 Remix Icon，详见 `THIRD_PARTY_NOTICES.md`。
