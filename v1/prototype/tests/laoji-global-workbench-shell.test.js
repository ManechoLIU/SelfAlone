const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.css'), 'utf8');
const navigation = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji-navigation.js'), 'utf8');
const pptJs = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.js'), 'utf8');

const modulePages = [
  ['对话', 'laoji-chat.html'],
  ['读书', 'laoji-library.html'],
  ['设置', 'laoji-settings.html']
];

for (const [moduleName, file] of modulePages) {
  const html = fs.readFileSync(path.join(prototypeDir, file), 'utf8');
  assert.match(html, /<aside[^>]*class="side-nav"/, `${moduleName}必须复用全局导航轨`);
  assert.match(html, /assets\/laoji-navigation\.js/, `${moduleName}必须加载全局导航状态控制器`);
  for (const label of ['对话', '读书', '设置']) {
    assert.match(html, new RegExp(`<span class="nav-text">${label}<\\/span>`), `${moduleName}必须保留${label}一级入口`);
  }
}

assert.match(css, /--global-nav-collapsed:\s*64px/, '桌面全局导航收起宽度必须统一为 64px');
assert.match(css, /--global-nav-expanded:\s*188px/, '桌面全局导航展开宽度必须统一为 188px');
assert.match(css, /--global-nav-width:\s*var\(--global-nav-collapsed\)/, '工作区起点必须由全局导航宽度 token 统一控制');
assert.match(css, /body\[data-global-nav-expanded="true"\]\s*\{[^}]*--global-nav-width:\s*var\(--global-nav-expanded\)/s, '展开状态必须在所有模块共享同一几何变量');
assert.match(css, /\.app-shell\s*\{[^}]*padding-left:\s*var\(--global-nav-width\)/s, '所有桌面模块必须以同一导航宽度计算工作区起点');
assert.match(css, /\.side-nav\s*\{[^}]*width:\s*var\(--global-nav-width\)/s, '全局导航自身必须与工作区使用同一宽度变量');
assert.match(css, /\.global-nav-toggle\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s, '主导航开合按钮必须是独立的 44px 图标控件');
assert.match(css, /\.ppt-session-toggle\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s, '会话列表开合按钮必须是 44px 二级面板控件');
assert.match(css, /\.ppt-session-toggle::before[\s\S]*?\{[^}]*mask:/, '会话列表按钮必须使用与主导航不同的面板图标');
assert.match(css, /--ppt-session-width:\s*240px/, '会话上下文栏必须使用参考图的 240px 稳定栏宽');
assert.match(
  css,
  /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.library-page\s+\.topbar,[\s\S]*?\.ppt-conversation-page\s+\.topbar\s*\{[^}]*height:\s*var\(--topbar\);[^}]*padding-block:\s*6px;/,
  '桌面对话、读书与 PPT 页头必须使用同一 72px 基线，模块切换不能改变工作区纵向起点'
);
assert.match(css, /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.ppt-conversation-page\s+\.topbar-title\s*>\s*\.eyebrow\s*\{\s*display:\s*none;/, '桌面 PPT 页头必须移除会把页头撑高的返回眉题');

for (const name of ['laoji-chat.html', 'laoji-ppt-materials.html', 'laoji-ppt-outline.html', 'laoji-ppt-preview.html']) {
  const html = fs.readFileSync(path.join(prototypeDir, name), 'utf8');
  assert.doesNotMatch(html, /data-ppt-nav-toggle|ppt-nav-toggle/, `${name} 不得保留 PPT 私有一级导航控制器`);
  assert.match(html, /data-ppt-session-toggle[^>]*aria-label="展开会话列表"/, `${name} 的会话列表按钮必须明确表达二级面板语义`);
}

assert.match(navigation, /GLOBAL_NAV_STORAGE_KEY\s*=\s*['"]laoji-global-nav-expanded['"]/, '主导航展开状态必须使用跨模块的全局存储键');
assert.match(navigation, /function initGlobalNavigation\(/, '共享导航脚本必须初始化统一壳层');
assert.match(navigation, /dataset\.globalNavExpanded/, '共享导航脚本必须在 body 上同步统一状态');
assert.match(navigation, /documentElement\.dataset\.globalNavExpanded/, '共享导航状态必须同时写入根节点，供页面绘制前恢复');
for (const file of modulePages.map(([, page]) => page)) {
  const html = fs.readFileSync(path.join(prototypeDir, file), 'utf8');
  const navigationIndex = html.indexOf('assets/laoji-navigation.js?v=20260814-unified-shell-r3');
  const stylesheetIndex = html.indexOf('assets/laoji.css?v=20260814-unified-shell-r3');
  assert.ok(
    navigationIndex >= 0 && stylesheetIndex >= 0 && navigationIndex < stylesheetIndex,
    `${file} 必须在样式加载前执行全局导航状态恢复，切换模块时工作区不能先缩后展开`
  );
}
assert.doesNotMatch(pptJs, /dataset\.pptNavExpanded|data-ppt-nav-toggle|navExpanded:\s*expanded/, 'PPT 会话状态不得再拥有一级导航开合状态');

console.log('laoji-global-workbench-shell: all tests passed');
