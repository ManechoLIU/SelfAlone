const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('assets/laoji.css');
const chat = read('laoji-chat.html');

assert.match(css, /Mobile-native pass/, '共享样式应包含移动端原生重构规则');
assert.match(css, /\[data-od-id="library-content"\] \.book-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, '手机书架应以两列大封面呈现');
assert.match(css, /\.bottom-link::before/, '手机底部导航应有图标承载');
assert.match(css, /\.ppt-artifact-canvas \{ inset: 0; z-index: 60;/, '手机 PPT 作品层应为全屏单任务视图');
assert.match(css, /\.app-shell:has\(\.ppt-chat-shell\[data-mobile-view="artifact"\]\) > \.topbar \{ display: none;/, '打开作品层时不应保留桌面式顶部栏');
assert.match(css, /\.ppt-book-picker \{ display: none; \}/, '消息内选书卡不应在手机横向堆叠');
assert.match(css, /\.mobile-book-sheet \.ppt-book-picker \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, '选书应在底部面板中以两列封面呈现');
assert.match(css, /dialog::backdrop \{ background: oklch\(/, '通用弹窗应提供遮罩层');

assert.match(chat, /data-mobile-book-picker-open/, '对话应提供单一的移动端选书入口');
assert.match(chat, /id="mobile-book-picker-dialog"/, '移动端选书应使用独立选择面板');
assert.doesNotMatch(chat, /local-import-badge/, '对话选书不应暴露本地文件来源');

for (const file of ['laoji-epub-reader.html', 'laoji-pdf-reader.html']) {
  const html = read(file);
  assert.match(html, /data-local-reader-context-panel/, `${file} 应保留按需出现的划线上下文面板`);
  assert.match(html, /data-local-reader-focus-chrome/, `${file} 应保留按需唤起的专注阅读控制层`);
  assert.match(html, /local-reader-controls-visible/, `${file} 的普通手机阅读也应按需显示控制层`);
  assert.match(html, /setReaderControlsVisible/, `${file} 应提供普通阅读控制层的显示与自动隐藏逻辑`);
  assert.match(html, /window\.addEventListener\('scroll',[\s\S]*?setReaderControlsVisible\(false\)/, `${file} 滚动阅读时应收起普通控制层`);
  assert.match(html, /\.local-reader-workspace\.local-reader-controls-visible:not\(:fullscreen\)[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/, `${file} 仅在普通阅读被唤起时显示工具栏`);
  assert.match(html, /top: auto;[\s\S]*?left: 12px;[\s\S]*?right: 12px;/, `${file} 的手机划线上下文应以底部面板呈现`);
  assert.match(html, /data-local-reader-context-open\]:fullscreen > \.local-reader-context-panel[\s\S]*?top: auto;[\s\S]*?bottom: 0;/, `${file} 的原生全屏状态也应贴底显示划线面板`);
  assert.match(html, /context-backdrop[\s\S]*?background: oklch\(0\.2 0\.02 175 \/ 0\.46\)/, `${file} 的划线面板应使用清晰遮罩`);
}

const settings = read('laoji-settings.html');
const profileSettings = read('laoji-profile-settings.html');
const accountEmailSettings = read('laoji-account-email.html');
assert.match(settings, /href="laoji-profile-settings\.html"/, '设置首页应提供独立个人资料入口');
assert.doesNotMatch(profileSettings, /data-profile-email-account|data-change-email-dialog/, '个人资料页不应承载账户安全任务');
assert.match(settings, /href="laoji-account-email\.html"/, '账户与安全应提供独立登录邮箱入口');
assert.match(accountEmailSettings, /data-profile-email-account/, '登录邮箱详情页应保留受保护的邮箱入口');
assert.match(accountEmailSettings, /data-change-email-dialog/, '登录邮箱详情页应保留邮箱验证流程');

const pdfReader = read('laoji-pdf-reader.html');
assert.match(pdfReader, /class="ai-status desktop-only"/, 'PDF 阅读页的 AI 状态入口不应在手机顶部显示');
assert.doesNotMatch(pdfReader, /data-mobile-(?:toc|note)-action/, '本地书工具栏不应再区分移动专用目录和笔记入口');
assert.match(pdfReader, /position: fixed;[\s\S]*?width: max-content;[\s\S]*?opacity: 0;[\s\S]*?local-reader-controls-visible/, '桌面阅读工具栏应默认收起并按需显示');
assert.match(pdfReader, /@media \(max-width: 1199px\)[\s\S]*?grid-template-columns: 180px minmax\(0, 1fr\)/, '中等桌面应保留可读的目录宽度');
const pdfHeader = pdfReader.match(/<header class="topbar"[\s\S]*?<\/header>/)?.[0] || '';
assert.doesNotMatch(pdfHeader, /data-dialog-open="pdf-pages-dialog"/, 'PDF 手机顶部不应保留目录按钮');
assert.doesNotMatch(pdfHeader, /data-dialog-open="pdf-note-dialog"/, 'PDF 手机顶部不应保留笔记按钮');
assert.match(pdfReader, /data-local-reader-toolbar[\s\S]*?data-local-reader-toc-action[\s\S]*?data-dialog-open="pdf-pages-dialog"/, 'PDF 目录入口应进入各端统一的按需工具栏');
assert.match(pdfReader, /data-local-reader-toolbar[\s\S]*?data-local-reader-note-action[\s\S]*?data-dialog-open="pdf-note-dialog"/, 'PDF 笔记入口应进入各端统一的按需工具栏');

console.log('laoji-mobile-native-redesign: all tests passed');
