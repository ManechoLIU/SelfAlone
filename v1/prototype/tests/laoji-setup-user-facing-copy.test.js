const assert = require('node:assert/strict');
const fs = require('node:fs');

const weread = fs.readFileSync('prototype/laoji-weread-setup.html', 'utf8');
const ai = fs.readFileSync('prototype/laoji-ai-setup.html', 'utf8');
const js = fs.readFileSync('prototype/assets/laoji.js', 'utf8');

for (const [name, html] of [['微信读书', weread], ['AI 服务', ai]]) {
  assert.match(html, /data-connection-top-status/, `${name} 应只在页头保留连接状态`);
  assert.doesNotMatch(html, /class="status-row"|>当前状态</, `${name} 不应在正文重复连接状态`);
  assert.doesNotMatch(html, /正在验证|验证并|保存并测试|先保存|测试连接|测试失败/, `${name} 不应展示验证和测试机制`);
  assert.doesNotMatch(html, /凭证|API Key|Skill Key/, `${name} 不应使用面向实现的密钥术语`);
  assert.match(html, /data-connection-invalid/, `${name} 应保留需要用户处理的连接失败状态`);
  assert.match(html, /data-connection-revoke/, `${name} 应保留断开连接操作`);
}

assert.doesNotMatch(weread, /连接后回到|筛选和操作会保留|不使用二维码|仅用于同步|立即同步|最近同步/, '微信读书配置页不应解释内部流程或提供手动同步');
assert.match(weread, />连接微信读书<\//, '微信读书主操作应直接描述用户目标');
assert.match(weread, />微信读书密钥<\//, '微信读书密钥应使用用户可理解的名称');

assert.doesNotMatch(ai, /密钥仅用于|验证后即可使用|上次成功使用/, 'AI 配置页不应重复解释内部流程或状态');
assert.match(ai, />连接 AI 服务<\//, 'AI 主操作应直接描述用户目标');
assert.match(ai, />密钥<\//, 'AI 密钥应使用用户可理解的名称');

assert.doesNotMatch(js, /正在验证|验证并启用|验证并连接|连接后回到/, '运行时不应恢复技术导向的流程文案');
assert.match(js, /正在连接/, '连接中的状态应使用用户可理解的语言');

console.log('laoji-setup-user-facing-copy: all tests passed');
