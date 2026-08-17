const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.css'), 'utf8');
const library = fs.readFileSync(path.join(prototypeDir, 'laoji-library.html'), 'utf8');
const iconDir = path.join(prototypeDir, 'assets', 'icons');
const iconSources = new Map();
const htmlFiles = fs.readdirSync(prototypeDir).filter((name) => name.endsWith('.html'));

for (const name of ['nav-chat.svg', 'nav-library.svg', 'nav-settings.svg']) {
  const iconPath = path.join(iconDir, name);
  assert.ok(fs.existsSync(iconPath), `${name} 应存在`);
  const svg = fs.readFileSync(iconPath, 'utf8');
  iconSources.set(name, svg);
  assert.match(svg, /viewBox="0 0 24 24"/, `${name} 必须使用统一 24×24 网格`);
  assert.match(svg, /stroke-width="1\.75"/, `${name} 必须使用统一视觉线宽`);
  assert.doesNotMatch(
    svg.replaceAll('#000', ''),
    /#[0-9a-f]{3,8}|rgb\(|oklch\(/i,
    `${name} 不应写死界面颜色`
  );
}

assert.match(css, /--sidebar:\s*188px/, '标准桌面侧栏必须锁定为 188px');
assert.match(
  css,
  /\.user-avatar\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;[^}]*flex:\s*0 0 38px/s,
  '共享头像尺寸必须锁定为 38px'
);
assert.match(css, /\.brand-name\s*\{[^}]*25px\/1 var\(--brand\)/s, '共享品牌字必须锁定为 25px');
assert.match(css, /\.nav-dot\s*\{[^}]*mask-position:\s*center/s, '桌面导航必须启用兼容的 SVG mask');
assert.match(css, /\.bottom-link::before\s*\{[^}]*mask-position:\s*center/s, '移动底栏必须启用兼容的 SVG mask');
assert.doesNotMatch(css, /\.chat-page\s*\{[^}]*--sidebar:\s*188px/s, '对话页不得覆盖共享侧栏宽度');
assert.doesNotMatch(library, /\.library-page \.brand-name|\.library-page \.brand-lockup \.user-avatar/, '书架页不得覆盖共享品牌尺寸');

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(path.join(prototypeDir, htmlFile), 'utf8');
  if (!html.includes('class="side-nav"')) continue;
  assert.match(
    html,
    /assets\/laoji\.css\?v=[^"\s]+/,
    `${htmlFile} 必须使用带缓存版本的共享 CSS；导航图标能力由本测试直接检查`
  );
}

assert.doesNotMatch(css, /--nav-icon/, '图标不得依赖祖先自定义变量才能显示');
for (const name of ['nav-chat.svg', 'nav-library.svg', 'nav-settings.svg']) {
  const embeddedSvg = `data:image/svg+xml;base64,${Buffer.from(iconSources.get(name)).toString('base64')}`;
  assert.ok(
    css.includes(`mask-image: url("${embeddedSvg}")`),
    `${name} 必须以内嵌数据直接绑定，首次刷新不得依赖外部 SVG 请求`
  );
}
assert.doesNotMatch(css, /mask-image:\s*url\("icons\//, '导航 mask 不得在首次刷新时请求外部 SVG');

console.log('laoji-navigation-icons-brand-lock: all tests passed');
