const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('prototype/laoji-wechat-book.html', 'utf8');
const epub = fs.readFileSync('prototype/laoji-epub-reader.html', 'utf8');
const pdf = fs.readFileSync('prototype/laoji-pdf-reader.html', 'utf8');
const css = fs.readFileSync('prototype/assets/laoji.css', 'utf8');
const js = fs.readFileSync('prototype/assets/laoji.js', 'utf8');
const toolbars = [...html.matchAll(/<div class="source-tools source-action-popover" role="toolbar"[\s\S]*?<\/div>/g)];

assert.equal(toolbars.length, 6, '微信读书详情中的四组原文操作与两组老己笔记操作应使用悬浮工具条');
for (const [index, match] of toolbars.slice(0, 4).entries()) {
  assert.match(match[0], />复制<[/]button>/, `第 ${index + 1} 组工具条应提供复制`);
  assert.match(match[0], />写笔记<[/]button>/, `第 ${index + 1} 组工具条应提供写笔记`);
  assert.doesNotMatch(match[0], />划线<|>聊一聊</, '同步内容工具条不应提供不适用的操作');
}
for (const [index, match] of toolbars.slice(4).entries()) {
  assert.match(match[0], />删除<[/]button>[\s\S]*?>编辑<[/]button>[\s\S]*?>复制<[/]button>/, `第 ${index + 1} 条老己笔记应提供删除、编辑、复制`);
}

assert.match(css, /\.source-action-popover\s*\{[^}]*position:\s*absolute;/s, '工具条应脱离卡片布局');
assert.match(css, /\.source-action-popover::after\s*\{/, '工具条应有指向内容的箭头');
assert.match(css, /\.source-action:hover/, '工具条按钮应有悬浮反馈');
assert.match(css, /\.source-action:focus-visible/, '工具条按钮应有键盘焦点状态');

for (const [name, reader] of [['EPUB', epub], ['PDF', pdf]]) {
  assert.match(reader, /class="selection-toolbar"[^>]*data-selection-popover[^>]*hidden/, `${name} 选区工具条初始应隐藏`);
  assert.match(reader, />复制<[/]button>[\s\S]*?>划线<[/]button>[\s\S]*?>写笔记<[/]button>/, `${name} 选区工具条应提供三项操作`);
}
assert.match(css, /\.selection-toolbar\s*\{[^}]*position:\s*fixed;/s, '选区工具条应贴近选区悬浮');
assert.match(js, /function initSelectionToolbars\(\)/, '应初始化选区工具条交互');
assert.match(js, /selection\.isCollapsed/, '没有文本选区时应隐藏工具条');
assert.match(js, /range\.getBoundingClientRect\(\)/, '工具条应根据选区位置定位');
assert.match(js, /initSelectionToolbars\(\);/, '页面加载后应启用选区工具条');

console.log('laoji-source-action-popover: all tests passed');
