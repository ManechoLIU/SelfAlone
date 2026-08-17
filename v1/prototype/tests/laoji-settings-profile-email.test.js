const assert = require('node:assert/strict');
const fs = require('node:fs');

assert.equal(fs.existsSync('prototype/laoji-profile-settings.html'), true, '个人资料应有独立设置详情页');
const profile = fs.existsSync('prototype/laoji-profile-settings.html')
  ? fs.readFileSync('prototype/laoji-profile-settings.html', 'utf8')
  : '';
const settings = fs.readFileSync('prototype/laoji-settings.html', 'utf8');
const accountEmail = fs.existsSync('prototype/laoji-account-email.html')
  ? fs.readFileSync('prototype/laoji-account-email.html', 'utf8')
  : '';
const script = fs.readFileSync('prototype/assets/laoji.js', 'utf8');

assert.match(profile, /class="[^"]*settings-detail-page[^"]*"[^>]*data-settings-page="profile"/, '个人资料应使用共享设置详情页协议');
assert.match(profile, /data-od-id="profile-settings-section"/, '个人资料应保留稳定的设计检查标记');
assert.match(profile, /data-profile-form/, '个人资料页应保留资料表单');
assert.match(profile, /<button[^>]+data-avatar-trigger[^>]+aria-label="更换头像"/, '头像本身应是可聚焦的上传入口');
assert.match(profile, /data-avatar-edit-badge/, '头像应使用正式编辑角标表达可操作性');
assert.doesNotMatch(profile, />选择图片<|JPG、PNG 或 WebP，最大 2 MB|支持 JPG、PNG、WebP 格式|单张图片不超过 2MB/, '个人资料页不应显示上传按钮或常驻技术说明');
assert.match(profile, /data-profile-name-save[^>]*>保存昵称</, '昵称应提供显式保存操作');

assert.doesNotMatch(profile, /登录邮箱|data-profile-email-account|data-change-email-dialog/, '个人资料页不应包含登录邮箱或验证任务');
assert.match(settings, /href="laoji-account-email\.html"[^>]*data-account-email-entry/, '账户与安全应提供登录邮箱入口');
assert.match(settings, /data-account-email-entry[\s\S]*?data-profile-email-value/, '登录邮箱入口应显示当前邮箱摘要');
assert.match(accountEmail, /data-settings-page="account-email"/, '登录邮箱应使用独立设置详情页');
assert.match(accountEmail, /data-profile-email-account/, '邮箱详情页应显示当前登录邮箱');
assert.match(accountEmail, /data-dialog-open="change-email-dialog"[^>]*>修改邮箱</, '邮箱详情页应提供修改入口');
assert.doesNotMatch(profile, /<input[^>]+(?:id="profile-email"|name="email")/, '个人资料表单不应直接编辑登录邮箱');
assert.match(accountEmail, /<dialog id="change-email-dialog"[^>]*data-change-email-dialog/, '修改邮箱应使用独立验证任务层');
assert.match(accountEmail, /data-email-step="current"/, '修改邮箱应先验证当前邮箱');
assert.match(accountEmail, /data-email-step="new"/, '修改邮箱应再验证新邮箱');

assert.match(script, /const EMAIL_VERIFICATION_CODE = '123456'/, '原型应提供固定演示验证码');
assert.match(script, /function resolveAvatar\(value\)/, '头像应经过统一来源校验');
assert.match(script, /preview\.addEventListener\('error'/, '设置页头像预览失效时应回退默认头像');
assert.match(script, /data-current-email-code/, '脚本应校验当前邮箱验证码');
assert.match(script, /data-new-email-code/, '脚本应校验新邮箱验证码');
assert.match(script, /新邮箱不能与当前邮箱相同/, '脚本应阻止重复邮箱');
assert.match(script, /登录邮箱已更新/, '邮箱更新后应提供明确反馈');
assert.doesNotMatch(script.match(/form\.addEventListener\('submit',[\s\S]*?\n\s*}\);/)?.[0] || '', /cleanEmail|emailError/, '保存个人资料不应校验或提交登录邮箱');
assert.doesNotMatch(script, /name\.addEventListener\('blur'/, '昵称不应在失焦时隐式保存');
assert.match(script, /name\.addEventListener\('input'/, '昵称变化时应更新显式保存状态');
assert.match(script, /data-profile-name-save/, '脚本应管理昵称保存按钮');
assert.match(script, /persistProfile\(profile\.name, pendingAvatar, false, false\)/, '头像更新应独立于昵称编辑状态自动保存');
assert.doesNotMatch(script, /保存资料后生效/, '恢复默认头像不应提示还需手动保存');

console.log('laoji-settings-profile-email: all tests passed');
