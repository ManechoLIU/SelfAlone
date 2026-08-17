const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('prototype/assets/laoji.css', 'utf8');
const script = fs.readFileSync('prototype/assets/laoji.js', 'utf8');
const pageFiles = {
  profile: 'prototype/laoji-profile-settings.html',
  'account-email': 'prototype/laoji-account-email.html',
  ai: 'prototype/laoji-ai-setup.html',
  weread: 'prototype/laoji-weread-setup.html'
};

for (const file of Object.values(pageFiles)) {
  assert.equal(fs.existsSync(file), true, `${file} 应存在`);
}

for (const [id, file] of Object.entries(pageFiles)) {
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  assert.match(html, new RegExp(`class="[^"]*settings-detail-page[^"]*"[^>]*data-settings-page="${id}"`), `${id} 应声明稳定页面元数据`);
  assert.match(html, /data-settings-detail-header/, `${id} 应使用共享移动详情页头`);
  assert.match(html, /data-settings-detail-back/, `${id} 应提供共享返回入口`);
  assert.match(html, /class="settings-detail-main"/, `${id} 应使用共享主内容容器`);
  assert.match(html, /class="[^"]*settings-detail-content[^"]*"/, `${id} 应使用共享内容列`);
  assert.match(html, /class="side-nav"/, `${id} 应保留桌面侧栏`);
  assert.match(html, /class="bottom-nav"/, `${id} 应保留可由共享移动规则隐藏的一级导航`);
  assert.doesNotMatch(html, /data-mobile-settings-panel/, `${id} 不应使用设置首页内部面板`);
}

assert.match(css, /\.settings-detail-page[\s\S]*?\.settings-detail-main[\s\S]*?min-width:\s*0/, '共享详情页内容应允许收缩');
assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.settings-detail-page[\s\S]*?\.bottom-nav[\s\S]*?display:\s*none/, '手机详情页应隐藏一级底部导航');
assert.match(css, /\.settings-detail-page[\s\S]*?safe-area-inset-top/, '共享详情页应处理顶部安全区');
assert.match(css, /\.settings-detail-page[\s\S]*?safe-area-inset-bottom/, '共享详情页应处理底部安全区');
assert.doesNotMatch(css, /\.settings-detail-page[\s\S]{0,1400}translateX\(100%\)/, '详情页不应通过整页横向位移隐藏');

assert.match(script, /const SETTINGS_RETURN_ALLOWLIST = new Set\(/, '应使用明确允许列表解析返回目标');
assert.match(script, /function resolveSettingsReturnTarget\(value, fallback = 'laoji-settings\.html'\)/, '应提供共享安全返回解析函数');
assert.match(script, /function initSettingsDetailPage\(\)/, '应提供共享详情页初始化函数');
assert.match(script, /\$\$\('\[data-settings-detail-back\]'/, '共享初始化应更新详情页返回入口');
assert.match(script, /resolveSettingsReturnTarget\(params\.get\('return'\)/, '返回参数必须经过允许列表解析');
assert.doesNotMatch(script, /\^\[a-z0-9-\]\+\\\.html\$/i, '不能只用文件名正则代替返回允许列表');

console.log('laoji-mobile-settings-navigation-system: all tests passed');
