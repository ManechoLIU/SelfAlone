const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('prototype/laoji-wechat-book.html', 'utf8');
const panelMatch = html.match(/<div id="public-panel"[\s\S]*?<div id="notes-panel"/);

assert.ok(panelMatch, '微信读书详情应保留书友笔记内容面板');
const publicPanel = panelMatch[0];

assert.match(publicPanel, /data-od-id="friend-highlights-section"/, '应有独立热门划线区');
assert.match(publicPanel, /data-od-id="friend-reviews-section"/, '应有独立书友评价区');
assert.match(publicPanel, /class="friend-highlight-count"[^>]*>\d+ 人划线</, '热门划线卡应显示划线人数');
assert.match(publicPanel, /class="friend-reviewer-avatar"/, '书友评价卡应显示书友头像');
assert.match(publicPanel, /class="friend-review-stars"/, '书友评价卡应显示评分');
assert.match(publicPanel, /class="friend-review-like"[^>]*>\d+ 人赞同</, '书友评价卡应显示赞同人数');
assert.match(publicPanel, /class="friend-review-date"/, '书友评价卡应显示日期');
assert.doesNotMatch(publicPanel, /同步上限|各最多 20 条|默认不会用于 PPT/, '不应向用户展示同步或 PPT 实现说明');

const densityStyleMatch = html.match(/<style data-weread-highlight-density>([\s\S]*?)<\/style>/);
assert.ok(densityStyleMatch, '微信读书详情页应局部声明热门划线紧凑样式');
const densityStyles = densityStyleMatch[1];
assert.match(densityStyles, /\[data-od-id="friend-highlights-section"\] \.friend-highlight-card\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/, '热门划线卡片高度应跟随内容自适应');
assert.match(densityStyles, /\[data-od-id="friend-highlights-section"\] \.friend-highlight-footer\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?margin-top:\s*8px;/, '热门划线底部信息行不应保留多余高度');
assert.doesNotMatch(densityStyles, /friend-review-card/, '热门划线紧凑样式不应影响书友评价卡片');

console.log('laoji-weread-friend-content: all tests passed');
