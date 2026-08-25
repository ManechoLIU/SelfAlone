# M1 desktop shell / M0 conversation visual receipt

Status: `CANDIDATE — waiting for non-author UI/UX re-verification`

- Branch: `codex/m1-desktop-shell-m0`
- Base revision: `0969c33f51daf19474399a723a92b55c1d536f61`
- Source revision for the first corrected capture: `1727f95f4648f53bd454cb83b861f70a4a86b7a5`; the scoped candidate commit is reported with this receipt
- URL: `http://127.0.0.1:4174/#/conversation`
- API: `http://127.0.0.1:4101` backed by isolated local database `selfalone_6afd`; real book/workspace data, no AI call
- Reference: `redesign-v2/design-reference/02-conversation-and-scope.png`
- Reference SHA256: `d84ffbae4a483be35c4c9c32192c05aa6e1ae111c966c6ee01599bcb28fd94f6`

## Current WIP first corrected capture

- Capture source: real Chrome tab screenshot after a fresh navigation to the WIP
- State: `outline`; right h2 `大纲`; active step `大纲`; complete outline controls only in the task panel
- Receipt: [`early-outline-1440x900-dpr2-v2.jpg`](./early-outline-1440x900-dpr2-v2.jpg)
- CSS viewport: `1440 × 900`; browser zoom: `1`; DPR: `2`; physical viewport: `2880 × 1800`
- The Chrome screenshot API writes CSS-pixel JPEG output (`1440 × 900`); the physical viewport above is recorded separately and is not inferred from the JPEG dimensions.
- DOM receipt from the same state: `main outline/template/waterfall = 0/0/0`, `task outline/template/waterfall = 1/0/0`, `document.scrollWidth = 1440`.

## First runnable same-state capture

- Capture source: real Chrome tab screenshot
- CSS viewport: `1440 × 844`
- Browser zoom: `1`
- Device pixel ratio: `1` (explicit viewport override)
- Physical pixels: `1440 × 844`
- Receipt: [`02-same-state-1440x844.jpg`](./02-same-state-1440x844.jpg)

The first-review corrections are represented in the current captures: the compact
mode label is exactly `本地演示 · 不调用 AI` at every tested width; the CTA is
`生成示例大纲`; purpose, audience, and page range are disabled with an explicit
non-submission note; and the seated-reading mascot uses the existing formal
transparent asset at the composer edge.

## Responsive evidence

The four responsive captures use the same requirements state, Chrome tab screenshot, zoom `1`, DPR `1`, and height `844`:

- [`02-requirements-768x844.jpg`](./02-requirements-768x844.jpg)
- [`02-requirements-1024x844.jpg`](./02-requirements-1024x844.jpg)
- [`02-requirements-1200x844.jpg`](./02-requirements-1200x844.jpg)
- [`02-requirements-1440x844.jpg`](./02-requirements-1440x844.jpg)
- [`state-loading-1440x844.jpg`](./state-loading-1440x844.jpg) — real task `running`, `0 / 3`
- [`state-failed-1440x844.jpg`](./state-failed-1440x844.jpg) — one page retained, next page failed
- [`state-completed-1440x844.jpg`](./state-completed-1440x844.jpg) — all three pages completed with download action

The post-fix browser matrix reported `scrollWidth === clientWidth` at all four widths. At CSS `768 × 844`, the real Chrome AX snapshot names the brand (`老己，对话首页`), conversation (`对话`), reading (`读书`), and unavailable settings (`设置（暂不可用）`); the keyboard sequence reaches the brand, all three first-level entries, then reconnect. The settings entry has no `href`, is `aria-disabled="true"`, and has no activation handler. The 768 rail links are 47 × 56px; the compact search input and reconnect actions are at least 44px high.

## Current WIP stage/state receipts

These receipts were captured from the same isolated API and WIP URL with a real
Chrome tab; all current stage bodies are single-source right workspaces and the
center marker counts for outline/template/waterfall are zero:

- [`template-1440x900-dpr1.jpg`](./template-1440x900-dpr1.jpg) — h2 `选择模板`, active step `模板`, template grid only in the task panel.
- [`template-768x844-dpr1.jpg`](./template-768x844-dpr1.jpg) — recent-conversation list hidden; task panel is one DOM node in the next grid row (`grid-column: 2`, top `815px`), document width `768`.
- [`requirements-768x844-dpr1.jpg`](./requirements-768x844-dpr1.jpg) — h2 `范围与需求`; compact `本地演示 · 不调用 AI` is within the first viewport.
- [`completed-1440x900-dpr1.jpg`](./completed-1440x900-dpr1.jpg) — h2 `已生成3页`, active step `生成`, no range summary in the task panel.
- [`failed-1440x900-dpr1.jpg`](./failed-1440x900-dpr1.jpg) — h2 `生成在第3/3页中断`, error code and retained pages in the task panel, no range summary in the task panel.

The API-down/reconnect run is [`offline-outline-1440x900-dpr1.jpg`](./offline-outline-1440x900-dpr1.jpg): the alert measured x=`460`..`972`, y=`84`..`146`, entirely inside the center main x=`436`..`996` below its 84px header; rail, conversation list, and task header remained outside the alert. Before stopping API `4101`, the first outline title was edited to `失败保留测试标题`; the value remained after the failed submit render and after `重新连接`. The online request was `GET /api/v1/workspace` (HTTP `200`); the stopped-API case produced the visible connection alert, and the same request returned after restart. Chrome console logs contained no runtime `error` entries during these captures (only Vite debug and extension setup logs).

At CSS `768 × 844` with the explicit viewport override, Chrome reported DPR `1`, zoom `1`, physical viewport `768 × 844`, `document.scrollWidth = 768`, one `.desktop-task-panel`, and `display:none` for `.desktop-conversation-list`. At CSS `1024 × 768`, `1200 × 800`, and `1440 × 900`, Chrome reported document widths equal to the CSS viewport widths and retained four zones; the 1024/1200/1440 columns were respectively `142/230/292/360`, `142/230/468/360`, and `164/272/560/444`.

The offline/recovery case was also exercised against the isolated API: [`state-failed-offline-768x844.jpg`](./state-failed-offline-768x844.jpg) captures the API-down state. The alert measured x=`86`..`754`, y=`84`..`146` inside the center main x=`72`..`768`, directly below the 84px center header; it did not span the rail or task area. Two completed pages, one failed page, the retained-workspace copy, and the retry action remained visible. A second run typed `离线时仍要保留这段真实输入`, stopped the API, submitted from the composer, and confirmed that the textarea value survived the error render; after the API restarted, `重新连接` removed the banner and restored that same input. The failed-task run likewise restored the same 2-complete/1-failed state.

At CSS `1440 × 844`, the four-zone bounds were rail `0..164`, list `164..436`, center `436..996`, and task `996..1440`. In the requirements state, the formal mascot rect was x=`841`, y=`527.5`, `104 × 104px`, anchored to the composer rect x=`464`, y=`630.5`, `504 × 185.5px`; [`02-same-state-1440x844.jpg`](./02-same-state-1440x844.jpg) is the same-state visual receipt.

## Verification boundary

The current branch server could not use the shared development database because its existing schema lacks `file.original_filename`. Browser evidence therefore uses an isolated local database `selfalone_6afd` on API port `4101`; the Vite page is on port `4174`. This receipt is not a final visual PASS until the non-author review is complete.

## Incremental return/draft/generation WIP receipts

- Source revision: `0e18846f12d17c39cc31a504b768b73378f3008b` plus the current scoped working tree; the final scoped commit is reported separately. URL base: `http://127.0.0.1:4174/#/conversation`. Reference SHA256 remains `d84ffbae4a483be35c4c9c32192c05aa6e1ae111c966c6ee01599bcb28fd94f6`.
- Real Chrome outline return/refresh receipt: [`revision-wip-outline-1440x844-dpr1.jpg`](./revision-wip-outline-1440x844-dpr1.jpg). CSS viewport `1440 × 844`, zoom `1`, DPR `1`, physical viewport `1440 × 844`; right h2 `大纲`, one outline form, center outline marker count `0`, stale-result notice visible, `scrollWidth = clientWidth = 1440`.
- Real Chrome template receipt: [`revision-wip-template-1440x844-dpr1.jpg`](./revision-wip-template-1440x844-dpr1.jpg). Same CSS metrics; right h2 `选择模板`, computed grid columns `181.5px 181.5px`, each preview ratio `1.778` (16:9), `scrollWidth = 1440`.
- Real Chrome generating receipt: [`revision-wip-generating-1440x844-dpr1.jpg`](./revision-wip-generating-1440x844-dpr1.jpg). Same CSS metrics; right h2 `正在生成第3/3页`, two completed pages plus exactly one current skeleton, all inner page ratios `1.778`, center skeleton count `0`.
- Real Chrome compact receipt: [`revision-wip-requirements-768x844-dpr1.jpg`](./revision-wip-requirements-768x844-dpr1.jpg). CSS viewport `768 × 844`, zoom `1`, DPR `1`, physical viewport `768 × 844`; recent list `display:none`, one task panel, mode label `本地演示 · 不调用 AI`, stable brand/conversation/reading/settings AX names, settings has no href and `aria-disabled=true`, `scrollWidth = clientWidth = 768`.
- The browser screenshot capture surface returned raster `1440 × 844` for the three 1440 receipts and `768 × 450` for the compact receipt; these raster dimensions are recorded separately from CSS viewport and physical viewport and are not used to infer layout size.

## Route and short-height WIP receipts

- Source revision: `0e18846f12d17c39cc31a504b768b73378f3008b` plus the current scoped working tree; all captures used the real Chrome tab at `http://127.0.0.1:4174`, zoom `1`, DPR `1`, and the isolated API at `http://127.0.0.1:4101` when online.
- At CSS `1440/1200/1024/768 × 844`, requirements, outline, template, and generating each kept the composer inside the center viewport (`bottom 816–817px`, document overflow `0`); generating showed h2 `正在生成第3/3页` and exactly one same-size skeleton. Stopped at all four widths kept the composer visible (`bottom 816px`), removed readonly, showed `停止后可修改要求` and `保存修改要求`, with overflow `0`.
- A fresh real-task run at CSS `768 × 844` measured the same composer in the normal completed route and explicit `requirements/outline/template/completed` stage routes: composer bottom `816–817.34px`, textarea bottom `764–765.34px`, visible in every case, and horizontal overflow `0`; the compact task panel begins at `844–845.34px`, so the complete stage workspace remains the single document-flow section below the first viewport.
- Direct failed-task retry in Chrome from template created a new task through `POST /api/v1/ppt-tasks`, returned to the completed workspace with three pages, and retained the previous failed task in the database history. Receipt: [`revision-wip-retry-completed-1440x844-dpr1.jpg`](./revision-wip-retry-completed-1440x844-dpr1.jpg).
- Same-source route case: `#/conversation?stage=outline → #/library → #/conversation?stage=outline` retained the single desktop shell, stage `outline`, unsaved title `路由保留标题`, task scroll `247.5px`, and focus `title-0`; browser refresh and back/forward reproduced the same stage, draft, scroll, and focus. No full-page reload is used for hash/popstate routing; the text reader is destroyed on route exit.
- Reader handoff case: real Chrome opened `#/reading/book-development-changan-lychee` (`.text-reader-shell = 1`), then returned to `#/conversation`; the resulting DOM had one `.desktop-app-shell`, zero `.text-reader-shell`, and no horizontal overflow (`1440 = 1440`).
- Offline refresh case: with API `4101` stopped, a fresh reload at `#/conversation?stage=outline` retained title `断网刷新保留标题`, `本地草稿 · 尚未保存`, the center-only connection alert, the composer value `停止后重新确认的要求`, shell presence, and `document.scrollWidth - clientWidth = 0`; the API was restarted afterward. Chrome console had no runtime `error` entries in the online route/retry/short-height checks.
