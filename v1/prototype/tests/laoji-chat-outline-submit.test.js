const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const chat = fs.readFileSync(path.join(prototypeDir, 'laoji-chat.html'), 'utf8');
const js = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.js'), 'utf8');

assert.match(
  chat,
  /<form[^>]*data-material-form[^>]*data-scope-confirm-form[^>]*>[\s\S]*?<button[^>]*type="submit"[^>]*data-generate-outline[^>]*aria-label="确认范围并生成大纲"[^>]*>生成大纲<\/button>/,
  '对话内范围确认必须使用真正的提交按钮，显示简洁文案并保留完整无障碍名称'
);
assert.match(
  chat,
  /<form[^>]*data-outline-direct-navigation[^>]*action="laoji-ppt-outline\.html\?conversation=ppt-conversation-atomic-habits"/,
  '对话内确认范围必须直接进入当前会话的大纲，并提供无脚本表单兜底'
);
assert.match(
  chat,
  /assets\/laoji\.js\?v=20260814-unified-shell-r3/,
  '聊天页必须请求当前提交逻辑版本，不能复用旧缓存'
);
assert.match(
  js,
  /if \(!configured && !directOutlineNavigation\) \{[\s\S]*?generate\.disabled = true;[\s\S]*?generate\.textContent = '前往配置 AI…';[\s\S]*?laoji-ai-setup\.html\?return=/,
  'AI 未配置时，提交必须立即给出前往配置的反馈并保留当前会话返回路径'
);
assert.match(
  js,
  /if \(destination === null && generate\) \{[\s\S]*?generate\.disabled = false;[\s\S]*?generate\.textContent = '生成大纲';/,
  '受限预览阻止导航时，按钮必须恢复可操作状态，不能静默失效'
);

console.log('laoji-chat-outline-submit: all tests passed');
