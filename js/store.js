/**
 * 全局状态 + localStorage 持久化
 * 所有页面只通过这里读写数据，便于单点修改。
 */

import {
  defaultPromptConfig, upgradePromptConfig, isDataBlock, blockId, VOLATILE_BLOCK,
  makePromptPreset, alignBlocksToKind
} from './services/promptSchema.js';
// 备份范围（哪些键属于「文字内容」）由 services/backup.js 定义，
// 恢复时该替换什么直接引用它，避免导出和恢复各维护一份清单、日后改漏一边。
import { CONTENT_TOP_KEYS, PROFILE_TEXT_KEYS } from './services/backup.js';

const KEY = 'somnus_state_v1';

const LIB_KEYS = ['roles', 'worlds', 'ideas'];

const DEFAULTS = {
  settings: {
    apiBase: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.9,
    maxTokens: 0,
    /**
     * 评论专用接口：章节页「获取评论」走这套，不影响正文续写。
     * enabled 关掉时整体跟随上面主配置；开着时哪一项留空就只回退那一项。
     */
    commentApi: {
      enabled: false,
      apiBase: '',
      apiKey: '',
      model: '',
      temperature: '',
      maxTokens: ''
    }
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

  /**
   * 提示词预设：按 kind 分桶存，创作/续写/评论各存各的，互不相通。
   * 形状刻意定成 { [kind]: Array } 而不是拍平成一个 Array ——
   * 分桶后「载入别的类别的预设」这件事在数据层就做不到，不依赖界面记得传对 kind。
   */
  promptPresets: {
    create: [],
    continue: [],
    comment: []
  },

  /**
   * 界面上的临时状态：跟着用户操作走，切页 / 重开都不丢。
   * lastSeenUpdate 记「已阅到哪一版更新」，属界面态 —— 不进备份、不跟云端走，
   * 每台设备各自弹一次新版本说明。
   */
  ui: { composeOpen: false, lastSeenUpdate: '' },

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

  /*
   * 老数据修复：收藏来的书，第一章曾被写成和书名同名（当时是拿创作标题同时当书名和章名）。
   * 书名的位置已经被书名占了，第一章统一叫「第1章」，跟「续写」的默认命名接上。
   *
   * 为什么放在迁移里而不是让用户自己改：章节名在界面上没有改名入口（只有书名能点着改），
   * 老书不改就永远是错的。判定只认「第一章标题与书名一字不差」这个特征 ——
   * 正是当年那条写入路径留下的指纹，别的章节一律不碰。
   */
  s.books.forEach((b) => {
    const first = (b.chapters || [])[0];
    if (first && b.title && first.title === b.title) first.title = chapterTitle(1);
  });

  /*
   * 悬空的收藏指针：创作上记着 bookId，可那本书早就不在了（书架里删过书、
   * 或恢复了一份只有创作的备份）。
   *
   * 「已收藏」的唯一判据是 `bookId 指向的书真的还在`（见 collectedBook），
   * 而首页列表原先只看 `bookId` 有没有值 —— 悬空指针下首页挂着「已收藏」的书签、
   * 点进详情却是空星标，两处自相矛盾。这里在装载时一次性清干净，
   * 老存档不用等用户自己去碰。
   */
  const bookIds = new Set(s.books.map((b) => b.id));
  s.creations = (s.creations || []).map((c) => (c.bookId && !bookIds.has(c.bookId) ? { ...c, bookId: '' } : c));

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

  // 提示词预设：按 kind 补齐桶，顺手清掉不认识 / kind 对不上的脏数据
  const presets = (s.promptPresets && typeof s.promptPresets === 'object') ? s.promptPresets : {};
  s.promptPresets = {};
  ['create', 'continue', 'comment'].forEach((kind) => {
    s.promptPresets[kind] = (Array.isArray(presets[kind]) ? presets[kind] : [])
      .filter((p) => p && p.name && Array.isArray(p.blocks))
      .map((p) => ({
        ...p,
        id: p.id || uid(),
        // kind 写错的（手改存档或早期版本）一律按所在桶归位
        kind,
        blocks: alignBlocksToKind(kind, p.blocks)
      }));
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

/** 只改评论专用接口，不动主配置 */
export function patchCommentApi(patch) {
  state.settings.commentApi = { ...(state.settings.commentApi || {}), ...patch };
  emit();
}

/** 把评论专用配置里的空白项用主配置补上，得到一份可直接发请求的完整配置 */
export function resolveCommentApi() {
  const s = state.settings;
  const c = s.commentApi || {};
  if (!c.enabled) return { ...s, fromCommentApi: false };
  const take = (v, main) => (v === '' || v == null ? main : v);
  return {
    apiBase: take(c.apiBase, s.apiBase),
    apiKey: take(c.apiKey, s.apiKey),
    model: take(c.model, s.model),
    temperature: take(c.temperature, s.temperature),
    maxTokens: take(c.maxTokens, s.maxTokens),
    fromCommentApi: true
  };
}

/** 评论专用配置是否真的和主配置不一样，用于设置页提示 */
export function commentApiDiffers() {
  const s = state.settings;
  const c = s.commentApi || {};
  if (!c.enabled) return false;
  // 数字项两边一个存 number 一个存 input 的字符串，得按数值比，
  // 否则主配置 0.9、评论里手填 "0.9" 会被误判成「有差异」。
  const same = (a, b) => (a === '' || a == null ? true : (Number.isFinite(Number(b)) ? Number(a) === Number(b) : String(a) === String(b)));
  return ['apiBase', 'apiKey', 'model', 'temperature', 'maxTokens']
    .some((k) => !same(c[k], s[k]));
}

export function patchAppearance(patch) {
  state.appearance = deepMerge(state.appearance, patch);
  emit();
}

export function patchProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  emit();
}

export function patchUi(patch) {
  state.ui = { ...state.ui, ...patch };
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

/* ---------------- 提示词预设 ---------------- */

/**
 * 某一类提示词的预设列表。
 * 只读这个桶：调用方拿不到别的类别的预设，界面也就无法把「续写」的预设载进「创作」。
 */
export function listPromptPresets(kind) {
  return (state.promptPresets && state.promptPresets[kind]) || [];
}

/** 把当前 kind 的提示词存成预设。存的是快照，之后改配置不影响已存的那份。 */
export function savePromptPreset(kind, name) {
  const item = makePromptPreset(kind, name, state.prompt[kind]);
  state.promptPresets[kind] = [item, ...listPromptPresets(kind)];
  emit();
  return item;
}

/**
 * 载入预设：整份替换当前 kind 的配置。
 * 块列表过一遍 alignBlocksToKind，保证不会带进别的类别的数据块。
 */
export function applyPromptPreset(kind, id) {
  const p = listPromptPresets(kind).find((it) => it.id === id);
  if (!p) return null;
  state.prompt[kind] = {
    system: p.system || '',
    blocks: alignBlocksToKind(kind, p.blocks)
  };
  emit();
  return p;
}

export function renamePromptPreset(kind, id, name) {
  state.promptPresets[kind] = listPromptPresets(kind).map((it) => (it.id === id ? { ...it, name } : it));
  emit();
}

export function removePromptPreset(kind, id) {
  state.promptPresets[kind] = listPromptPresets(kind).filter((it) => it.id !== id);
  emit();
}

/** 预设总数，给「我的」页显示用 */
export function countPromptPresets() {
  return ['create', 'continue', 'comment']
    .reduce((n, k) => n + listPromptPresets(k).length, 0);
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

/** 章节默认标题：第 N 章。首章入库、「续写」兜底都走这里，命名只有一套 */
export function chapterTitle(n) {
  return `第${n}章`;
}

/**
 * 把一条创作收进书架。
 *
 * 书名取创作标题 —— 就是首页标题输入框里填的那个，收藏后书架列表里显示的就是它。
 * 章节名固定「第1章」，**不能**再复用创作标题：标题已经是书名了，再拿它当章节名，
 * 目录里就是「一本书 + 一个同名的章节」，重复且看不出哪个是书哪个是章。
 * （后续「续写」默认也是「第2章」「第3章」，首章用「第1章」才接得上。）
 *
 * intro 留创作时填的「详细要求」，方便日后回看当初是怎么让它写的。
 *
 * @param {{title?:string, request?:string, content?:string}} creation
 */
export function addBookFromCreation(creation) {
  const it = creation || {};
  return addBook({
    title: (it.title || '').trim() || '未命名',
    intro: it.request || '',
    chapters: [{ title: chapterTitle(1), content: it.content || '' }]
  });
}

/* ---------------- 收藏（创作 ⇄ 书架） ---------------- */

/**
 * 这条创作收藏的那本书，没收藏（或书已经被删）时返回 null。
 *
 * **判据只有这一处**：`bookId` 指向的书**真的还在**才算已收藏。
 * 只看 `bookId` 有没有值是错的 —— 书架里把书删掉之后它就成了悬空指针，
 * 界面会一直显示「已收藏」，而详情页按「书还在吗」算出来是空星标，
 * 同一个事实两处说法不一样。首页列表的书签图标、详情页的星标都走这里。
 */
export function collectedBook(creation) {
  const id = creation && creation.bookId;
  return (id && get('books', id)) || null;
}

/** 这条创作是否已收藏。首页列表的书签图标与详情页的星标共用这一处判据。 */
export function isCollected(creation) {
  return !!collectedBook(creation);
}

/**
 * 删除书籍，并把指向它们的收藏指针一并清掉。
 *
 * **所有删书入口都必须走这里**（书架里单个 / 批量删除、取消收藏、删除创作）：
 * 只删 `books` 而不管 `creations[].bookId`，那条创作就永远挂着「已收藏」的标记，
 * 再点一次收藏还会凭空多出一本同名的书。删书和清指针是一件事，拆成两步
 * 早晚会有人只做一半 —— 所以收在同一个函数里。
 */
export function removeBooks(ids) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  state.books = (state.books || []).filter((it) => !set.has(it.id));
  state.creations = (state.creations || []).map((it) => (
    it.bookId && set.has(it.bookId) ? { ...it, bookId: '' } : it
  ));
  emit();
}

/**
 * 收藏：把创作存成书架里的一本书，并记下指针。
 * 已经收藏过就直接把那本还回去，不重复建书（重复点、悬空指针恢复后重收都不会多出一本）。
 */
export function collectCreation(creation) {
  const exist = collectedBook(creation);
  if (exist) return exist;
  const book = addBookFromCreation(creation);
  state.creations = (state.creations || []).map((it) => (
    it.id === creation.id ? { ...it, bookId: book.id, updatedAt: Date.now() } : it
  ));
  emit();
  return book;
}

/** 取消收藏：把书删掉，指针交给 removeBooks 一并清。 */
export function uncollectCreation(creation) {
  if (creation && creation.bookId) removeBooks(creation.bookId);
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

/* ---------------- 备份 / 恢复 ---------------- */

/** 当前存档的深拷贝，导出用（避免外部改到内部状态） */
export function snapshot() {
  return structuredClone(state);
}

/** 合并导入时会被追加的「内容」类数据 */
const MERGE_KEYS = ['books', 'creations', 'presets', 'roles', 'worlds', 'ideas'];

/** 把外来存档规整成和内部一致的结构，再挂到当前 state 上 */
function adopt(next) {
  return migrate(deepMerge(structuredClone(DEFAULTS), structuredClone(next)));
}

/**
 * 整份恢复：只把「文字内容」换成本机的，其余一律保持当前值。
 *
 * 不在复原范围内的是：外观 / 主题 / 字体 / 背景图、头像（图片）、API 配置与 Key、
 * 云端备份配置、界面态 —— 换设备恢复备份时，这些本就该用新设备上自己那一份。
 *
 * 与 mergeContent 的区别：mergeContent 只按 id 追加、什么都不覆盖；
 * 这里是内容键整份替换（备份里没有的书就是被删掉的书）。
 * 配置类的东西（提示词 / 草稿 / 昵称简介之外的资料）在两者中都不参与追加 ——
 * 它们没有 id 可以「去重追加」，只能整份替换，所以只在 restore 里处理。
 */
export function replaceContent(next) {
  const incoming = adopt(next);

  // 只替换备份里**真的出现过**的键。判定必须用 `k in next` 而不是看 incoming：
  // adopt() 之后所有键都有值（缺失的会被 DEFAULTS 补成空数组），
  // 那时已经分不出「备份里没有这一项」和「备份里这一项是空的」了 ——
  // 而前者绝不该把本机的书清空（粘贴一段只有角色的片段就会踩到）。
  CONTENT_TOP_KEYS.forEach((k) => {
    if (next && k in next) state[k] = incoming[k];
  });

  // 昵称 / 简介按备份走，头像（图片）保留本机那份
  const p = next && next.profile;
  if (p && typeof p === 'object') {
    const patch = {};
    PROFILE_TEXT_KEYS.forEach((k) => { if (k in p) patch[k] = p[k]; });
    if (Object.keys(patch).length) state.profile = { ...state.profile, ...patch };
  }

  emit();
}

/**
 * 合并导入：只把备份里的内容（书 / 创作 / 角色 / 世界书 / 灵感 / 输入预设 / 提示词预设）
 * 按 id 去重后追加，设置、外观、提示词、个人资料一律保持当前不动 ——
 * 避免把新设备上的配置冲掉。
 * @returns {number} 新增的条目数
 */
export function mergeContent(next) {
  const incoming = adopt(next);
  const base = state;
  let added = 0;

  MERGE_KEYS.forEach((key) => {
    const have = new Set((base[key] || []).map((it) => it && it.id));
    const extra = (incoming[key] || []).filter((it) => it && it.id && !have.has(it.id));
    if (extra.length) {
      base[key] = [...(base[key] || []), ...extra];
      added += extra.length;
    }
  });

  // 提示词预设按 kind 分桶，逐桶去重追加，同样不碰当前生效的提示词
  ['create', 'continue', 'comment'].forEach((kind) => {
    const have = new Set(listPromptPresets(kind).map((it) => it && it.id));
    const extra = ((incoming.promptPresets || {})[kind] || [])
      .filter((it) => it && it.id && !have.has(it.id));
    if (extra.length) {
      base.promptPresets[kind] = [...listPromptPresets(kind), ...extra];
      added += extra.length;
    }
  });

  LIB_KEYS.forEach((key) => {
    const have = new Set(((base.folders && base.folders[key]) || []).map((f) => f && f.id));
    const extra = (((incoming.folders || {})[key]) || []).filter((f) => f && f.id && !have.has(f.id));
    if (extra.length) {
      base.folders = { ...base.folders, [key]: [...(base.folders[key] || []), ...extra] };
      added += extra.length;
    }
  });

  emit();
  return added;
}
