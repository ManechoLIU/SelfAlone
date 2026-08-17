const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'laoji.css'), 'utf8');
const tabletDesktopBlock = css.match(/@media \(min-width: 768px\) and \(max-width: 1199px\) \{([\s\S]*?)\n\}/);

assert.ok(tabletDesktopBlock, '必须定义共享侧栏在 768–1199px 桌面预览宽度下的专用规则');
const rules = tabletDesktopBlock[1];
assert.match(rules, /:root\s*\{\s*--sidebar:\s*168px/, '紧凑桌面侧栏必须保持可容纳文字的宽度');
assert.match(rules, /\.brand-name-wrap,\s*\.nav-text/, '所有页面必须恢复品牌文字与导航标签');
assert.match(rules, /\.side-foot\s*\{\s*display:\s*block/, '所有页面必须恢复侧栏底部说明');
assert.match(rules, /display:\s*inline-flex/, '品牌文字和导航标签必须可见');
assert.match(rules, /justify-content:\s*flex-start/, '宽侧栏内容不得继续居中为图标栏');
assert.doesNotMatch(rules, /display:\s*none/, '紧凑桌面规则不得再次隐藏侧栏文字');

const narrowDesktopBlock = css.match(/@media \(max-width: 1023px\) \{([\s\S]*?)\n\}/);
assert.ok(narrowDesktopBlock, '必须保留窄桌面内容布局规则');
assert.doesNotMatch(narrowDesktopBlock[1], /--sidebar:\s*64px/, '窄桌面不得重新压缩为图标侧栏');

assert.match(
  css,
  /@media \(max-width: 767px\) \{\s*:root\s*\{\s*--sidebar:\s*0px;[\s\S]*?\.side-nav\s*\{\s*display:\s*none;/,
  '手机端应释放侧栏空间并继续使用底部导航'
);

assert.match(css, /\.nav-dot\s*\{[^}]*display:\s*block[^}]*mask/s, '桌面共享导航必须显示正式 SVG mask 图标');
assert.doesNotMatch(
  css,
  /\.bottom-link\[href\$="laoji-(?:chat|library|settings)\.html"\]::before\s*\{[^}]*border:/s,
  '手机底栏不得继续使用 CSS 边框拼图'
);

console.log('laoji-shared-sidebar-responsive: all tests passed');
