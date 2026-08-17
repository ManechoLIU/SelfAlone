const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = [
  ['EPUB 示例', fs.readFileSync('prototype/laoji-epub-reader.html', 'utf8')],
  ['PDF 示例', fs.readFileSync('prototype/laoji-pdf-reader.html', 'utf8')],
];
const js = fs.readFileSync('prototype/assets/laoji.js', 'utf8');

for (const [name, html] of pages) {
  assert.match(html, /<script defer src="assets\/laoji-state\.js[^\"]*"><\/script>[\s\S]*?<script defer src="assets\/laoji\.js[^\"]*"><\/script>/, `${name} 应先加载共享状态再初始化作品列表`);
  assert.match(html, /data-local-book-summary/, `${name} 应使用统一的本地书信息区`);
  assert.match(html, /class="book-cover"[\s\S]*?class="cover-title"[\s\S]*?class="cover-author"/, `${name} 应显示封面、书名和作者`);
  assert.match(html, /阅读进度[\s\S]*?data-local-reading-progress/, `${name} 应显示阅读进度`);
  assert.doesNotMatch(html, />[^<]*(?:本地导入|EPUB|PDF)[^<]*</, `${name} 不应显示来源或格式标签`);
  assert.match(html, /data-local-reader-toolbar/, `${name} 应使用统一的本地书籍阅读工具栏`);
  assert.match(html, /data-local-reader-focus-stage/, `${name} 应支持统一的本地书籍专注模式`);
  assert.match(html, /data-local-reader-focus-toggle/, `${name} 应提供统一的专注阅读入口`);
  assert.match(html, /data-local-reader-focus-chrome/, `${name} 的手机专注模式应使用统一控制层`);
  assert.match(html, /data-local-reader-size-control="decrease"/, `${name} 应提供统一的缩小控制`);
  assert.match(html, /data-local-reader-size-control="increase"/, `${name} 应提供统一的放大控制`);
  assert.match(html, /data-local-reader-size-value/, `${name} 应显示统一的当前显示级别`);
  assert.match(html, /aria-label="当前阅读进度"/, `${name} 应使用统一的阅读进度状态`);
  assert.doesNotMatch(html, /字号|当前字号|当前缩放比例|适合宽度|当前页码/, `${name} 操作栏不应暴露格式专属术语`);
  assert.match(html, /class="[^"]*local-reader-workspace[^"]*"/, `${name} 应使用统一的本地书籍工作区骨架`);
  assert.match(html, /class="[^"]*local-reader-content[^"]*"/, `${name} 应使用统一的正文容器`);
  assert.match(html, /\.local-reader-workspace\s*\{[\s\S]*?grid-template-columns:\s*200px\s+minmax\(0,\s*1fr\)\s*;/, `${name} 的普通阅读界面不应为未打开的笔记侧栏预留宽度`);
  assert.match(html, /\.local-reader-workspace\[data-local-reader-context-open\]\s*\{[\s\S]*?grid-template-columns:\s*200px\s+minmax\(0,\s*1fr\)\s+300px/, `${name} 打开划线上下文后才应显示第三列`);
  assert.match(html, /\.local-reader-workspace\s*>\s*\[data-local-reader-focus-chrome\][\s\S]*?display:\s*none/, `${name} 的专注控制层不应参与普通页面布局`);
  assert.match(html, /data-local-reader-highlight/, `${name} 应提供可激活划线`);
  assert.match(html, /data-local-reader-context-panel[^>]*hidden/, `${name} 的上下文侧栏应默认收起`);
  assert.match(html, /data-local-reader-context-note-list/, `${name} 应显示当前划线的全部想法`);
  assert.match(html, /data-local-reader-context-add/, `${name} 应允许继续添加想法`);
  assert.match(html, /<mark[^>]*role="button"[^>]*tabindex="0"[^>]*data-local-reader-highlight/, `${name} 的划线应支持键盘激活`);
  const contextPanel = html.match(/<aside[^>]*data-local-reader-context-panel[\s\S]*?<\/aside>/)?.[0] || '';
  assert.doesNotMatch(contextPanel, /<textarea\b/, `${name} 不应在阅读侧栏常驻编辑框`);

  const navigation = html.match(/<nav class="book-mode-tabs"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(navigation, />阅读<\/button>[\s\S]*?>老己笔记<\/button>[\s\S]*?>读书 PPT<\/button>/, `${name} 应使用统一的三段按钮导航`);
  assert.doesNotMatch(navigation, /<a\b/, `${name} 的页内导航不应因文件格式使用不同控件`);

  const notes = html.match(/data-book-view-panel="notes"[\s\S]*?data-book-view-panel="ppt"/)?.[0] || '';
  const cards = [...notes.matchAll(/data-local-note-card/g)];
  assert.equal(cards.length, 2, `${name} 应提供两条同构的平铺笔记示例`);
  assert.match(notes, /data-local-note-list/, `${name} 应接入统一笔记交互`);
  assert.doesNotMatch(notes, /引用型|独立笔记|跨页引用|筛选笔记|>全部<|>划线<|>笔记</, `${name} 不应显示笔记类型或筛选`);
  assert.equal((notes.match(/class="source-tools source-action-popover"/g) || []).length, 2, `${name} 的笔记操作应悬浮显示`);
  assert.equal((notes.match(/>删除<\/button>[\s\S]*?>编辑<\/button>[\s\S]*?>复制<\/button>/g) || []).length, 2, `${name} 每条笔记应提供删除、编辑、复制`);
  assert.doesNotMatch(notes, /<h2>老己笔记<\/h2>/, `${name} 的笔记列表不应重复显示页签标题`);

  const ppt = html.match(/data-book-view-panel="ppt"[\s\S]*?<nav class="bottom-nav"/)?.[0] || '';
  assert.match(ppt, /class="[^"]*card entity-card[^"]*"/, `${name} 应使用统一的 PPT 作品卡片`);
  assert.doesNotMatch(ppt, /template-option|《[^》]+》的作品|返回对话制作/, `${name} 不应保留旧版 PPT 列表结构或重复说明`);
}

assert.match(js, /function initLocalBookNotes\(\)/, '本地书笔记应使用共享交互初始化');
assert.match(js, /function initLocalReadingProgress\(\)/, '本地书阅读进度应使用共享交互初始化');
assert.match(js, /function initLocalReaderHighlightContext\(\)/, '本地书应使用共享划线上下文交互');
assert.match(js, /function initLocalReadingProgress\(\)/, '本地书阅读进度应使用共享交互');

console.log('laoji-local-reader-unification: all tests passed');
