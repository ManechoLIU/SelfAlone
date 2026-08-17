const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(prototypeDir, file), 'utf8');
const htmlFiles = fs.readdirSync(prototypeDir).filter((file) => file.endsWith('.html')).sort();

const library = read('laoji-library.html');
assert.equal((library.match(/data-book=""/g) || []).length, 8, '书架应自带八本可见示例书');
assert.equal((library.match(/class="book-cover-image"/g) || []).length, 8, '每本书应使用可识别的本地封面图片');
assert.doesNotMatch(library, /class="cover-(?:title|author)"/, '书架卡片不应重复显示书名和作者');
assert.doesNotMatch(library, /class="book-meta"/, '书架封面下不应重复书名和作者');
assert.doesNotMatch(library, /cover-kicker">微信读书</, '微信读书书籍不应显示来源角标');
assert.doesNotMatch(library, /本地 (?:EPUB|PDF)/, '本地书不应暴露文件格式来源');
assert.doesNotMatch(library, /class="local-import-badge"/, '本地书封面不应显示来源角标');

assert.equal(fs.existsSync(path.join(prototypeDir, 'laoji-notes.html')), false, '独立老己笔记页面应删除');
assert.equal(htmlFiles.length, 16, '定稿原型应包含十六个用户页面');
for (const file of htmlFiles) {
  assert.doesNotMatch(read(file), /laoji-notes\.html/, `${file} 不应再链接独立老己笔记页`);
}

const chat = read('laoji-chat.html');
assert.match(chat, /data-book-picker/, '普通对话应提供带封面的选书消息');
assert.ok((chat.match(/class="[^"]*ppt-book-choice/g) || []).length >= 3, '选书消息应至少展示三本书');
assert.doesNotMatch(chat, /data-od-id="chat-context-panel"/, '对话页不应保留右侧当前上下文栏');
assert.match(chat, /chat-layout-no-context[\s\S]*?grid-template-columns: 220px minmax\(0, 1fr\)/, '移除右栏后桌面对话内容应扩展到剩余空间');
assert.equal((chat.match(/href="\.\/laoji-settings\.html"/g) || []).length, 3, '对话页三个设置入口应使用明确的同级设置页链接');
assert.doesNotMatch(chat, /data-settings-navigation|window\.location\.assign/, '设置入口应保留原生导航，不应被脚本拦截');

for (const file of ['laoji-ppt-materials.html', 'laoji-ppt-outline.html', 'laoji-ppt-preview.html']) {
  const html = read(file);
  assert.match(html, /data-ppt-chat-shell/, `${file} 应使用统一 PPT 会话壳层`);
  assert.match(html, /data-chat-feed/, `${file} 应保留可见聊天记录`);
  assert.match(html, /data-ppt-chat-pane/, `${file} 应标记会话区域`);
}

assert.match(read('laoji-ppt-outline.html'), /data-outline-canvas/, '大纲应在会话内嵌作品画布中编辑');
assert.match(read('laoji-ppt-preview.html'), /data-preview-canvas/, '预览应在会话内嵌作品画布中完成');

for (const file of ['laoji-wechat-book.html', 'laoji-epub-reader.html', 'laoji-pdf-reader.html']) {
  const html = read(file);
  assert.match(html, /data-book-notes-panel/, `${file} 应在当前书籍中承载老己笔记`);
  assert.match(html, /data-book-ppt-panel/, `${file} 应在当前书籍中承载读书 PPT`);
}

console.log('laoji-reading-ppt-redesign: all tests passed');
