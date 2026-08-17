const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('prototype/laoji-settings.html', 'utf8');
const script = fs.readFileSync('prototype/assets/laoji.js', 'utf8');

assert.match(settings, /data-mobile-settings-summary/, '移动设置首页应保留账户摘要入口');
assert.match(settings, /<a[^>]+href="laoji-profile-settings\.html"[^>]+data-mobile-settings-summary/, '账户摘要应进入独立个人资料页');
assert.doesNotMatch(settings, /data-mobile-settings-panel="profile"/, '个人资料不应继续嵌套在设置首页');
assert.doesNotMatch(settings, /data-mobile-settings-open="profile"/, '账户摘要不应再依赖单页面板状态');
assert.match(settings, /settings-danger-row/, '删除账户应与普通账户操作视觉分离');
assert.match(settings, /@media \(max-width: 767px\)[\s\S]*?\[data-mobile-settings-summary\][\s\S]*?min-height:\s*76px/, '移动账户摘要应有稳定触控高度');
assert.match(settings, /data-dialog-open="delete-account-dialog"/, '删除账户确认流程应继续保留');

assert.doesNotMatch(script, /function setMobileSettingsView\(/, '脚本不应继续维护内嵌个人资料视图状态');
assert.doesNotMatch(script, /function initMobileSettings\(/, '脚本不应继续初始化内嵌个人资料层');
assert.doesNotMatch(script, /mobile-settings-panel-open/, '独立页面不应锁定设置首页背景滚动');
assert.match(script, /\$\$\('\[data-profile-email-value\]'\)\.forEach/, '首页摘要与资料页邮箱应同步更新');

console.log('laoji-mobile-settings-native: all tests passed');
