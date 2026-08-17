const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const pages = fs.readdirSync(prototypeDir).filter((name) => name.endsWith('.html')).sort();

assert.equal(pages.length, 16, '最终原型应包含十六个独立页面');
assert.ok(pages.includes('laoji-profile-settings.html'), '个人资料应作为独立设置详情页存在');
assert.ok(pages.includes('laoji-account-email.html'), '登录邮箱应作为独立账户安全详情页存在');
assert.ok(!pages.includes('index.html'), '定稿版不得保留审查总览入口');

const missing = [];
for (const page of pages) {
  const html = fs.readFileSync(path.join(prototypeDir, page), 'utf8');
  assert.ok(!html.includes('{{'), `${page} 不得包含模板占位符`);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|data:|mailto:|#)/.test(target)) continue;
    const cleanTarget = target.split(/[?#]/)[0];
    if (!cleanTarget) continue;
    const resolved = path.resolve(prototypeDir, cleanTarget);
    if (!fs.existsSync(resolved)) missing.push(`${page} -> ${target}`);
  }
}

assert.deepEqual(missing, [], `存在失效的本地页面或资源链接：\n${missing.join('\n')}`);
console.log(`laoji-prototype-links: ${pages.length} pages passed`);
