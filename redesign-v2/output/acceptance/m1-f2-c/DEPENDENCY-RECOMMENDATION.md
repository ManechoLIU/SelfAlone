# M1-F2-C 生产 PDF 依赖推荐（待授权）

核对日期：2026-08-25。这里只给出授权门建议，没有安装依赖、修改锁文件或声称生产渲染成立。

## 推荐

建议批准在独立 PDF Worker 中固定使用：

- `pdfjs-dist@6.2.108`：Apache-2.0，npm 解包体积 `34,497,725` 字节，Node 要求 `>=22.13.0 || >=24`。
- `@napi-rs/canvas@1.0.8`：MIT，JS 包解包体积 `125,557` 字节；实际渲染需要平台原生包。Linux x64 glibc 包解包体积 `33,975,707` 字节，Linux arm64 glibc 为 `28,322,822` 字节，macOS arm64 为 `27,108,825` 字节。

当前 Linux x64 生产镜像的直接新增解包体积约 `68.6 MB`（`65.4 MiB`），尚未计入包管理元数据和镜像层放大。PDF.js 官方 Node 示例从文件读取 `Uint8Array`，通过 `pdfDocument.canvasFactory` 渲染并输出 PNG；当前 `pdfjs-dist` 也把 `@napi-rs/canvas` 声明为可选依赖。

官方来源：

- <https://github.com/mozilla/pdf.js>
- <https://github.com/mozilla/pdf.js/blob/a570239153c3af4508c3f06348dff35faa313737/examples/node/pdf2png/pdf2png.mjs>
- <https://www.npmjs.com/package/pdfjs-dist>
- <https://github.com/Brooooooklyn/canvas>

## 为什么选它

- 一套适配器可完成页面枚举、文本层读取和页面图渲染，能覆盖文本型与扫描型 PDF，不需要用检测摘要冒充页面。
- Apache-2.0 + MIT 适合闭源产品分发；只需按许可证保留 LICENSE / NOTICE。相比之下，MuPDF 的常用开源授权为 AGPL 或商业授权；Poppler 常见分发边界为 GPL；两者不适合作为本首包的默认低摩擦选择。
- 与当前 TypeScript / Node 24 Worker 目标一致。代价是原生 canvas 平台包、约 65 MiB 级依赖体积，以及对不可信 PDF 的资源隔离责任。

## 安全与 Worker 资源边界

首次接入必须保留当前代码冻结的硬上限：原文件最大 `50 MiB`、最多 `2,000` 页、单边最大 `4,096 px`、单页最大 `12,000,000` 像素、租约 `30 s`；超限在进入渲染前失败。

建议的初始运行约束（需用真实语料压测后再调整）：

- 只向 `getDocument` 传对象存储读取到的 `Uint8Array`，不接受 PDF 内或请求提供的任意 URL；`useWorkerFetch: false`，Worker 禁网。
- `maxImageSize: 12_000_000`、`canvasMaxAreaInBytes: 48_000_000`、`enableXfa: false`、`useSystemFonts: false`；不接入 viewer 的 PDF JavaScript sandbox。
- 每个 Worker 进程同一时刻只渲染 1 页；单页 10 秒、单文件 60 秒的初始超时，超时终止进程并按页记录可重试失败。
- 容器 / 子进程 RSS 初始上限 `512 MiB`，临时目录配额 `256 MiB`，只读原文件、只写隔离临时目录；Node `worker_threads.resourceLimits` 不覆盖所有原生内存，因此生产环境还需进程或容器级限制。
- 平台原生包必须按部署架构固定版本并保留锁文件完整性；持续跟踪 PDF.js 与原生 canvas 安全公告。渲染进程崩溃不得带倒 API / 调度进程。

`30 s` 租约只是安全首包的接口契约，不是生产 Worker 租约已经完成的证据。真实接入仍必须实现逐页续租、单调 fencing token、单页超时以及可传递到渲染进程的取消 / 强制终止；这些共享持久化与调度改动由项目总控在迁移 / Worker 接缝中完成。

## 获授权后的最小接入计划

1. 由项目总控在 Worker package 与锁文件中固定上述两个版本，并把 domain `pdf-reader` 从共享 package index 导出；不把依赖装进 Web 主包。
2. 新增 `PdfJsReaderAdapter`：文档枚举、每页文本层与 PNG 渲染均由真实库完成；加密、无法解析、页级失败分别映射现有结构化结果。
3. 增加对象缓存写入：先写临时键，校验 `book_files.version` 与租约后原子发布；缓存键继续使用 `accountId/bookId/fileVersion/pageNumber/rendererVersion/尺寸`。
4. 用本目录四类真实 fixture 加可控单页失败 Case 跑 Worker 集成测试，记录峰值 RSS、CPU、耗时与产物尺寸；再补中文字体、超大图片、旋转页和混合文本 / 扫描页。
5. 真实页面图与文本层证据成立后，项目总控再接 `/reading`、`/content/pages`、`/position`、`/notes` 与 Web 共享入口，最后打开真实浏览器页面 UI 验收门。

## 当前 fail-closed 结论

本候选只有 domain / service 策略与明确测试假适配器。没有 `pdfjs-dist`、原生 canvas、页面图产物或真实文本层输出，因此 `M1-F2-C` 仍未完成；当前可提交的是安全首包和生产依赖授权建议。
