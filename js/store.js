/**
 * 全局状态 + localStorage 持久化
 * 所有页面只通过这里读写数据，便于单点修改。
 */

import {
  defaultPromptConfig, upgradePromptConfig, isDataBlock, blockId, VOLATILE_BLOCK
} from './services/promptSchema.js';

const KEY = 'ai_writer_state_v1';

const LIB_KEYS = ['roles', 'worlds', 'ideas'];

const DEFAULTS = {
  settings: {
    apiBase: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.9,
    maxTokens: 0
  },
  /** API 配置预设：切换不同服务商/Key 用 */
  apiPresets: [],       // { id, name, apiBase, apiKey, model, temperature, maxTokens }
  activeApiPreset: '',  // 当前生效预设 id

  appearance: {
    theme: 'system',    // system | light | dark
    accent: '',         // 主题色，空 = 用默认
    uiFont: { url: '', family: '' },
    novelFont: { url: '', family: '' },
    backgrounds: {
      home: { src: '', opacity: 0.35 },
      shelf: { src: '', opacity: 0.35 },
      me: { src: '', opacity: 0.35 }
    },
    barOpacity: { top: 0.75, bottom: 0.9 },
    /** 卡片/弹窗/输入框底色透明度 */
    surfaceOpacity: 1,
    /** 字号：数值为 px，1 倍基准 = 界面 15px / 正文 16.5px */
    fontSize: { ui: 15, novel: 16.5 }
  },

  /** 可自定义的提示词（按块拼接） */
  prompt: {
    create: defaultPromptConfig('create'),
    continue: defaultPromptConfig('continue'),
    comment: defaultPromptConfig('comment')
  },

  profile: { avatar: '', nickname: '', bio: '' },

  /** 首页草稿，切页后不丢 */
  draft: { title: '', html: '' },

  roles: [],    // { id, title, detail, folderId }
  worlds: [],
  ideas: [],
  folders: { roles: [], worlds: [], ideas: [] }, // { id, name }

  presets: [],  // 输入预设 { id, title, fieldTitle, html }
  creations: [],// { id, title, request(用户输入), content(AI返回), createdAt, bookId }
  books: []     // { id, title, intro, chapters:[{ id, title, content, createdAt }], createdAt }
};

/** 集合名 -> 展示信息 */
export const COLLECTIONS = {
  role: { key: 'roles', label: '角色', placeholder: '角色设定', icon: 'person' },
  world: { key: 'worlds', label: '世界书', placeholder: '世界设定', icon: 'globe' },
  idea: { key: 'ideas', label: '灵感', placeholder: '灵感内容', icon: 'bulb' }
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------- 装载 / 合并 ---------------- */

function isPlain(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** 评论：id / 时间 / 网名 / 内容 / 回复对象 */
function normalizeComments(comments) {
  return (comments || []).map((m) => ({
    id: m.id || uid(),
    createdAt: m.createdAt || Date.now(),
    name: m.name || '匿名',
    text: m.text || '',
    replyTo: m.replyTo || ''
  }));
}

/** 章节必须有 id，否则详情页取不到数据 */
function normalizeChapters(chapters) {
  return (chapters || []).map((c) => ({
    id: c.id || uid(),
    createdAt: c.createdAt || Date.now(),
    title: c.title || '未命名',
    content: c.content || '',
    comments: normalizeComments(c.comments)
  }));
}

function migrate(s) {
  s.books = (s.books || []).map((b) => ({
    ...b,
    intro: b.intro || '',
    chapters: normalizeChapters(b.chapters)
  }));
  LIB_KEYS.forEach((k) => {
    s[k] = (s[k] || []).map((it) => ({ folderId: '', ...it }));
  });
  s.folders = LIB_KEYS.reduce((acc, k) => {
    acc[k] = (s.folders && s.folders[k]) || [];
    return acc;
  }, {});
  // 提示词：缺块或块损坏时补回默认，保证每个数据块有 id
  s.prompt = s.prompt || {};
  ['create', 'continue', 'comment'].forEach((kind) => {
    const cfg = s.prompt[kind];
    if (!cfg || !Array.isArray(cfg.blocks) || !cfg.blocks.length) {
      s.prompt[kind] = defaultPromptConfig(kind);
      return;
    }
    cfg.blocks = cfg.blocks.map((b) => ({ enabled: true, ...b, id: b.id || blockId() }));
    upgradePromptConfig(kind, cfg);
  });
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return migrate(deepMerge(structuredClone(DEFAULTS), parsed));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();
const listeners = new Set();

/** 迁移/补全后立刻回写，脏数据只修一次 */
persist();

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[store] 持久化失败', e);
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  persist();
  listeners.forEach((fn) => fn(state));
}

/* ---------------- 通用集合操作 ---------------- */

export function list(collection) {
  return state[collection] || [];
}

export function get(collection, id) {
  return (state[collection] || []).find((it) => it.id === id) || null;
}

export function add(collection, data) {
  const item = { id: uid(), createdAt: Date.now(), ...data };
  state[collection] = [item, ...(state[collection] || [])];
  emit();
  return item;
}

export function update(collection, id, patch) {
  const arr = state[collection] || [];
  const idx = arr.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], ...patch, updatedAt: Date.now() };
  emit();
  return arr[idx];
}

export function remove(collection, ids) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  state[collection] = (state[collection] || []).filter((it) => !set.has(it.id));
  emit();
}

export function findByTitle(collection, title) {
  return (state[collection] || []).find((it) => it.title === title) || null;
}

/** 某分类下的条目（folderId 为空表示根目录） */
export function itemsIn(collection, folderId = '') {
  return list(collection).filter((it) => (it.folderId || '') === (folderId || ''));
}

/* ---------------- 设置 / 外观 / 用户 ---------------- */

export function patchSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit();
}

export function patchAppearance(patch) {
  state.appearance = deepMerge(state.appearance, patch);
  emit();
}

export function patchProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  emit();
}

export function patchDraft(patch) {
  state.draft = { ...state.draft, ...patch };
  emit();
}

/* ---------------- 提示词 ---------------- */

export function promptOf(kind) {
  return state.prompt[kind];
}

export function setPromptSystem(kind, system) {
  state.prompt[kind].system = system;
  emit();
}

/** 整表替换（拖动排序后按 DOM 顺序回写） */
export function setPromptBlocks(kind, blocks) {
  state.prompt[kind].blocks = blocks;
  emit();
}

export function addPromptBlock(kind, block) {
  const item = { id: blockId(), enabled: true, type: 'text', ...block };
  const list = [...state.prompt[kind].blocks];
  // 默认插到「每次都会变的块」之前，落在稳定前缀里，避免破坏缓存命中
  const at = list.findIndex((b) => b.type === VOLATILE_BLOCK[kind]);
  if (at < 0) list.push(item);
  else list.splice(at, 0, item);
  state.prompt[kind].blocks = list;
  emit();
  return item;
}

export function updatePromptBlock(kind, id, patch) {
  state.prompt[kind].blocks = state.prompt[kind].blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
  emit();
}

/** 数据块不可删 */
export function removePromptBlock(kind, id) {
  state.prompt[kind].blocks = state.prompt[kind].blocks.filter((b) => !(b.id === id && !isDataBlock(b.type)));
  emit();
}

export function resetPrompt(kind) {
  state.prompt[kind] = defaultPromptConfig(kind);
  emit();
}

/* ---------------- API 预设 ---------------- */

export function saveApiPreset(name) {
  const { apiBase, apiKey, model, temperature, maxTokens } = state.settings;
  const item = { id: uid(), name, apiBase, apiKey, model, temperature, maxTokens, createdAt: Date.now() };
  state.apiPresets = [item, ...(state.apiPresets || [])];
  state.activeApiPreset = item.id;
  emit();
  return item;
}

export function applyApiPreset(id) {
  const p = (state.apiPresets || []).find((it) => it.id === id);
  if (!p) return null;
  const { apiBase, apiKey, model, temperature, maxTokens } = p;
  state.settings = { ...state.settings, apiBase, apiKey, model, temperature, maxTokens };
  state.activeApiPreset = id;
  emit();
  return p;
}

export function renameApiPreset(id, name) {
  state.apiPresets = (state.apiPresets || []).map((it) => (it.id === id ? { ...it, name } : it));
  emit();
}

export function removeApiPreset(id) {
  state.apiPresets = (state.apiPresets || []).filter((it) => it.id !== id);
  if (state.activeApiPreset === id) state.activeApiPreset = '';
  emit();
}

/* ---------------- 文件夹 ---------------- */

export function listFolders(collection) {
  return (state.folders && state.folders[collection]) || [];
}

export function addFolder(collection, name) {
  const item = { id: uid(), name, createdAt: Date.now() };
  state.folders[collection] = [...listFolders(collection), item];
  emit();
  return item;
}

export function renameFolder(collection, id, name) {
  state.folders[collection] = listFolders(collection).map((f) => (f.id === id ? { ...f, name } : f));
  emit();
}

/** 删除文件夹，其中条目回到根目录 */
export function removeFolder(collection, id) {
  state.folders[collection] = listFolders(collection).filter((f) => f.id !== id);
  state[collection] = (state[collection] || []).map((it) => (it.folderId === id ? { ...it, folderId: '' } : it));
  emit();
}

/* ---------------- 书籍 / 章节 ---------------- */

export function addBook(data) {
  return add('books', {
    intro: '',
    ...data,
    chapters: normalizeChapters(data.chapters)
  });
}

export function addChapter(bookId, chapter) {
  const book = get('books', bookId);
  if (!book) return null;
  const item = { id: uid(), createdAt: Date.now(), comments: [], ...chapter };
  book.chapters = [...book.chapters, item];
  emit();
  return item;
}

export function updateChapter(bookId, chapterId, patch) {
  const book = get('books', bookId);
  if (!book) return null;
  book.chapters = book.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c));
  emit();
  return book.chapters.find((c) => c.id === chapterId);
}

export function removeChapters(bookId, ids) {
  const book = get('books', bookId);
  if (!book) return;
  const set = new Set(ids);
  book.chapters = book.chapters.filter((c) => !set.has(c.id));
  emit();
}

export function getChapter(bookId, chapterId) {
  const book = get('books', bookId);
  if (!book) return null;
  return book.chapters.find((c) => c.id === chapterId) || null;
}

/* ---------------- 章节评论 ---------------- */

export function listComments(bookId, chapterId) {
  const chapter = getChapter(bookId, chapterId);
  return (chapter && chapter.comments) || [];
}

/** 追加一条（用户发送） */
export function addComment(bookId, chapterId, data) {
  const chapter = getChapter(bookId, chapterId);
  if (!chapter) return null;
  const item = { id: uid(), createdAt: Date.now(), name: '', text: '', replyTo: '', ...data };
  chapter.comments = [...(chapter.comments || []), item];
  emit();
  return item;
}

/** 批量追加（AI 生成） */
export function addComments(bookId, chapterId, list) {
  const chapter = getChapter(bookId, chapterId);
  if (!chapter || !list || !list.length) return [];
  const items = list.map((d) => ({ id: uid(), createdAt: Date.now(), name: '', text: '', replyTo: '', ...d }));
  chapter.comments = [...(chapter.comments || []), ...items];
  emit();
  return items;
}

export function removeComments(bookId, chapterId, ids) {
  const chapter = getChapter(bookId, chapterId);
  if (!chapter) return;
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  chapter.comments = (chapter.comments || []).filter((m) => !set.has(m.id));
  emit();
}
