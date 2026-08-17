const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const stateSource = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'laoji-state.js'),
  'utf8'
);

function loadState(localStorage) {
  const window = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      if (localStorage instanceof Error) throw localStorage;
      return localStorage;
    }
  });
  vm.runInNewContext(stateSource, { window });
  return window.LaojiState;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

{
  const state = loadState(new Error('Storage is disabled in this preview'));
  state.seed();
  const books = state.listLibraryBooks();

  assert.equal(books.length, 8, '无本地存储时仍应显示八本示例书');
  assert.ok(books.some((book) => book.href === 'laoji-wechat-book.html'));
  assert.ok(books.some((book) => book.href === 'laoji-epub-reader.html'));
  assert.ok(books.some((book) => book.href === 'laoji-pdf-reader.html'));
}

{
  const state = loadState(createStorage());
  state.seed();
  state.seed();
  assert.equal(state.listLibraryBooks().length, 8, '重复初始化不应产生重复书籍');
}

{
  const state = loadState(createStorage());
  state.seed();

  const created = state.upsertPptConversation({
    id: 'ppt-conversation-test',
    title: '测试 PPT 会话',
    bookId: 'weread-atomic-habits',
    bookTitle: '原子习惯',
    stage: 'scope',
    messages: 'invalid messages',
    draft: { purpose: '读书分享', outline: [['第一页', '要点', '']] },
    ui: { workbenchOpen: false }
  });
  assert.equal(created.revision, 1, '新建 PPT 会话 revision 应从 1 开始');
  assert.equal(created.entry, 'conversation');
  assert.equal(Array.isArray(created.messages), true, 'messages 必须为数组');
  assert.equal(created.messages.length, 0, '无效 messages 必须规范化为空数组');
  assert.equal(JSON.stringify(created.draft), JSON.stringify({
    scope: 'full',
    purpose: '读书分享',
    audience: '',
    pageCount: 5,
    outline: [['第一页', '要点', '']],
    template: ''
  }), 'draft 应以默认值为基础浅层合并');
  assert.equal(state.getPptConversation(created.id).ui.sessionListMode, 'collapsed', '会话列表默认应收起');
  assert.equal('navExpanded' in state.getPptConversation(created.id).ui, false, '一级导航状态不得写入 PPT 会话 UI');
  assert.equal(state.getPptConversation(created.id).ui.workbenchOpen, false, '传入的界面状态应保留');

  const updated = state.updatePptConversation(created.id, { stage: 'outline' }, created.revision);
  assert.equal(updated.stage, 'outline', '合法 revision 更新应写入阶段');
  assert.equal(updated.revision, 2, '合法 revision 更新应递增');
  assert.equal(
    state.updatePptConversation(created.id, { stage: 'template' }, created.revision),
    null,
    '旧 revision 不得覆盖新状态'
  );
  assert.equal(state.getPptConversation(created.id).stage, 'outline', '旧 revision 失败后状态不得改变');
}

{
  const state = loadState(createStorage());
  state.seed();
  assert.equal(state.upsertPptConversation({ title: '缺少 ID' }), null, '无有效 id 的会话不得写入');
  assert.equal(state.listPptConversations().length, 0, '无效 upsert 不得留下损坏记录');
}

console.log('laoji-state: all tests passed');
