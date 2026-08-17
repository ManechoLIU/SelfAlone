const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('prototype/laoji-wechat-book.html', 'utf8');
const panelMatch = html.match(/<div id="mine-panel"[\s\S]*?<div id="public-panel"/);

assert.doesNotMatch(html, /data-od-id="sync-current-book"|>立即同步<|正在同步个人内容/, '微信读书详情页不应提供手动同步入口');
assert.match(html, /data-od-id="new-ppt-button"[^>]*>制作 PPT<\//, '移除同步入口后应保留制作 PPT');
assert.doesNotMatch(html, />新建 PPT<\//, '微信读书详情页不应继续使用新建 PPT 文案');
assert.ok(panelMatch, '微信读书详情应保留我的笔记内容面板');
const minePanel = panelMatch[0];

assert.equal((minePanel.match(/>我的划线</g) || []).length, 1, '我的划线应只作为一次性分组标题出现');
assert.equal((minePanel.match(/>我的想法</g) || []).length, 1, '我的想法应只作为一次性分组标题出现');
assert.match(minePanel, /data-od-id="mine-highlights-section"[\s\S]*?id="mine-highlights-heading">我的划线<\/h2>[\s\S]*?data-od-id="my-note-third-chapter"/, '划线条目应归入我的划线分组');
assert.match(minePanel, /data-od-id="mine-thoughts-section"[\s\S]*?id="mine-thoughts-heading">我的想法<\/h2>[\s\S]*?data-od-id="my-note-fourth-chapter"/, '想法条目应归入我的想法分组');
assert.doesNotMatch(minePanel, /<div class="source-head"><span>我的(?:划线|想法|笔记)/, '条目内部不应重复显示分组标题');
assert.doesNotMatch(minePanel, /同步于/, '条目时间不应带技术性的同步前缀');
assert.match(minePanel, /<span>第三章<\/span><time[^>]*>14:20<\/time>/, '划线条目应只保留章节与时间');
assert.match(minePanel, /<span>第四章<\/span><time[^>]*>昨天<\/time>/, '笔记条目应只保留章节与时间');

console.log('laoji-weread-mine-content: all tests passed');
