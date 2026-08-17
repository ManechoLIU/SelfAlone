const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'laoji-library.html'),
  'utf8'
);
const script = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'laoji.js'),
  'utf8'
);

assert.equal((html.match(/data-book=""/g) || []).length, 8, '书架应自带八本可见示例书');
assert.equal((html.match(/class="book-cover-image"/g) || []).length, 8, '每本书都应使用本地封面图片');
assert.doesNotMatch(html, /class="cover-(?:title|author)"/, '书架卡片不应在封面图片外重复显示书名和作者');
assert.equal((html.match(/src="assets\/covers\//g) || []).length, 8, '书架封面应来自项目内资源');
assert.match(script, /cover\.className = 'book-cover-image'/, '运行时生成的书卡也应使用封面图片');
assert.doesNotMatch(script, /localBadge\.textContent = '本地导入'/, '运行时书卡不应重新加入本地导入角标');
assert.doesNotMatch(script, /\$\{books\.length\} 本书 · 最近访问/, '运行时不应恢复最近访问文字');
assert.doesNotMatch(html, /class="book-meta"/, '封面下不应重复书名和作者');
assert.doesNotMatch(html, /本地 (?:EPUB|PDF)/, '本地书不应显示具体文件格式');
assert.doesNotMatch(html, /data-od-id="source-filter"/, '书架不应显示来源筛选');
assert.doesNotMatch(html, /class="local-import-badge"/, '本地书封面不应显示本地导入角标');
assert.doesNotMatch(html, /最近访问/, '书架顶部不应显示最近访问');
assert.doesNotMatch(html, /data-od-id="sync-weread-button"/, '书架顶部不应提供手动同步按钮');
assert.doesNotMatch(html, /data-weread-sync-retry/, '书架状态提示不应提供手动重试按钮');
assert.doesNotMatch(html, /同步微信读书|立即同步|重试同步|从右上角同步/, '书架页不应出现手动同步导向文案');
const importButton = html.match(/<button[^>]*data-od-id="import-book-button"[^>]*>/)?.[0] || '';
assert.match(importButton, /data-import-open/, '导入书籍按钮应直接触发文件选择');
assert.doesNotMatch(importButton, /data-dialog-open/, '导入书籍按钮不应先打开对话框');
assert.match(html, /data-od-id="import-book-button">[\s\S]*?class="import-book-icon"/, '导入书籍按钮应使用单一上传图标');
assert.doesNotMatch(importButton, /data-mobile-label/, '导入书籍按钮不应依赖通用加号文案');
assert.match(html, /data-od-id="import-book-button"[\s\S]*?<input[^>]*id="book-file"[^>]*hidden/, '直接导入应使用按钮旁的隐藏文件输入框');

const libraryInitializer = script.match(/function initLibrary\(\) \{[\s\S]*?\n  \}\n\n  const LIBRARY_COVER_SOURCES/)?.[0] || '';
assert.doesNotMatch(libraryInitializer, /function renderSyncButton/, '书架逻辑不应继续维护手动同步按钮状态');
assert.doesNotMatch(libraryInitializer, /立即同步|重试同步|同步微信读书/, '书架运行时不应恢复手动同步文案');
assert.match(
  libraryInitializer,
  /\['connected', 'partial'\]\.includes\(wereadState\)[\s\S]*?startWereadSync\(\)/,
  '微信读书连接有效时应在进入书架后自动更新'
);
const importInitializer = script.match(/function initLibraryImport\(\) \{[\s\S]*?\n  \}\n\n  function initPanels/)?.[0] || '';
assert.match(importInitializer, /open\.addEventListener\('click', \(\) => input\.click\(\)\)/, '点击导入书籍应直接打开系统文件选择器');
assert.match(importInitializer, /input\.addEventListener\('change',[\s\S]*?dialog\.showModal\(open\)[\s\S]*?importBook\(\)/, '选择文件后应显示进度并自动开始导入');
assert.match(html, /href="laoji-wechat-book\.html"/);
assert.match(html, /href="laoji-epub-reader\.html"/);
assert.match(html, /href="laoji-pdf-reader\.html"/);

console.log('laoji-library-markup: all tests passed');
