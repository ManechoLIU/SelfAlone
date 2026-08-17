(function () {
  'use strict';
  const KEYS = {
    seeded: 'laoji-state-seeded-v3',
    library: 'laoji-library-books',
    connections: 'laoji-connections',
    deletedSupplements: 'laoji-deleted-note-supplements',
    pptRecords: 'laoji-ppt-records',
    pptConversations: 'laoji-ppt-conversations'
  };
  const LIBRARY_SEED = [
    { id: 'weread-atomic-habits', title: '原子习惯', author: '詹姆斯·克利尔', format: 'EPUB', source: 'weread', href: 'laoji-wechat-book.html', cover: 'sage', sample: true },
    { id: 'local-deep-work', title: '深度工作', author: '卡尔·纽波特', format: 'EPUB', source: 'local', href: 'laoji-epub-reader.html', cover: 'ink', sample: true },
    { id: 'weread-courage', title: '被讨厌的勇气', author: '岸见一郎 古贺史健', format: 'EPUB', source: 'weread', href: 'laoji-wechat-book.html', cover: 'ochre', sample: true },
    { id: 'local-thinking', title: '思考，快与慢', author: '丹尼尔·卡尼曼', format: 'PDF', source: 'local', href: 'laoji-pdf-reader.html', cover: 'sage', sample: true },
    { id: 'weread-maybe-talk', title: '也许你该找个人聊聊：一个心理治疗师眼中的疗愈故事', author: '洛莉·戈特利布 Lori Gottlieb', format: 'EPUB', source: 'weread', href: 'laoji-wechat-book.html', cover: 'ink', sample: true },
    { id: 'local-atomic-habits', title: '原子习惯', author: '詹姆斯·克利尔', format: 'EPUB', source: 'local', href: 'laoji-epub-reader.html', cover: 'ochre', sample: true },
    { id: 'weread-deep-work', title: '深度工作', author: '卡尔·纽波特', format: 'EPUB', source: 'weread', href: 'laoji-wechat-book.html', cover: 'rust', sample: true },
    { id: 'local-courage', title: '被讨厌的勇气', author: '岸见一郎 古贺史健', format: 'PDF', source: 'local', href: 'laoji-pdf-reader.html', cover: 'sage', sample: true }
  ];
  const PPT_RECORD_SEED = [
    {
      id: 'ppt-task-atomic-habits',
      kind: 'task',
      status: 'generating',
      bookId: 'weread-atomic-habits',
      bookTitle: '原子习惯',
      title: '让好习惯自然发生',
      template: 'business',
      totalPages: 5,
      currentPage: 3,
      completedPages: 2,
      createdAt: '今天 13:42'
    },
    {
      id: 'ppt-work-atomic-habits',
      kind: 'work',
      status: 'completed',
      bookId: 'weread-atomic-habits',
      bookTitle: '原子习惯',
      title: '习惯系统：从目标到每天的行动',
      template: 'cards',
      totalPages: 5,
      currentPage: 5,
      completedPages: 5,
      createdAt: '昨天 18:20'
    },
    {
      id: 'ppt-work-local-atomic-habits',
      kind: 'work',
      status: 'completed',
      bookId: 'local-atomic-habits',
      bookTitle: '原子习惯',
      title: '微小改变如何形成复利',
      template: 'story',
      totalPages: 5,
      currentPage: 5,
      completedPages: 5,
      createdAt: '今天 09:16'
    },
    {
      id: 'ppt-task-thinking',
      kind: 'task',
      status: 'failed',
      bookId: 'local-thinking',
      bookTitle: '思考，快与慢',
      title: '两个系统：快速判断与深度思考',
      template: 'business',
      totalPages: 5,
      currentPage: 4,
      completedPages: 3,
      createdAt: '今天 13:42'
    }
  ];
  const memoryStore = new Map();
  function read(key, fallback) {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        const value = JSON.parse(stored);
        memoryStore.set(key, value);
        return value ?? fallback;
      }
    } catch (_) { /* Fall through to the in-memory store in restricted previews. */ }
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  }
  function write(key, value) {
    memoryStore.set(key, value);
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* Storage may be unavailable or full; keep the in-memory flow usable. */ }
    return value;
  }
  function seed() {
    const alreadySeeded = read(KEYS.seeded, false) === true;
    const library = read(KEYS.library, []);
    const connections = read(KEYS.connections, null);
    const deletedSupplements = read(KEYS.deletedSupplements, []);
    const pptRecords = read(KEYS.pptRecords, []);
    const migratedLibrary = [...(Array.isArray(library) ? library : [])];
    if (!alreadySeeded) {
      LIBRARY_SEED.forEach((book) => {
        if (!migratedLibrary.some((entry) => entry.id === book.id)) migratedLibrary.push(book);
      });
    }
    write(KEYS.library, migratedLibrary);
    write(KEYS.connections, connections && typeof connections === 'object' ? connections : { ai: 'unconfigured', weread: 'disconnected' });
    write(KEYS.deletedSupplements, Array.isArray(deletedSupplements) ? deletedSupplements.filter((id) => typeof id === 'string') : []);
    const migratedPptRecords = [...(Array.isArray(pptRecords) ? pptRecords : [])];
    if (!alreadySeeded) {
      PPT_RECORD_SEED.forEach((record) => {
        if (!migratedPptRecords.some((entry) => entry.id === record.id)) migratedPptRecords.push(record);
      });
    }
    write(KEYS.pptRecords, migratedPptRecords);
    write(KEYS.seeded, true);
  }
  function listLibraryBooks() { return [...read(KEYS.library, [])]; }
  function addLibraryBook(book) {
    if (!book || !book.id) return null;
    const next = { source: 'local', highlights: 0, notes: 0, ...book };
    write(KEYS.library, [next, ...read(KEYS.library, []).filter((entry) => entry.id !== next.id)]);
    return next;
  }
  function getConnection(kind) { return read(KEYS.connections, {})[kind] || (kind === 'ai' ? 'unconfigured' : 'disconnected'); }
  function setConnection(kind, value) { const next = { ...read(KEYS.connections, {}), [kind]: value }; write(KEYS.connections, next); return value; }
  function isNoteSupplementDeleted(id) { return typeof id === 'string' && read(KEYS.deletedSupplements, []).includes(id); }
  function deleteNoteSupplement(id) {
    if (typeof id !== 'string' || !id || isNoteSupplementDeleted(id)) return null;
    write(KEYS.deletedSupplements, [...read(KEYS.deletedSupplements, []), id]);
    return id;
  }
  function listPptRecords(bookId) {
    const records = read(KEYS.pptRecords, []);
    return (Array.isArray(records) ? records : [])
      .filter((record) => !bookId || record.bookId === bookId)
      .map((record) => ({ ...record }));
  }
  function getPptRecord(id) {
    return listPptRecords().find((record) => record.id === id) || null;
  }
  function createPptTask(input) {
    if (!input?.bookId || !input?.title) return null;
    const outlineSnapshot = Array.isArray(input.outlineSnapshot)
      ? input.outlineSnapshot
        .filter((slide) => Array.isArray(slide) && slide.length >= 2)
        .map(([title, points, imageIntent]) => [String(title), String(points), String(imageIntent || '')])
      : [];
    const task = {
      id: input.id || `ppt-task-${Date.now()}`,
      kind: 'task',
      status: 'generating',
      bookId: input.bookId,
      bookTitle: input.bookTitle || '',
      title: input.title,
      template: input.template || 'business',
      totalPages: Math.max(1, Number(input.totalPages) || 1),
      currentPage: 1,
      completedPages: 0,
      outlineSnapshot,
      previewScrollTop: 0,
      createdAt: input.createdAt || '刚刚',
      entry: input.entry === 'book' ? 'book' : 'conversation'
    };
    write(KEYS.pptRecords, [task, ...listPptRecords().filter((record) => record.id !== task.id)]);
    return { ...task };
  }
  function updatePptTask(id, patch) {
    const records = listPptRecords();
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return null;
    const next = { ...records[index], ...patch, id: records[index].id, bookId: records[index].bookId };
    if (next.status === 'completed') {
      next.kind = 'work';
      next.currentPage = next.totalPages;
      next.completedPages = next.totalPages;
    }
    records[index] = next;
    write(KEYS.pptRecords, records);
    return { ...next };
  }
  function removePptRecord(id) {
    const records = listPptRecords();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    write(KEYS.pptRecords, next);
    return true;
  }
  const DEFAULT_PPT_DRAFT = {
    scope: 'full',
    purpose: '',
    audience: '',
    pageCount: 5,
    outline: [],
    template: ''
  };
  const DEFAULT_PPT_UI = {
    sessionListMode: 'collapsed',
    workbenchOpen: true,
    chatScrollTop: 0,
    workbenchScrollTop: 0
  };
  function isPptConversationObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function isValidPptConversationId(id) {
    return typeof id === 'string' && id.trim() !== '';
  }
  function normalizePptConversation(input, existing) {
    const source = isPptConversationObject(input) ? input : {};
    const base = isPptConversationObject(existing) ? existing : {};
    const sourceDraft = isPptConversationObject(source.draft) ? source.draft : {};
    const baseDraft = isPptConversationObject(base.draft) ? base.draft : {};
    const sourceUi = isPptConversationObject(source.ui) ? source.ui : {};
    const baseUi = isPptConversationObject(base.ui) ? base.ui : {};
    const revision = Number(source.revision || base.revision || 1);
    const messages = Array.isArray(source.messages)
      ? source.messages.map((message) => message)
      : (Array.isArray(base.messages) ? base.messages.map((message) => message) : []);
    return {
      ...base,
      ...source,
      id: source.id || base.id,
      entry: source.entry || base.entry || 'conversation',
      stage: source.stage || base.stage || 'scope',
      messages,
      draft: {
        ...DEFAULT_PPT_DRAFT,
        ...baseDraft,
        ...sourceDraft,
        outline: Array.isArray(sourceDraft.outline)
          ? sourceDraft.outline.map((slide) => slide)
          : (Array.isArray(baseDraft.outline) ? baseDraft.outline.map((slide) => slide) : [])
      },
      ui: {
        sessionListMode: sourceUi.sessionListMode || baseUi.sessionListMode || DEFAULT_PPT_UI.sessionListMode,
        workbenchOpen: typeof sourceUi.workbenchOpen === 'boolean'
          ? sourceUi.workbenchOpen
          : (typeof baseUi.workbenchOpen === 'boolean' ? baseUi.workbenchOpen : DEFAULT_PPT_UI.workbenchOpen),
        chatScrollTop: Number.isFinite(Number(sourceUi.chatScrollTop))
          ? Number(sourceUi.chatScrollTop)
          : (Number(baseUi.chatScrollTop) || DEFAULT_PPT_UI.chatScrollTop),
        workbenchScrollTop: Number.isFinite(Number(sourceUi.workbenchScrollTop))
          ? Number(sourceUi.workbenchScrollTop)
          : (Number(baseUi.workbenchScrollTop) || DEFAULT_PPT_UI.workbenchScrollTop)
      },
      revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 1,
      updatedAt: source.updatedAt || base.updatedAt || new Date().toISOString()
    };
  }
  function listPptConversations() {
    const stored = read(KEYS.pptConversations, []);
    return (Array.isArray(stored) ? stored : [])
      .filter((conversation) => isPptConversationObject(conversation) && isValidPptConversationId(conversation.id))
      .map((conversation) => normalizePptConversation(conversation));
  }
  function getPptConversation(id) {
    if (!isValidPptConversationId(id)) return null;
    return listPptConversations().find((conversation) => conversation.id === id) || null;
  }
  function upsertPptConversation(input) {
    if (!isPptConversationObject(input) || !isValidPptConversationId(input.id)) return null;
    const conversations = listPptConversations();
    const index = conversations.findIndex((conversation) => conversation.id === input.id);
    const existing = index >= 0 ? conversations[index] : null;
    const now = new Date().toISOString();
    const next = normalizePptConversation({
      ...input,
      id: input.id,
      revision: existing ? existing.revision + 1 : 1,
      updatedAt: existing ? now : (input.updatedAt || now)
    }, existing);
    if (index >= 0) conversations[index] = next;
    else conversations.unshift(next);
    write(KEYS.pptConversations, conversations);
    return normalizePptConversation(next);
  }
  function updatePptConversation(id, patch, expectedRevision) {
    if (!isValidPptConversationId(id) || !isPptConversationObject(patch)) return null;
    const conversations = listPptConversations();
    const index = conversations.findIndex((conversation) => conversation.id === id);
    if (index < 0 || conversations[index].revision !== expectedRevision) return null;
    const now = new Date().toISOString();
    const existing = conversations[index];
    const next = normalizePptConversation({
      ...patch,
      id: existing.id,
      revision: expectedRevision + 1,
      updatedAt: now
    }, existing);
    conversations[index] = next;
    write(KEYS.pptConversations, conversations);
    return normalizePptConversation(next);
  }
  window.LaojiState = {
    KEYS,
    read,
    write,
    seed,
    listLibraryBooks,
    addLibraryBook,
    getConnection,
    setConnection,
    isNoteSupplementDeleted,
    deleteNoteSupplement,
    listPptRecords,
    getPptRecord,
    createPptTask,
    updatePptTask,
    removePptRecord,
    listPptConversations,
    getPptConversation,
    upsertPptConversation,
    updatePptConversation
  };
}());
