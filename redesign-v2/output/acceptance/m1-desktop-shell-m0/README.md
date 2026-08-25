# M1 desktop shell / M0 conversation visual receipt

Status: `CANDIDATE — waiting for non-author UI/UX re-verification`

- Branch: `codex/m1-desktop-shell-m0`
- Base revision: `0969c33f51daf19474399a723a92b55c1d536f61`
- URL: `http://127.0.0.1:4174/#/conversation`
- State: requirements draft for the isolated local workspace; real book/workspace data, no AI call
- Reference: `redesign-v2/design-reference/02-conversation-and-scope.png`
- Reference SHA256: `d84ffbae4a483be35c4c9c32192c05aa6e1ae111c966c6ee01599bcb28fd94f6`

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

The offline/recovery case was also exercised against the isolated API: [`state-failed-offline-768x844.jpg`](./state-failed-offline-768x844.jpg) captures the API-down state. The alert measured x=`86`..`754`, y=`84`..`146` inside the center main x=`72`..`768`, directly below the 84px center header; it did not span the rail or task area. Two completed pages, one failed page, the retained-workspace copy, and the retry action remained visible. A second run typed `离线时仍要保留这段真实输入`, stopped the API, submitted from the composer, and confirmed that the textarea value survived the error render; after the API restarted, `重新连接` removed the banner and restored that same input. The failed-task run likewise restored the same 2-complete/1-failed state.

At CSS `1440 × 844`, the four-zone bounds were rail `0..164`, list `164..436`, center `436..996`, and task `996..1440`. In the requirements state, the formal mascot rect was x=`841`, y=`527.5`, `104 × 104px`, anchored to the composer rect x=`464`, y=`630.5`, `504 × 185.5px`; [`02-same-state-1440x844.jpg`](./02-same-state-1440x844.jpg) is the same-state visual receipt.

## Verification boundary

The current branch server could not use the shared development database because its existing schema lacks `file.original_filename`. Browser evidence therefore uses an isolated local database `selfalone_6afd` on API port `4101`; the Vite page is on port `4174`. This receipt is not a final visual PASS until the non-author review is complete.
