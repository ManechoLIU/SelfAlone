const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const [name, path] of [
  ['EPUB', 'prototype/laoji-epub-reader.html'],
  ['PDF', 'prototype/laoji-pdf-reader.html'],
]) {
  const html = fs.readFileSync(path, 'utf8');
  const toolbar = html.split('\n').find((line) => line.includes('data-local-reader-toolbar') && line.includes('local-reader-toc-action')) || '';
  const styles = html.match(/<style>[\s\S]*?<\/style>/)?.[0] || '';

  assert.match(toolbar, /data-local-reader-toc-action[\s\S]*?class="local-reader-toc-label">目录<\/span>/, `${name} 普通阅读工具栏应清楚显示目录标签`);
  assert.doesNotMatch(toolbar, /data-local-reader-note-action/, `${name} 写笔记不应挤在阅读控制条中`);
  assert.match(html, /class="local-reader-note-fab"[^>]*data-local-reader-note-action/, `${name} 应保留独立的写笔记入口`);
  assert.match(toolbar, /class="local-reader-focus-icon"/, `${name} 专注阅读应使用与参考图一致的叶片图标`);
  assert.match(styles, /\.local-reader-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap;/, `${name} 工具栏不得换行`);
  assert.match(styles, /\.local-reader-content > \[data-local-reader-toolbar\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*auto;[\s\S]*?bottom:\s*24px;/, `${name} 固定工具栏必须清除旧的顶部定位，避免被上下拉伸`);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.local-reader-content > \[data-local-reader-toolbar\]\s*\{[\s\S]*?left:\s*50%;[\s\S]*?width:\s*calc\(100% - 24px\);[\s\S]*?max-width:\s*430px;/, `${name} 手机工具栏应在安全宽度内居中`);
}

console.log('laoji-reader-toolbar-reference: all tests passed');
