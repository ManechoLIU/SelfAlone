const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const pages = [
  ['chat', 'laoji-chat.html'],
  ['materials', 'laoji-ppt-materials.html'],
  ['outline', 'laoji-ppt-outline.html'],
  ['preview', 'laoji-ppt-preview.html']
].map(([name, file]) => ({ name, file, html: fs.readFileSync(path.join(prototypeDir, file), 'utf8') }));

const conversationId = 'ppt-conversation-atomic-habits';

for (const { name, file, html } of pages) {
  assert.match(html, /href="assets\/laoji\.css\?v=20260814-unified-shell-r3"/, `${name} (${file}) 必须引用当前统一壳层样式版本，避免预览继续命中旧缓存`);
  assert.match(html, /src="assets\/laoji\.js\?v=20260814-unified-shell-r3"/, `${name} (${file}) 必须引用当前桌面壳交互脚本版本，避免恢复旧控制状态`);
  assert.match(html, /src="assets\/laoji-navigation\.js\?v=20260814-unified-shell-r3"/, `${name} (${file}) 必须引用当前全局导航状态控制器`);
  assert.match(html, /<body[^>]*class="[^"]*ppt-conversation-page/, `${name} (${file}) 必须声明 PPT 会话页`);
  assert.match(html, new RegExp(`data-ppt-conversation-id="${conversationId}"`), `${name} (${file}) 必须使用统一 conversation id`);
  assert.match(html, /<main[^>]*data-ppt-desktop-shell[^>]*data-session-mode="collapsed"/, `${name} (${file}) 必须提供收起态桌面连续壳`);
  assert.match(html, /<nav[^>]*id="ppt-primary-nav"[^>]*aria-label="主导航"/, `${name} (${file}) 必须有主导航目标`);
  assert.match(html, /<button[^>]*type="button"[^>]*data-ppt-session-toggle[^>]*aria-expanded="false"[^>]*aria-controls="ppt-session-panel"[^>]*aria-label="展开会话列表"/, `${name} (${file}) 必须提供图标化且可访问的会话列表按钮`);
  assert.match(html, /<aside[^>]*id="ppt-session-panel"[^>]*data-ppt-session-panel[^>]*aria-label="PPT 会话列表"/, `${name} (${file}) 必须提供 PPT 会话列表面板`);
  assert.match(html, /<main[^>]*data-ppt-desktop-shell[^>]*>\s*<aside[^>]*id="ppt-session-panel"/, `${name} (${file}) 会话列表必须是桌面栅格壳的直接首个子项`);
  assert.match(html, /<section[^>]*data-ppt-chat-pane[^>]*>[\s\S]*?data-ppt-conversation-timeline[^>]*aria-live="polite"/, `${name} (${file}) 必须提供可播报的对话时间线`);
  assert.match(html, /<(?:section|aside)[^>]*data-ppt-workbench-panel[^>]*>[\s\S]*?<button[^>]*type="button"[^>]*data-ppt-workbench-toggle[^>]*aria-expanded="true"[^>]*aria-label="收起作品工作台"/, `${name} (${file}) 必须提供展开的作品工作台及收起按钮`);
  assert.match(html, /aria-current="page"[\s\S]*?(?:当前|确认|编辑|模板|生成|进行中|已完成|待)/, `${name} (${file}) 当前会话必须同时有 aria-current 和可见文字状态`);
}

for (const target of ['laoji-ppt-materials.html', 'laoji-ppt-outline.html', 'laoji-ppt-preview.html']) {
  assert.match(pages[0].html, new RegExp(`href="(?:\./)?${target}\\?conversation=${conversationId}"`), `chat 必须原生链接到 ${target} 并透传会话身份`);
}

const css = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.css'), 'utf8');
const js = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.js'), 'utf8');
const navigation = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji-navigation.js'), 'utf8');

for (const functionName of [
  'initPptDesktopShell',
  'setPptSessionMode',
  'setPptWorkbenchOpen',
  'isPptSingleTaskViewport',
  'getPptConversationId',
  'ensurePptConversation',
  'renderPptConversationTimeline',
  'appendPptConversationMessage',
  'advancePptConversation',
  'propagatePptConversationRoute'
]) {
  assert.match(js, new RegExp(`function ${functionName}\\(`), `共享脚本必须提供 ${functionName} 接口`);
}

assert.match(css, /\.ppt-conversation-page[^{}]*\.ppt-continuous-shell[^{}]*\{/s, '桌面 PPT 壳的布局规则必须限定在 PPT 会话页');
assert.match(css, /--global-nav-collapsed:\s*64px/, '桌面壳必须复用 64px 全局导航轨');
assert.match(css, /--ppt-chat-width:\s*clamp\(360px,\s*31vw,\s*430px\)/, 'PPT 桌面壳必须使用约束后的会话区宽度');
assert.match(css, /--ppt-session-width:\s*240px/, 'PPT 桌面壳必须使用 240px 会话上下文栏宽度 token');
assert.match(
  css,
  /\.chat-page\.ppt-conversation-page\s+\.ppt-continuous-shell\[data-workbench-open="true"\]\s+\.topbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+44px\s+auto;[\s\S]*?padding-inline:\s*16px;/,
  '普通对话内展开 PPT 工作台时，窄会话页头必须保留弹性标题列并压缩次级操作'
);
assert.match(
  css,
  /\.chat-page\.ppt-conversation-page\s+\.ppt-continuous-shell\[data-workbench-open="true"\]\s+\.topbar\s+\.topbar-title\s+h1\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  '窄会话页头标题必须单行省略，不能被挤成逐字竖排'
);
assert.match(
  css,
  /\.chat-page\.ppt-conversation-page\s+\.ppt-continuous-shell\[data-workbench-open="true"\]\s+\.topbar\s+\.ai-status\s*\{[\s\S]*?width:\s*44px;[\s\S]*?font-size:\s*0;/,
  '窄会话页头必须把 AI 状态收敛为保留可访问名称的 44px 状态入口'
);
assert.match(
  css,
  /\.chat-page\.ppt-conversation-page\s+\.ppt-continuous-shell\[data-workbench-open="true"\]\s+\.ppt-book-picker\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  '窄会话栏中的书籍选择器必须改为两列，不能把四张封面压成窄条'
);
assert.match(
  css,
  /\.ppt-conversation-page\s+\.scope-workbench-head\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;/,
  '材料工作台页头必须为标题、保存状态和折叠操作声明同一行的三个列位'
);
assert.match(
  css,
  /@media\s*\(max-width:\s*767px\)[\s\S]*?\.ppt-conversation-page\s+\.scope-workbench-head\s+\.ppt-workbench-toggle\s*\{\s*display:\s*none;/,
  '手机作品层已有返回入口时不得再显示重复的工作台折叠按钮'
);
assert.match(
  css,
  /@media\s*\(max-width:\s*767px\)[\s\S]*?\.ppt-conversation-page\s+\[data-ppt-chat-shell\]\[data-mobile-view="artifact"\]\s+\[data-ppt-workbench-panel\]\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?transform:\s*translateX\(0\);/,
  '手机作品层必须依据共享壳层 data 属性进入视口，不能依赖只有部分页面具备的类名'
);
assert.match(
  css,
  /@media\s*\(max-width:\s*767px\)[\s\S]*?\.ppt-conversation-page\s+\.scope-workbench-head\s*\{[\s\S]*?grid-template-columns:\s*74px\s+minmax\(0,\s*1fr\)\s+auto;[\s\S]*?\.scope-workbench-head\s+\.save-status\s*\{\s*grid-column:\s*3;/,
  '手机材料页头必须恢复返回、标题、状态三列，并为带文字返回控件保留完整列宽'
);
assert.match(css, /@media\s*\(min-width:\s*1280px\)[\s\S]*?\.ppt-conversation-page[\s\S]*?data-session-mode/s, '1280px 以上必须声明会话与作品并列布局');
assert.match(css, /@media\s*\(min-width:\s*1024px\)\s*and\s*\(max-width:\s*1279px\)[\s\S]*?\.ppt-conversation-page[\s\S]*?(?:drawer|overlay|position:\s*fixed)/is, '1024–1279px 会话列表必须以临时抽屉承载');
assert.match(css, /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.ppt-conversation-page[\s\S]*?(?:display:\s*block|single-task)/is, '1023px 以下必须保留单任务移动/平板模型');

assert.match(js, /setPptSessionMode\([\s\S]*?dataset\.sessionMode\s*=\s*mode/, '会话模式切换必须同步 DOM data-session-mode');
assert.match(js, /setPptSessionMode\([\s\S]*?aria-expanded[\s\S]*?hidden[\s\S]*?inert/, '会话抽屉切换必须同步 aria-expanded、hidden 与 inert');
assert.match(js, /event\.key === ['"]Escape['"][\s\S]*?setPptSessionMode\([\s\S]*?collapsed[\s\S]*?focus\(\)/, '临时会话抽屉必须支持 Escape 关闭并还焦点');
assert.match(js, /setPptWorkbenchOpen\([\s\S]*?dataset\.workbenchOpen\s*=\s*String\(isOpen\)/, '作品工作台开合必须同步 data-workbench-open');
assert.match(js, /setPptWorkbenchOpen\([\s\S]*?data-ppt-stage-host[\s\S]*?(?:continuation|继续|stage-card)/is, '收起作品区必须复用已有阶段卡作为唯一继续入口');
assert.match(js, /setPptWorkbenchOpen\([\s\S]*?hidden\s*=\s*!isOpen[\s\S]*?aria-expanded/, '作品区开合必须同步 hidden 与 aria-expanded');
assert.match(js, /currentConversation\?\.ui\?\.sessionListMode[\s\S]*?currentConversation\.revision|currentConversation\.revision[\s\S]*?currentConversation\?\.ui\?\.sessionListMode/, '会话列表状态必须从 ui.sessionListMode 按当前 revision 持久化');
assert.match(js, /currentConversation\?\.ui\?\.workbenchOpen[\s\S]*?currentConversation\.revision|currentConversation\.revision[\s\S]*?currentConversation\?\.ui\?\.workbenchOpen/, '作品区状态必须从 ui.workbenchOpen 按当前 revision 持久化');
assert.match(navigation, /laoji-global-nav-expanded[\s\S]*?dataset\.globalNavExpanded/, '一级导航状态必须跨模块恢复，不能归属某个 PPT 会话');
assert.doesNotMatch(js, /navExpanded:\s*expanded|dataset\.pptNavExpanded/, 'PPT 会话状态不得持有一级导航开合状态');
assert.match(js, /isPptSingleTaskViewport\([\s\S]*?matchMedia\([\s\S]*?1023px/, '单任务视口判断必须覆盖 1023px 断点');
assert.match(js, /function setPptMobileView\([\s\S]*?view === ['"]artifact['"] && isPptSingleTaskViewport\(\)[\s\S]*?setPptWorkbenchOpen\(shell, true\)/, '手机或平板进入作品视图时必须重新显示曾在桌面收起的作品面板');
assert.match(js, /function setPptMobileView\([\s\S]*?view === ['"]chat['"][\s\S]*?min-width:\s*768px[\s\S]*?max-width:\s*1023px[\s\S]*?setPptWorkbenchOpen\(shell, false\)/, '平板返回对话时必须同步关闭作品面板，不能只修改手机滑入层状态');
assert.match(css, /transition:\s*(?:width|opacity)[^;]*\b(?:160|180|200)ms/, '桌面壳动效只允许短时宽度/透明度过渡');
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?(?:ppt|session|workbench)/i, '桌面壳动效必须尊重 prefers-reduced-motion');
assert.match(js, /params\.set\('conversation', conversation\.id\)/, '阶段路由必须透传同一 conversation id');
assert.match(js, /function renderPptConversationTimeline\([\s\S]*?createElement[\s\S]*?textContent/, '累计消息必须使用安全 DOM API 渲染');
assert.match(js, /function advancePptConversation\(conversation, stage, message\)/, '阶段推进必须由共享函数完成');
assert.doesNotMatch(js, /timeline\.innerHTML\s*=\s*message\.text/, '消息正文不得通过 innerHTML 注入');
assert.match(js, /function isCurrentConversationGenerationRun\([\s\S]*?latest\.draft\?\.taskId === currentRecord\.id/, '异步生成回调必须校验当前会话绑定的任务，避免过期任务回写');

console.log('laoji-desktop-ppt-continuity: all tests passed');
