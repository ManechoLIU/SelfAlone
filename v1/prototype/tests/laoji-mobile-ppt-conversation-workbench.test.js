const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(prototypeDir, file), 'utf8');

const materials = read('laoji-ppt-materials.html');
const chat = read('laoji-chat.html');
const outline = read('laoji-ppt-outline.html');
const preview = read('laoji-ppt-preview.html');
const css = read('assets/laoji.css');
const js = read('assets/laoji.js');

assert.match(chat, /data-ppt-chat-shell[^>]*data-mobile-view="chat"/, '普通对话应承载同页 PPT 工作台');
assert.match(chat, /<button[^>]*data-confirm-book/, '选书确认应是原地操作按钮');
assert.doesNotMatch(chat, /<a[^>]*data-confirm-book[^>]*href="laoji-ppt-materials\.html/, '普通对话选书不得跳转材料页');
assert.match(chat, /data-ppt-scope-workbench[^>]*hidden/, '普通对话应预置可原地展开的范围工作区');
assert.match(chat, /data-generate-outline[^>]*aria-label="确认范围并生成大纲"[^>]*>生成大纲<\//, '范围工作区只保留一个明确主操作，并以无障碍名称补足完整含义');
assert.match(chat, /data-ppt-stage-host/, '普通对话应预留连续 PPT 阶段任务卡位置');
assert.match(materials, /data-ppt-workbench="materials"/, '书籍详情入口应复用连续会话工作台');
assert.match(materials, /data-ppt-scope-workbench/, '材料入口应显示与普通对话一致的范围工作区');
assert.match(materials, /data-material-form[^>]*data-outline-direct-navigation/, '材料页确认后应直接进入大纲');
assert.match(materials, /<button[^>]*type="submit"[^>]*data-generate-outline/, '材料页确认操作必须提交范围表单并触发大纲生成流程');
assert.match(materials, /<noscript><a[^>]*href="laoji-ppt-outline\.html\?conversation=ppt-conversation-atomic-habits"/, '材料页应保留无脚本时带当前会话身份的大纲导航兜底');
assert.match(materials, /<button[^>]*data-generate-outline[^>]*aria-label="确认范围并生成大纲"[^>]*>生成大纲<\/button>/, '材料页主操作应使用简洁可见文案和完整可访问名称');
assert.doesNotMatch(materials, /原子习惯 · 读书 PPT|草稿已保存|补充要求可继续在左侧对话中发送/, '材料工作台应移除重复身份、静态状态和帮助句');
assert.doesNotMatch(materials, /第 1 步|第 2 步|<h2>分享要求<\/h2>/, '范围确认不应拆成重复的两轮大卡片');
assert.match(outline, /data-outline-document/, '大纲页应提供移动端连续文档');
assert.match(materials, /data-ppt-stage-card[^>]*data-ppt-stage="scope"/, '范围页返回对话后应保留待确认范围任务卡');
assert.match(outline, /data-ppt-stage-card[^>]*data-ppt-stage="outline"/, '大纲页应在消息流中保留大纲待确认任务卡');
assert.match(outline, /data-mobile-artifact-actions/, '大纲页应提供独立底部作品操作栏');
assert.match(preview, /data-mobile-template-rail/, '预览页模板应提供移动端双列浏览容器');
assert.match(preview, /data-ppt-stage-card[^>]*data-ppt-stage="template"/, '模板页应在消息流中保留待选择模板任务卡');
for (const page of [materials, outline, preview]) {
  assert.doesNotMatch(page, /class="message-bubble"[^>]*>\s*<p[^>]*>[^<]*<\/p>\s*<[^>]*data-ppt-stage-card/, '阶段任务卡不得嵌套在消息气泡中');
}
assert.match(preview, /class="preview-template-tools"[\s\S]*?data-od-id="template-selection"[\s\S]*?class="ppt-preview-section preview-ready-main"/, '桌面预览应按评审稿把模板工具栏放在瀑布流左侧');
assert.doesNotMatch(preview.match(/data-preview-state="ready"[\s\S]*?data-preview-state="generating"/)?.[0] || '', /制作流程/, '模板选择态不应保留重复的制作流程卡片');
assert.match(preview, /class="artifact-title"><h2 data-preview-heading>模板与生成<\/h2><span class="artifact-page-count">5 页<\/span>/, '桌面工具栏应合并标题与页数并支持状态化标题');
assert.doesNotMatch(preview, /class="ppt-preview-section preview-ready-main"[^>]*><div class="section-head">/, '预览瀑布流前不应保留单独的页数空白行');
assert.doesNotMatch(preview, /class="preview-state-tools"/, '开始生成后不应继续显示模板或制作流程侧栏');
for (const stateName of ['generating', 'error', 'complete']) {
  const stateStart = preview.indexOf(`data-preview-state="${stateName}"`);
  const stateEnd = preview.indexOf('data-preview-state="', stateStart + 20);
  const stateRegion = preview.slice(stateStart, stateEnd === -1 ? undefined : stateEnd);
  assert.doesNotMatch(stateRegion, /preview-template-tools|制作流程|data-template=/, `${stateName} 状态应让作品瀑布流独占工作区`);
  assert.match(stateRegion, /preview-state-meta[\s\S]*?data-current-template-name/, `${stateName} 状态应保留紧凑的当前模板信息`);
}
assert.match(preview, /data-ppt-waterfall/, '预览与生成应使用纵向瀑布流');
assert.doesNotMatch(preview, /data-mobile-preview-controls|上一页|下一页/, '移动端不应保留逐页翻页控制');
assert.match(preview, /data-mobile-artifact-actions/, '预览页应提供状态化底部作品操作栏');
assert.match(preview, /\.preview-state-content \.ppt-waterfall \{ width: min\(920px, 100%\)/, '生成、失败和完成瀑布流应使用完整作品区并保留舒适阅读上限');
assert.match(preview, /@media \(max-width: 767px\)[\s\S]*?\.preview-state-workspace \{ display: block; \}/, '手机生成与完成状态应保持单列作品层');

assert.match(js, /function setPptMobileView\(shell, nextView\)/, 'PPT 会话应共享移动视图切换函数');
assert.match(js, /function openScopeWorkbench\(book\)/, '选书后应在当前会话打开范围工作区');
assert.match(js, /thread\.append\(userRow, assistantRow\)/, '选书后应在当前消息流追加用户与助手气泡');
assert.match(js, /selectedBook\.className = 'ppt-selected-book-inline'[\s\S]*?selectedStatus\.textContent = '已选择'/, '普通对话选书确认应保留紧凑书籍身份与明确状态');
assert.match(js, /thread\.append\(userRow, assistantRow\)[\s\S]*?thread\.append\(stageHost\)/, '当前阶段任务卡应位于书籍确认与助手承接消息之后');
assert.match(js, /createPptStageCard\([\s\S]*?'scope'/, '选书后应创建可恢复的待确认范围任务卡');
assert.doesNotMatch(js, /confirm\.href = `laoji-ppt-materials\.html\?book=/, '共享脚本不得把选书确认重写为页面跳转');
assert.match(js, /laoji-ppt-chat-scope-open/, 'AI 配置往返后应恢复当前会话工作区');
assert.match(js, /!configured && !directOutlineNavigation/, '只有显式标记的材料页可绕过 AI 配置拦截');
assert.match(js, /document\.body\.classList\.toggle\('ppt-artifact-open'/, '进入作品层时应锁定背景滚动');
assert.match(js, /shell\.dataset\.chatScrollTop/, '进入作品层前应保存对话滚动位置');
assert.match(js, /shell\._pptArtifactTrigger[\s\S]*?\.focus\(\)/, '退出作品层后应把焦点还给阶段任务入口');
assert.match(js, /document\.documentElement\.scrollLeft = 0;[\s\S]*?document\.body\.scrollLeft = 0;[\s\S]*?window\.scrollTo\(0, window\.scrollY\)/, '移动作品层切换后应清除浏览器保留的横向滚动偏移');
assert.match(js, /document\.documentElement\.classList\.add\('ppt-conversation-root'\)/, 'PPT 会话应同时锁定浏览器根滚动容器的横向溢出');
assert.match(js, /artifactCanvas\.toggleAttribute\('inert', view !== 'artifact'\)[\s\S]*?aria-hidden/, '未打开的移动作品层应退出键盘和辅助技术交互');
assert.match(js, /laoji-ppt-conversation-input-draft/, 'PPT 会话输入草稿应在页面切换后恢复');
assert.match(js, /\['from', 'book'\]/, 'PPT 阶段链接应保留进入路径与书籍上下文');
assert.match(js, /function updateScopeSummary\(\)[\s\S]*?updateScopeSummary\(\);/, '范围草稿恢复后应立即同步会话摘要');
assert.match(js, /event\.key === 'Escape'/, 'Escape 应可退出移动作品层');
assert.match(js, /data-preview-ready-actions[\s\S]*?actions\.hidden = nextState !== 'ready'/, '开始生成后应隐藏只属于模板选择态的顶部操作');

assert.match(css, /body\.ppt-artifact-open\s*\{[^}]*overflow:\s*hidden/s, '作品层打开时页面不得继续滚动');
assert.match(css, /html\.ppt-conversation-root,[\s\S]*?body\.ppt-conversation-page\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;/s, 'PPT 会话的 html 与 body 应共同阻止横向滚动范围并兼容旧浏览器');
assert.match(css, /\.ppt-artifact-canvas\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;[^}]*transform:\s*translateX\(100%\)/s, '未打开的移动作品层应隐藏且不接收交互');
assert.match(css, /data-mobile-view="artifact"[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;[^}]*transform:\s*translateX\(0\)/s, '打开作品层后才恢复可见和交互');
assert.match(css, /\.chat-layout-no-context\.has-scope-workbench\s*\{[^}]*grid-template-columns:/s, '桌面普通对话应在右侧展开范围工作区');
assert.match(css, /\.scope-choice-grid\s*\{/, '范围、用途、对象和页数应使用统一选择组件');
assert.match(css, /\.scope-book-identity\s*\{[^}]*display:\s*grid/s, '桌面范围工作台应继续显示绑定书籍身份条');
assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.ppt-conversation-page \.scope-book-identity\s*\{[^}]*display:\s*none/s, '手机范围作品层应移除重复书籍身份条');
assert.match(css, /\[data-mobile-template-rail\]\.template-list\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,/s, '手机模板应使用可读双列浏览并覆盖旧横向轨道');
assert.match(css, /\.ppt-outline-document\s*\{/, '大纲应使用连续文档样式');
assert.match(css, /\.ppt-waterfall\s*\{/, '生成与预览应使用共享瀑布流样式');
assert.match(css, /\.ppt-artifact-canvas[^{]*\{[^}]*min-width:\s*0/s, '作品画布应允许收缩');
assert.match(css, /\.mobile-conversation-page \.chat-composer-wrap,\s*\[data-ppt-workbench="materials"\] \.chat-composer-wrap\s*\{[^}]*position:\s*static;[^}]*bottom:\s*auto;/s, '移动对话输入器应使用静态网格行并清除底栏二次偏移');
assert.match(css, /\.ppt-stage-card\s*\{/, 'PPT 阶段任务应使用共享扁平任务卡样式');
assert.doesNotMatch(css, /\.artifact-topbar \.btn:not\(\.artifact-mobile-back\)[^{]*\{[^}]*font-size:\s*0/s, '移动作品顶栏不得把文字操作替换为省略号占位');
assert.match(css, /\.btn\s*\{[^}]*min-height:\s*44px/s, '所有 PPT 操作应满足至少 44px 的触控高度');
assert.match(css, /:focus-visible\s*\{[^}]*outline:/s, '键盘操作应有明确焦点样式');
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/, '作品层动效应尊重减少动态效果设置');

for (const html of [materials, outline, preview]) {
  assert.doesNotMatch(html, /style="[^\"]*(?:min-width|width):\s*[4-9]\d{2}px/, 'PPT 移动流程不应包含强制大宽度内联样式');
}

console.log('laoji-mobile-ppt-conversation-workbench: all tests passed');
