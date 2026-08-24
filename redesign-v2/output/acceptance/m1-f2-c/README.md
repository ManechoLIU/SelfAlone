# M1-F2-C 安全首包验收证据

本目录只保存 PDF 阅读器适配器首包的真实输入样本与边界证据，不表示仓库已经具备生产 PDF 页面渲染能力。

## Fixture 矩阵

上游固定为 Mozilla PDF.js 提交 `a570239153c3af4508c3f06348dff35faa313737`。原始文件路径均位于 `test/pdfs/`，仓库采用 Apache License 2.0；许可证副本见 `fixtures/PDFJS-LICENSE.txt`。

| 本地文件 | 用途 | 上游来源 / 构造方式 | SHA-256 |
| --- | --- | --- | --- |
| `fixtures/multi-page-text.pdf` | 3 页、含文本层的真实 PDF | `basicapi.pdf` | `925853d98d67d5dae7473c635f932958e1695ce1029d23b2ecd2531cb65f1f14` |
| `fixtures/scanned-image-only.pdf` | 1 页、仅图像内容的真实 PDF | `images_1bit_grayscale.pdf` | `afbed07b9fe25563b2604b81cd7186c91d4356e5428a05322b8b7eae88301e24` |
| `fixtures/encrypted-password-protected.pdf` | 密码 `test` 的真实加密 PDF | `issue15893_reduced.pdf` | `3c2815853e6fe5c34feb76bb14402cbc46bbd484ecd57b672fc03577d0458ee8` |
| `fixtures/truncated.pdf` | 截断 / 损坏 PDF | `basicapi.pdf` 的前 4096 字节 | `570b916bc28474937c555d62a41a10fa175df5a9c12d6d3af454fe210d2a7673` |

固定上游链接：

- <https://github.com/mozilla/pdf.js/tree/a570239153c3af4508c3f06348dff35faa313737/test/pdfs>
- <https://github.com/mozilla/pdf.js/blob/a570239153c3af4508c3f06348dff35faa313737/LICENSE>

本机 `pdfinfo` 仅用于 fixture 元数据核对：文本样本报告 3 页且未加密，图像样本报告 1 页且未加密，加密样本在无密码时拒绝打开，截断样本报告 xref / trailer 损坏。该工具不进入产品、Worker 或测试假适配器。

“单页失败”不是第五份伪造 PDF。服务测试以 `multi-page-text.pdf` 的 3 页枚举结果为输入，由明确命名的测试假适配器只让第 2 页失败，以验证页级重试与“全部不可渲染才文件失败”。

生产依赖授权门与最小接入计划见 [`DEPENDENCY-RECOMMENDATION.md`](DEPENDENCY-RECOMMENDATION.md)。当前候选没有生产 PDF 解析 / 渲染实现，Web 页面门保持关闭。
