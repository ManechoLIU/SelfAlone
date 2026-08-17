const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'laoji.js'),
  'utf8'
);

const directAccesses = source.match(/window\.localStorage/g) || [];
assert.equal(
  directAccesses.length,
  3,
  '主交互脚本只能在安全存储适配器内部访问 window.localStorage'
);
assert.match(source, /const safeStorage =/);

console.log('laoji-script-storage: all tests passed');
