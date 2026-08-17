const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('prototype/laoji-pdf-reader.html', 'utf8');

assert.match(html, /data-pdf-focus-stage/, 'PDF 阅读区应保留专注模式容器');
assert.match(html, /data-pdf-focus-chrome/, '手机专注模式应提供按需唤起的控制层');
assert.match(html, /data-pdf-focus-exit/, '控制层顶部应提供退出专注入口');
assert.match(html, /data-pdf-focus-toc-toggle/, '控制层底部应提供目录入口');
assert.match(html, /data-pdf-focus-toc-backdrop/, '手机目录应以临时抽屉呈现并支持点击遮罩关闭');

assert.match(
  html,
  /@media \(max-width: 760px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  '手机专注模式不应为固定目录栏预留宽度',
);
assert.match(
  html,
  /@media \(max-width: 760px\)[\s\S]*?\.pdf-toolbar[\s\S]*?display:\s*none/,
  '手机专注模式默认不应显示原桌面工具条',
);
assert.match(
  html,
  /\.pdf-focus-controls-visible[\s\S]*?data-pdf-focus-chrome/,
  '控制层只能在显式唤起状态中显示',
);

assert.match(html, /window\.matchMedia\('\(max-width: 760px\)'\)/, '交互只应在手机断点启用');
assert.match(html, /const AUTO_HIDE_DELAY = 3000/, '控制层应在三秒无操作后自动隐藏');
assert.match(html, /stage\.addEventListener\('click'/, '应支持轻触阅读区域切换控制层');
assert.match(html, /pdfStage\?\.addEventListener\('scroll'/, '滚动阅读时应立即隐藏控制层');
assert.match(html, /window\.getSelection\(\)/, '选择文字时不应误唤起控制层');
assert.match(html, /data-pdf-focus-toc-open/, '目录抽屉应有独立的开合状态');
assert.doesNotMatch(html, /data-toast="已适合页面宽度"|适合宽度|当前页码/, 'PDF 专注工具栏不应暴露格式专属控件');

console.log('laoji-pdf-mobile-focus: all tests passed');
