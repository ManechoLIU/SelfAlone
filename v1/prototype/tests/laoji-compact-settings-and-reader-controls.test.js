const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('prototype/laoji-settings.html', 'utf8');
const epub = fs.readFileSync('prototype/laoji-epub-reader.html', 'utf8');
const pdf = fs.readFileSync('prototype/laoji-pdf-reader.html', 'utf8');

const compactSettings = settings.match(/<div data-settings-compact-grid>[\s\S]*?<\/main>/)?.[0] || '';
const compactSettingsStyles = settings.match(/<style>[\s\S]*?<\/style>/)?.[0] || '';
assert.match(compactSettings, /<h2>连接服务<\/h2>/, '设置页应使用单一连接服务标题');
assert.match(compactSettings, /<h2>账户与安全<\/h2>/, '设置页应使用单一账户安全标题');
assert.doesNotMatch(compactSettings, /连接 AI 服务|连接微信读书|通过验证邮件|不会删除书籍|永久删除账户数据/, '设置项目不应保留解释文案');
assert.doesNotMatch(compactSettings, />管理<|>发送修改邮件</, '设置项目不应重复显示操作按钮文案');
const settingsRowCount = (compactSettings.match(/class="[^"]*"/g) || [])
  .filter((attribute) => attribute.slice(7, -1).split(/\s+/).includes('settings-row')).length;
assert.equal(settingsRowCount, 6, '六个设置项目都应使用整行操作');
assert.match(compactSettings, /data-ai-connection-state/, 'AI 连接状态应保留为尾随值');
assert.match(compactSettings, /data-weread-connection-state/, '微信读书状态应保留为尾随值');
assert.equal((compactSettings.match(/settings-row-chevron/g) || []).length, 6, '设置行应使用统一的尾随导航图标');
assert.match(compactSettingsStyles, /\[data-settings-compact-grid\]\s*\{[\s\S]*?grid-template-columns:\s*1fr/, '设置分组在桌面端也应使用单列布局');
assert.doesNotMatch(compactSettingsStyles, /grid-template-columns:\s*repeat\(2/, '设置分组不应恢复双列布局');

for (const [name, html] of [['EPUB', epub], ['PDF', pdf]]) {
  assert.match(html, /data-local-reader-toolbar/, `${name} 应使用统一的本地书籍工具栏`);
  assert.match(html, /class="local-reader-tool-group"/, `${name} 应使用组合控件而不是堆叠按钮`);
  assert.match(html, /class="local-reader-icon-btn"/, `${name} 应使用标准图标按钮`);
  assert.match(html, /class="local-reader-value/, `${name} 的阅读状态应显示为普通值`);
  assert.match(html, /class="local-reader-action"/, `${name} 应使用统一的主要阅读操作`);
  assert.match(html, /data-local-reader-size-control="decrease"/, `${name} 的缩小控件应使用统一语义`);
  assert.match(html, /data-local-reader-size-control="increase"/, `${name} 的放大控件应使用统一语义`);
  assert.match(html, /data-local-reader-size-value/, `${name} 的显示级别应使用统一状态`);
  assert.doesNotMatch(html, /字号|当前字号|当前缩放比例|适合宽度|当前页码/, `${name} 不应暴露格式实现术语`);
  assert.match(html, /<svg[^>]*aria-hidden="true"/, `${name} 的工具栏按钮应使用可访问图标`);
  assert.doesNotMatch(html, />[^<]*(?:本地导入|EPUB|PDF)[^<]*</, `${name} 不应向用户区分本地书籍格式`);
  assert.match(html, /requestFullscreen/, `${name} 应使用一致的专注阅读进入机制`);
  assert.match(html, /window\.matchMedia\('\(max-width: 760px\)'\)/, `${name} 应在同一手机断点切换专注阅读控制`);
  assert.match(html, /const AUTO_HIDE_DELAY = 3000/, `${name} 的手机专注控件应统一自动隐藏`);
  assert.match(html, /setReaderControlsVisible = \(visible, scheduleHide = true\)/, `${name} 桌面与移动端应共用普通控件显隐逻辑`);
  assert.match(html, /readerToolbar\?\.addEventListener\('focusin'/, `${name} 键盘聚焦工具栏时应保持显示`);
  assert.match(html, /window\.getSelection\(\)/, `${name} 选择内容时不应误唤起专注控件`);
}

assert.doesNotMatch(pdf, /class="btn btn-small data" aria-label="当前页码"/, 'PDF 页码不应伪装为按钮');
assert.doesNotMatch(pdf, /class="btn btn-small data">100%/, 'PDF 缩放值不应伪装为按钮');

console.log('laoji-compact-settings-and-reader-controls: all tests passed');
