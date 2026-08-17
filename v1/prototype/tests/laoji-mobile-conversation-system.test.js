const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pageNames = [
  'laoji-chat.html',
  'laoji-ppt-materials.html',
  'laoji-ppt-outline.html',
  'laoji-ppt-preview.html'
];
const pages = pageNames.map(read);
const materials = pages[1];
const preview = pages[3];
const css = read('assets/laoji.css');
const js = read('assets/laoji.js');

pages.forEach((html, index) => {
  assert.match(html, /<body[^>]*class="[^"]*mobile-conversation-page/, `${pageNames[index]} 应使用统一移动会话页面类`);
  assert.match(html, /data-mobile-conversation-header/, `${pageNames[index]} 应使用统一移动页头锚点`);
  assert.match(html, /class="[^"]*mobile-chat-composer/, `${pageNames[index]} 应使用统一移动输入器`);
  assert.match(html, /class="[^"]*conversation-send-icon/, `${pageNames[index]} 应使用统一发送图标按钮`);
});

assert.match(materials, /data-ppt-scope-workbench/, '材料入口应使用统一范围确认工作区');
assert.match(materials, /data-selected-book-confirmation[\s\S]*?atomic-habits-image2\.png[\s\S]*?原子习惯[\s\S]*?詹姆斯·克利尔[\s\S]*?已选择/, '选书后的用户气泡应保留封面、书名、作者和确认状态');
assert.match(materials, /data-scope-confirm-form/, '范围和必要要求应集中在一个确认表单');
for (const field of ['scope', 'purpose', 'audience', 'pageCount']) {
  assert.match(materials, new RegExp(`data-draft-field="${field}"`), `集中确认区应提供 ${field} 选择`);
}
assert.match(materials, /data-generate-outline[^>]*aria-label="确认范围并生成大纲"[^>]*>生成大纲</, '集中确认区应只突出简洁的生成大纲主操作，并保留完整无障碍名称');
assert.doesNotMatch(materials, /data-ppt-task-panel="requirements"/, '材料入口不应继续拆分重复要求卡');

['business', 'cards', 'story'].forEach((name) => {
  assert.match(preview, new RegExp(`data-template-cover="${name}"`), `${name} 模板应提供真实封面结构`);
});
assert.match(css, /\.ppt-template-cover\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s, '模板封面应保持 16:9');
assert.match(css, /\.mobile-conversation-header\s*\{[^}]*grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)\s+44px/s, '移动页头应使用稳定三栏布局');
assert.match(css, /\.mobile-chat-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+44px/s, '移动输入器应为文本区加图标按钮');
assert.match(css, /\.mobile-chat-composer \.conversation-send-icon\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s, '统一输入器发送按钮应保持稳定方形尺寸');
assert.match(css, /\.mobile-chat-composer \.conversation-send-icon span\s*\{[^}]*display:\s*none/s, '图标发送按钮不得同时显示文字导致挤压');
assert.match(css, /\.mobile-conversation-page \.message-row\s*\{[^}]*grid-template-columns:\s*27px\s+minmax\(0,\s*1fr\)/s, '四页消息列应使用相同头像和正文栅格');
assert.match(css, /\.mobile-conversation-page \.message-bubble\s*\{[^}]*max-width:\s*91%/s, '四页消息气泡应使用相同宽度预算');
assert.match(js, /function resizeConversationInput\(input\)/, '共享脚本应提供输入器自动增高函数');
assert.match(js, /function initConversationInputs\(\)/, '共享脚本应初始化所有对话输入器');

console.log('laoji-mobile-conversation-system: all tests passed');
