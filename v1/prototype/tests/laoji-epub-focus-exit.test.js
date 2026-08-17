const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('prototype/laoji-epub-reader.html', 'utf8');
const styles = html.match(/<style>[\s\S]*?<\/style>/)?.[0] || '';

assert.match(html, /data-local-reader-desktop-focus-exit[^>]*aria-label="退出专注阅读"[\s\S]*?>退出专注<[\s\S]*?<kbd>Esc<\/kbd>/, '桌面全屏应提供明确的退出专注按钮和 Esc 提示');
assert.match(styles, /@media \(min-width: 761px\)[\s\S]*?data-local-reader-focus-stage\]:fullscreen > \[data-local-reader-desktop-focus-exit\][\s\S]*?display:\s*inline-flex/, '桌面退出按钮只应在专注模式显示');
assert.match(html, /const focusExits = stage \? \[\.\.\.stage\.querySelectorAll\('\[data-local-reader-focus-exit\]'\)\] : \[\]/, '所有退出入口都应接入同一个退出逻辑');
assert.match(html, /focusExits\.forEach\(\(control\) => control\.addEventListener\('click', exitFocus\)\)/, '桌面与移动退出按钮都应可点击');
assert.match(html, /event\.key !== 'Escape'/, '仍应支持 Esc 退出专注模式');

console.log('laoji-epub-focus-exit: all tests passed');
