const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('prototype/laoji-wechat-book.html', 'utf8');
const panelMatch = html.match(/<div id="notes-panel"[\s\S]*?<div id="ppt-panel"/);

assert.ok(panelMatch, '微信读书详情应保留当前书籍的老己笔记面板');
const notesPanel = panelMatch[0];
const cards = [...notesPanel.matchAll(/<article class="card source-card source-activatable"[\s\S]*?<\/article>/g)];

assert.equal(cards.length, 2, '示例老己笔记应直接平铺为两张可操作卡片');
assert.equal((notesPanel.match(/>老己笔记</g) || []).length, 1, '老己笔记只显示一次分组标题');
assert.doesNotMatch(notesPanel, /引用型笔记|独立笔记|无原文引用/, '条目不应暴露笔记类型');

for (const [index, match] of cards.entries()) {
  assert.match(match[0], /class="source-tools source-action-popover" role="toolbar"/, `第 ${index + 1} 条笔记应使用悬浮操作条`);
  assert.match(match[0], />删除<\/button>[\s\S]*?>编辑<\/button>[\s\S]*?>复制<\/button>/, `第 ${index + 1} 条笔记应提供删除、编辑、复制`);
  assert.doesNotMatch(match[0], /note-actions-dialog|更多笔记操作|回到原文/, '笔记操作不应再经过更多操作弹窗');
}

assert.match(html, /data-wechat-note-actions-script/, '微信读书详情应启用老己笔记卡片操作');
assert.doesNotMatch(html, /id="note-actions-dialog"/, '旧的笔记操作弹窗应移除');

console.log('laoji-weread-laoji-notes: all tests passed');
