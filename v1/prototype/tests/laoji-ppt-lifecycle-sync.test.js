const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const outline = read('laoji-ppt-outline.html');
const preview = read('laoji-ppt-preview.html');
const materials = read('laoji-ppt-materials.html');
const css = read('assets/laoji.css');
const js = read('assets/laoji.js');
const state = read('assets/laoji-state.js');
const bookPages = [
  ['微信读书', read('laoji-wechat-book.html')],
  ['EPUB', read('laoji-epub-reader.html')],
  ['PDF', read('laoji-pdf-reader.html')]
];

assert.match(outline, /data-outline-document/, '大纲应使用带页边界的连续文档');
assert.ok((outline.match(/data-outline-page/g) || []).length >= 5, '连续大纲应直接展示全部页面');
assert.match(outline, /data-outline-title[^>]*contenteditable="true"/, '页标题应支持正文内直接编辑');
assert.match(outline, /data-outline-points[^>]*contenteditable="true"/, '页内容应支持正文内直接编辑');
assert.doesNotMatch(outline, /创建新版本|版本\s*[12]|上一页|下一页/, '大纲不得保留版本管理或逐页切换文案');
assert.match(outline, />确认大纲并选择模板</, '大纲唯一主操作应进入模板选择');

assert.match(preview, /data-ppt-waterfall/, '模板、生成与预览应共用纵向瀑布流');
assert.ok((preview.match(/data-ppt-page/g) || []).length >= 5, '瀑布流应展示全部 PPT 页面');
assert.match(preview, /data-ppt-page-state="complete"/, '瀑布流应包含已完成页面状态');
assert.match(preview, /data-ppt-page-state="current"/, '瀑布流应包含当前生成页面状态');
assert.match(preview, /data-ppt-page-state="waiting"/, '瀑布流应包含等待生成页面状态');
assert.match(preview, /data-generate-ppt[^>]*>开始生成 PPT</, '确认模板后才应启动最终生成');
assert.doesNotMatch(preview, /上一页|下一页|创建新版本|大纲版本/, '模板与生成页不得保留单页翻页或版本文案');
assert.doesNotMatch(preview, /class="preview-state-tools"|制作流程/, '生成、失败和完成作品不应继续占用模板或流程侧栏');
assert.match(preview, /data-preview-state="complete"[\s\S]*?data-create-draft-from-work="template"[^>]*>更换模板</, '完成作品应提供派生新模板草稿的入口');
assert.match(preview, /data-preview-state="complete"[\s\S]*?preview-state-meta[\s\S]*?>已完成</, '完成作品应明确显示已完成状态');

assert.match(state, /pptRecords:\s*'laoji-ppt-records'/, '共享状态应持久化 PPT 任务与作品');
assert.match(state, /function listPptRecords\(bookId\)/, '共享状态应按书籍提供任务与作品列表');
assert.match(state, /function createPptTask\(input\)/, '点击开始生成后应创建独立任务');
assert.match(state, /outlineSnapshot[\s\S]*?previewScrollTop:\s*0/, '生成任务应保存大纲快照与作品滚动位置');
assert.match(state, /function updatePptTask\(id, patch\)/, '会话与书籍列表应更新同一任务记录');
assert.match(js, /\['generating', 'finalizing'\]\.includes\(record\.status\)/, '完成文件阶段仍应作为生成中任务显示');
assert.match(js, /function renderBookPptLists\(\)/, '共享脚本应从统一状态渲染书籍 PPT 列表');
assert.match(js, /function createBookPptCover\(record, visualStatus\)/, '书籍 PPT 列表应从共享记录渲染真实模板封面');
assert.match(js, /record\.template[\s\S]*?ppt-template-/, '作品封面应沿用生成时选择的模板');
assert.match(js, /const recordLink = document\.createElement\('a'\)/, '书籍 PPT 记录应使用整卡链接进入作品');
assert.match(js, /recordLink\.setAttribute\('aria-label',/, '整卡作品链接应提供包含状态与标题的可访问名称');
assert.doesNotMatch(js, /download\.textContent = '下载 PPTX'/, '完成作品列表不得重复提供下载按钮');
assert.match(js, /resume\.textContent = '继续'/, '失败任务应只保留简短继续操作');
assert.doesNotMatch(js, /status\.textContent = isGenerating \? '生成中'[^\n]+?'完成作品'/, '作品列表不得重复显示泛化状态标题');
assert.match(js, /function renderPptWaterfall\(/, '共享脚本应渲染逐页瀑布流状态');
assert.match(js, /let selectedTemplate = currentRecord\?\.template \|\| savedTemplate/, '从书籍列表恢复作品时应优先使用作品记录中的模板');
assert.match(js, /renderPptWaterfall\(\$\('\[data-waterfall-mode="preview"\]'\)[\s\S]*?applyTemplate\(selectedTemplate\)/, '重绘预览后应重新套用当前模板');
assert.match(js, /if \(record\?\.template\) frame\.dataset\.template = record\.template/, '生成中、失败和完成瀑布流应使用任务记录中的模板');
assert.match(js, /currentRecord\?\.outlineSnapshot[\s\S]*?currentRecord\.outlineSnapshot\.map/, '重新打开任务或作品时应恢复生成时的大纲快照');
assert.match(js, /previewScrollTop[\s\S]*?canvas\.scrollTop/, '重新打开任务或作品时应恢复瀑布流滚动位置');
assert.match(js, /url\.searchParams\.delete\('record'\)[\s\S]*?data-create-draft-from-work/, '从完成作品创建新草稿时应脱离旧作品记录');
assert.match(js, /const editor = \$\('\[data-outline-editor\]'\);\s*if \(!editor\) return;\s*const documentRoot/, '非大纲页不得因缺少编辑器节点阻断其余 PPT 初始化');
assert.match(js, /const pageCountSegments = pageCountGroup \? \$\$\('\[data-segment\]', pageCountGroup\) : \[\];/, '新版材料页缺少旧分段控件时仍应继续初始化草稿');
assert.match(js, /url\.searchParams\.delete\('record'\);\s*url\.searchParams\.delete\('state'\);/, '删除失败任务后应清理作品与强制错误参数');
assert.match(js, /正在生成第 \$\{[^}]+\} \/ \$\{[^}]+\} 页/, '生成进度应使用明确的第 N / 总页数文案');
assert.match(js, /const visibleState = nextState === 'finalizing' \? 'generating' : nextState/, '正在完成文件应复用无侧栏的生成作品区');
assert.match(js, /nextState === 'finalizing'[\s\S]*?'正在完成文件'/, '最后一页完成后应显示正在完成文件，而不是继续显示页面生成中');
assert.match(js, /existingRecord\?\.status === 'finalizing'[\s\S]*?setPreviewState\('finalizing'\)/, '重新打开正在完成文件的任务时应恢复 finalizing，而不是退回逐页生成');
assert.match(js, /data-create-draft-from-work[\s\S]*?currentRecord = null;[\s\S]*?url\.searchParams\.delete\('record'\)[\s\S]*?setPreviewState\('ready'\)/, '更换模板或重新生成应脱离旧作品并回到生成前草稿');
assert.match(js, /const sourceSlides = Array\.isArray\(currentRecord\?\.outlineSnapshot\)[\s\S]*?safeStorage\.setItem\(PPT_OUTLINE_KEY/, '从完成作品派生草稿时应复制该作品的大纲快照，而不是复用其他草稿');
assert.match(js, /const headingCopy = nextState === 'ready'[\s\S]*?'PPT 已完成'[\s\S]*?data-preview-heading/, '作品顶栏应随生成生命周期切换语义，而不是始终显示模板选择');

for (const [name, html] of bookPages) {
  assert.match(html, /data-book-id="[^"]+"/, `${name} 详情应声明当前书籍 ID`);
  assert.match(html, /data-book-ppt-list/, `${name} 详情应从共享状态渲染读书 PPT`);
  assert.match(html, /ppt-record-card is-loading[\s\S]*?ppt-record-loading-copy/, `${name} 加载态应复用紧凑横向作品行结构`);
  assert.doesNotMatch(html, /读取生成任务与作品|不会提前显示空状态/, `${name} 加载态不得显示实现解释文案`);
  assert.doesNotMatch(html, /回到作品会话|大纲版本|待生成/, `${name} 列表不得显示固定返回、版本或生成前草稿`);
  for (const asset of ['laoji.css', 'laoji-navigation.js', 'laoji-state.js', 'laoji.js']) {
    const canonicalRevision = materials.match(new RegExp(`assets/${asset.replace('.', '\\.')}(\\?v=[^"']+)`))?.[1];
    assert.ok(canonicalRevision, `PPT 材料页应声明 ${asset} 的共享资源修订`);
    assert.match(html, new RegExp(`assets/${asset.replace('.', '\\.')}\\${canonicalRevision}`), `${name} 应加载与 PPT 工作流一致的 ${asset} 修订，避免旧列表缓存`);
  }
}

assert.match(css, /\.ppt-outline-document\s*\{/, '共享样式应定义连续大纲文档');
assert.match(css, /\.ppt-waterfall\s*\{/, '共享样式应定义 PPT 纵向瀑布流');
assert.match(css, /\.ppt-record-cover\s*\{[^}]*align-self:\s*start/s, '作品卡片封面不应被正文和操作区拉伸');
assert.match(css, /\.ppt-record-cover-state\s*\{/, '生成中和失败封面应显示明确状态');
assert.match(css, /\.book-ppt-list\s*\{[^}]*grid-template-columns:\s*1fr/s, '书籍作品索引在所有视口都应保持单列');
assert.doesNotMatch(css, /\.book-ppt-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s, '桌面作品索引不得再切换成双列');
assert.match(css, /\.ppt-record-card\.is-loading\s*\{[^}]*grid-template-columns:\s*148px\s+minmax\(0,\s*1fr\)/s, '桌面加载态应与真实作品使用相同横向网格');
assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.book-ppt-list\s*\{[^}]*grid-template-columns:\s*1fr/s, '手机作品索引应固定为单列');
assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.ppt-record-card\.is-loading\s*\{[^}]*grid-template-columns:\s*112px\s+minmax\(0,\s*1fr\)/s, '手机加载态应沿用参考图的紧凑横向作品行');
assert.match(css, /\[data-ppt-page-state="current"\]/, '当前生成页应有独立视觉状态');
assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.ppt-waterfall/s, '手机作品层应重新组织瀑布流');

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); }
};
const context = { window: { localStorage } };
vm.runInNewContext(state, context);
context.window.LaojiState.seed();
const bookRecordsBeforeConversation = context.window.LaojiState.listPptRecords('weread-atomic-habits');
const conversation = context.window.LaojiState.upsertPptConversation({
  id: 'ppt-conversation-lifecycle-test',
  title: '连续会话测试',
  bookId: 'weread-atomic-habits',
  bookTitle: '原子习惯',
  stage: 'scope',
  draft: { scope: 'full', purpose: '测试' }
});
assert.equal(conversation.stage, 'scope', '范围阶段应保留为会话草稿状态');
assert.deepEqual(
  context.window.LaojiState.listPptRecords('weread-atomic-habits'),
  bookRecordsBeforeConversation,
  '创建范围会话不得提前进入书籍 PPT 任务/作品列表'
);
assert.equal(context.window.LaojiState.getPptRecord(conversation.id), null, '会话草稿不得伪装成 PPT 任务或作品');
let continuous = conversation;
for (const [stage, messageId] of [
  ['outline', 'scope-confirmed'],
  ['template', 'outline-confirmed'],
  ['generating', 'template-confirmed'],
  ['complete', 'generation-complete']
]) {
  continuous = context.window.LaojiState.updatePptConversation(continuous.id, {
    stage,
    messages: [...continuous.messages, { id: messageId, role: 'assistant', text: stage }]
  }, continuous.revision);
  assert.equal(continuous.id, conversation.id, `${stage} 阶段必须沿用同一个会话 ID`);
}
assert.deepEqual(continuous.messages.map((message) => message.id), [
  'scope-confirmed',
  'outline-confirmed',
  'template-confirmed',
  'generation-complete'
], '阶段消息必须只追加、不覆盖');
const staleRevision = continuous.revision - 1;
assert.equal(context.window.LaojiState.updatePptConversation(continuous.id, { stage: 'failed' }, staleRevision), null, '过期生成回调不得覆盖更新后的阶段');
assert.equal(context.window.LaojiState.getPptConversation(continuous.id).stage, 'complete', '过期回调失败后应保留新阶段');
assert.equal(context.window.LaojiState.removePptRecord('ppt-task-atomic-habits'), true, '示例任务应可删除');
context.window.LaojiState.seed();
assert.equal(context.window.LaojiState.getPptRecord('ppt-task-atomic-habits'), null, '已删除任务刷新后不得被种子数据补回');

console.log('laoji-ppt-lifecycle-sync: all tests passed');
