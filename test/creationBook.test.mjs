/**
 * 「收藏到书架」的命名冒烟测试。
 *
 * 守的是一条容易搞反的规则：**首页标题输入框里填的那个名字是书名**，
 * 文章正文进第 1 章，章节名固定「第1章」。
 *
 * 之前是拿创作标题同时当书名和第一章名 —— 打开书看到的是「一本书 + 一个同名的章节」，
 * 目录里也对不上后面「续写」默认的「第2章」「第3章」。
 *
 * 两种跑法，缺一不可：
 * 1) 直接调 `store.addBookFromCreation`，断言写进去的那本书长什么样；
 * 2) 用最小 DOM 替身跑**真实的** `creation.render()`，点星标 → 确认框点「收藏」，
 *    整条界面链路走完再断言 —— 只测 store 的话，页面自己在视图里另拼一份参数也测不出来。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

/* ---------- 最小 DOM 替身 ---------- */
class Style {
  constructor() { this._d = {}; }
  setProperty(k, v) { this._d[k] = v; }
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.childNodes = [];
    this.attrs = {};
    this.style = new Style();
    this.className = '';
    this._text = '';
    this._listeners = {};
    this.parentNode = null;
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    this.dataset = {};   // theme.applySection 会写 documentElement.dataset.section
  }
  set className(v) { this._cls = v; }
  get className() { return this._cls || ''; }
  set textContent(v) { this._text = String(v); this.children = []; this.childNodes = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html || ''; }
  appendChild(c) {
    if (c && c.__text !== undefined) { this.childNodes.push(c); }
    else { this.children.push(c); this.childNodes.push(c); if (c) c.parentNode = this; }
    return c;
  }
  append(...n) { n.forEach((x) => this.appendChild(x)); }
  replaceChildren(...n) { this.children = []; this.childNodes = []; n.forEach((x) => this.appendChild(x)); }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.children = p.children.filter((c) => c !== this);
    p.childNodes = p.childNodes.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  get classList() {
    const self = this;
    const list = {
      toggle: (c, on) => {
        const has = self.className.split(/\s+/).includes(c);
        const want = on === undefined ? !has : !!on;
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        if (want) set.add(c); else set.delete(c);
        self.className = [...set].join(' ');
        return want;
      },
      add: (c) => list.toggle(c, true),
      remove: (c) => list.toggle(c, false),
      contains: (c) => self.className.split(/\s+/).includes(c)
    };
    return list;
  }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev = {}) { (this._listeners[t] || []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {}, ...ev })); }
  click() { this.dispatch('click'); }
  focus() {}
  closest() { return null; }
  querySelectorAll() { return []; }
  get scrollHeight() { return 0; }
  setSelectionRange() {}
}

// 根节点复用：弹窗挂进 'modal-root' 之后要能取回来
const roots = new Map();
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ __text: String(t), nodeType: 3, textContent: String(t) }),
  body: new El('body'),
  head: new El('head'),
  addEventListener() {},
  removeEventListener() {},
  getElementById: (id) => {
    if (!roots.has(id)) roots.set(id, new El('div'));
    return roots.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: new El('html')
};
// router 用的是裸的 location，必须挂到 globalThis 上
const loc = { hash: '#/home' };
globalThis.location = loc;
globalThis.window = {
  addEventListener() {},
  location: loc,
  scrollTo() {},
  history: { length: 0 },   // back() 会读它，缺了会炸
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.structuredClone = structuredClone;

const store = await import('../js/store.js');
const router = await import('../js/router.js');
const { render } = await import('../js/views/creation.js');

// 收藏成功后视图会调 reload()（重渲染当前路由）。给 router 一个能落地的桩路由和
// 一个 view 容器，否则 resolve() 里 viewEl.replaceChildren 会炸在一起。
router.define('/home', { render: () => new El('div') });
router.start(new El('div'));

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) => ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

function findAll(node, pred, out = []) {
  if (!node || node.__text !== undefined) return out;
  if (pred(node)) out.push(node);
  (node.childNodes || []).forEach((c) => findAll(c, pred, out));
  return out;
}
const btnByText = (node, t) => findAll(node, (n) => n.tagName === 'BUTTON' && n.textContent === t)[0];
/** 按钮里第一个 span 就是图标（star 空心 fill="none" / starFill 实心 fill="currentColor"） */
const icoOf = (btn) => findAll(btn, (n) => n.tagName === 'SPAN')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 1) 数据层 ================= */

console.log('\n== 数据层：创作 -> 书架 ==');
const creation = store.add('creations', {
  title: '星海归途',
  request: '写一段开篇，第一人称',
  content: '第一章正文。'
});
const book = store.addBookFromCreation(creation);

eq('书名取创作标题', book.title, '星海归途');
eq('第 1 章标题固定为「第1章」', book.chapters[0].title, '第1章');
eq('正文进第 1 章', book.chapters[0].content, '第一章正文。');
eq('简介留创作时填的详细要求', book.intro, '写一段开篇，第一人称');
ok('章节名没有复用创作标题', book.chapters[0].title !== creation.title, book.chapters[0].title);
ok('章节带 id（章节详情页靠它取数）', !!book.chapters[0].id);
eq('章节数就是 1', book.chapters.length, 1);

console.log('\n== 边界：标题空 / 缺字段 ==');
const noName = store.addBookFromCreation({ title: '   ', content: 'x' });
eq('标题只有空白时书名兜底「未命名」', noName.title, '未命名');
eq('兜底书名不影响章节名', noName.chapters[0].title, '第1章');
eq('缺 intro 时为空串', noName.intro, '');
const bare = store.addBookFromCreation({});
eq('整个创作对象都没有时不炸', bare.title, '未命名');
eq('无标题时章节名照旧', bare.chapters[0].title, '第1章');

console.log('\n== 章节命名同源 ==');
eq('续写第 2 章用同一套命名', store.chapterTitle(2), '第2章');
eq('续写第 12 章用同一套命名', store.chapterTitle(12), '第12章');

/* ================= 2) 界面链路 ================= */

console.log('\n== 界面：创作详情点星标收藏 ==');
const before = store.list('books').length;
const item = store.add('creations', {
  title: '长夜将明',
  request: '要求：第一人称',
  content: '正文内容。'
});
const page = render({ params: { id: item.id } });

/**
 * 顶栏右侧（收藏/删除）的按钮。左栏那个返回键也是 .tb-btn，别一起捞进来。
 */
const barActions = (page) => {
  const right = findAll(page, (n) => n.className === 'tb-side tb-right')[0];
  return findAll(right, (n) => n.tagName === 'BUTTON');
};

const barBtns = barActions(page);
eq('顶栏有星标和删除两个按钮', barBtns.length, 2);
ok('未收藏时星标是空心的', (icoOf(barBtns[0]).innerHTML || '').includes('fill="none"'),
  icoOf(barBtns[0]).innerHTML);

barBtns[0].dispatch('click');   // 点星标 -> 弹确认框
const modalRoot = roots.get('modal-root');
const pickBtn = btnByText(modalRoot, '收藏');
ok('弹出确认框，含「收藏」按钮', !!pickBtn);
ok('确认框同时给了「取消」', !!btnByText(modalRoot, '取消'));

pickBtn.dispatch('click');
await sleep(0);   // 让 await showConfirm 之后的写库逻辑跑完

const shelf = store.list('books');
eq('书架多了一本', shelf.length, before + 1);
const saved = shelf.find((b) => b.title === '长夜将明');
ok('书名是创作标题「长夜将明」', !!saved, JSON.stringify(shelf.map((b) => b.title)));
eq('章节列表里那一篇叫「第1章」', saved.chapters[0].title, '第1章');
ok('章节名不是创作标题', saved.chapters[0].title !== '长夜将明');
eq('正文进第 1 章', saved.chapters[0].content, '正文内容。');
eq('简介是创作时的详细要求', saved.intro, '要求：第一人称');
eq('创作条目记下了 bookId', store.get('creations', item.id).bookId, saved.id);

console.log('\n== 界面：取消收藏不动书架 ==');
const page2 = render({ params: { id: item.id } });
const barBtns2 = barActions(page2);
ok('已收藏时星标是实心的', (icoOf(barBtns2[0]).innerHTML || '').includes('fill="currentColor"'),
  icoOf(barBtns2[0]).innerHTML);
const count2 = store.list('books').length;
barBtns2[0].dispatch('click');
const cancelBtn = btnByText(roots.get('modal-root'), '取消');
ok('已收藏时再点弹出取消收藏确认', !!cancelBtn);
cancelBtn.dispatch('click');
await sleep(0);
eq('取消后书架本书不变', store.list('books').length, count2);
eq('取消后 bookId 还在', store.get('creations', item.id).bookId, saved.id);

/* ================= 3) 老存档里已经收藏过的书 ================= */
/* 章节名没有改名入口，老书不改就永远是错的（书名是本书名、章节也是同名）。
   换一个 store 模块实例跑真实 load() —— 和 commentApi.test.mjs 一样的 ?legacy=1 手法。 */

console.log('\n== 老存档：第一章与书名同名时改回「第1章」==');
mem.set('somnus_state_v1', JSON.stringify({
  books: [
    { id: 'b1', title: '星海归途', intro: '要求', chapters: [{ id: 'c1', title: '星海归途', content: '正文' }] },
    {
      id: 'b2', title: '长夜将明', intro: '',
      chapters: [{ id: 'c2', title: '长夜将明', content: '一' }, { id: 'c3', title: '第2章', content: '二' }]
    },
    { id: 'b3', title: '别有洞天', intro: '', chapters: [{ id: 'c4', title: '楔子', content: '' }] },
    { id: 'b4', title: '空书', intro: '', chapters: [] }
  ]
}));
const legacy = await import('../js/store.js?legacy=1');
const lb = legacy.list('books');
eq('第一章与书名同名的改成「第1章」', lb[0].chapters[0].title, '第1章');
eq('书名原样不动', lb[0].title, '星海归途');
eq('简介 / 正文不受影响', lb[0].intro + '|' + lb[0].chapters[0].content, '要求|正文');
eq('已经有续写的书，第一章同样改掉', lb[1].chapters[0].title, '第1章');
eq('续写出来的第 2 章不碰', lb[1].chapters[1].title, '第2章');
eq('本来就有正经章节名的书不动', lb[2].chapters[0].title, '楔子');
eq('没有章节的书不炸', lb[3].chapters.length, 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
