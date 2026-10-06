/**
 * 「收藏到书架」的命名与收藏指针同步。
 *
 * 守两条容易搞反 / 搞丢的规则：
 *
 * 1) **首页标题输入框里填的那个名字是书名**，文章正文进第 1 章，章节名固定「第1章」。
 *    之前是拿创作标题同时当书名和第一章名 —— 打开书看到的是「一本书 + 一个同名的章节」，
 *    目录里也对不上后面「续写」默认的「第2章」「第3章」。
 *
 * 2) **「收藏」这根指针只有一个判据、一条收尾**（`store.collectedBook` /
 *    `isCollected` / `collectCreation` / `uncollectCreation` / `removeBooks`）。
 *    从前 `creations[].bookId` 只在收藏那一刻写过，书架里把书删掉之后它就悬空了：
 *    首页那条创作一直挂着「已收藏」的书签图标，点进详情却是空星标，两处自相矛盾；
 *    再点一次收藏还会凭空多出一本同名的书。
 *
 * 两种跑法，缺一不可：
 * 1) 直接调 `store.*`，断言数据层写对；
 * 2) 用最小 DOM 替身跑**真实的** `creation.render()`，点星标 → 确认框点「收藏」/
 *    「取消收藏」，整条界面链路走完再断言 —— 只测 store 的话，页面自己在视图里
 *    另拼一份参数也测不出来。
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

console.log('\n== 界面：取消收藏真的把书从书架删掉 ==');
/*
 * 这一段以前点的是弹窗里的「取消」—— 也就是「什么都不做」，于是「书架本书不变」
 * 这条断言永远成立：看着像守了取消收藏，其实一次都没碰到那条路径。
 * 现在两个按钮都认准：真动作是「取消收藏」，另一颗叫「再想想」
 * （默认那个「取消」跟「取消收藏」并排时一眼分不清哪颗才是真动作）。
 */
const page2 = render({ params: { id: item.id } });
const barBtns2 = barActions(page2);
ok('已收藏时星标是实心的', (icoOf(barBtns2[0]).innerHTML || '').includes('fill="currentColor"'),
  icoOf(barBtns2[0]).innerHTML);

barBtns2[0].dispatch('click');
const modal2 = roots.get('modal-root');
ok('已收藏时弹出的确认框里有「取消收藏」', !!btnByText(modal2, '取消收藏'));
ok('确认框另一颗是「再想想」而不是「取消」', !!btnByText(modal2, '再想想') && !btnByText(modal2, '取消'));

// 先点「再想想」：什么都不该发生
const count2 = store.list('books').length;
btnByText(modal2, '再想想').dispatch('click');
await sleep(0);
eq('点「再想想」书架一本不少', store.list('books').length, count2);
eq('点「再想想」后创作还记着那本书', store.get('creations', item.id).bookId, saved.id);

// 再点一次星标，这次点「取消收藏」
const page3 = render({ params: { id: item.id } });
barActions(page3)[0].dispatch('click');
const modal3 = roots.get('modal-root');
ok('第二次弹出的依旧是取消收藏确认', !!btnByText(modal3, '取消收藏'));
btnByText(modal3, '取消收藏').dispatch('click');
await sleep(0);
eq('取消后书架里那本书没了', store.list('books').some((b) => b.id === saved.id), false);
eq('取消后创作的 bookId 被清空', store.get('creations', item.id).bookId, '');
eq('取消后 isCollected 为假', store.isCollected(store.get('creations', item.id)), false);

/* ================= 收藏指针 ⇄ 书架，双向都别留残影 ================= */
/* 这次真正修掉的就是这一段：只删 books、不管 creations[].bookId 的话，
   首页那条创作会一直挂着「已收藏」的书签图标，点进详情却是空星标。 */

console.log('\n== 书架里删书，创作的收藏指针要跟着清 ==');
const cr2 = store.add('creations', { title: '夜航船', request: '要求', content: '正文。' });
const book2 = store.collectCreation(cr2);
eq('收藏后指针指到了那本书', store.get('creations', cr2.id).bookId, book2.id);
eq('收藏后 isCollected 为真', store.isCollected(store.get('creations', cr2.id)), true);
eq('重复收藏不会多建书', store.collectCreation(store.get('creations', cr2.id)).id, book2.id);
eq('重复收藏后书架里还是只有它一本', store.list('books').filter((b) => b.id === book2.id).length, 1);

const cr2b = store.add('creations', { title: '别的书', request: '要求', content: '正文。' });
const book2b = store.collectCreation(cr2b);

store.removeBooks([book2.id]);   // 相当于在书架里把这一本删掉
eq('删书后书架里没有它了', store.list('books').some((b) => b.id === book2.id), false);
eq('删书后创作的 bookId 被清空', store.get('creations', cr2.id).bookId, '');
eq('删书后 isCollected 为假（首页图标据此消失）', store.isCollected(store.get('creations', cr2.id)), false);
eq('别的创作的收藏指针不受牵连', store.get('creations', cr2b.id).bookId, book2b.id);

console.log('\n== 悬空指针：书没了但 bookId 还留着 ==');
const cr3 = store.add('creations', { title: '归途', request: '要求', content: '正文。' });
const book3 = store.collectCreation(cr3);
store.remove('books', book3.id);   // 绕过 removeBooks，故意留一个悬空指针
eq('造出来的确实是指向不存在书籍的指针', !!store.get('creations', cr3.id).bookId, true);
eq('collectedBook 认得出来（返回 null）', store.collectedBook(store.get('creations', cr3.id)), null);
eq('isCollected 为假', store.isCollected(store.get('creations', cr3.id)), false);
eq('此时再收藏会新建一本，而不是复用那条死指针', store.collectCreation(store.get('creations', cr3.id)).id !== book3.id, true);

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

/* ================= 4) 老存档里的悬空收藏指针 ================= */
/*
 * 老存档里很可能已经有「bookId 指向一本早被删掉的书」的创作 —— 那正是
 * 首页图标一直挂着的原因。装载时必须一次清干净，不能等用户自己去碰。
 */
console.log('\n== 老存档：指向不存在书籍的收藏指针被清掉 ==');
mem.set('somnus_state_v1', JSON.stringify({
  books: [{ id: 'bk1', title: '在的', chapters: [{ id: 'x1', title: '第1章', content: '' }] }],
  creations: [
    { id: 'k1', title: '书还在', content: '', bookId: 'bk1' },
    { id: 'k2', title: '书没了', content: '', bookId: 'ghost' },
    { id: 'k3', title: '从没收藏过', content: '' }
  ]
}));
const legacy2 = await import('../js/store.js?dangling=1');
const byId = (id) => legacy2.get('creations', id);
eq('书还在的，指针保留', byId('k1').bookId, 'bk1');
eq('书没了的，指针被清空', byId('k2').bookId, '');
eq('从没收藏过的，不会凭空长出一个指针', byId('k3').bookId, undefined);
eq('清完之后 isCollected 判得对', legacy2.isCollected(byId('k1')), true);
eq('指向鬼书的那个判为未收藏', legacy2.isCollected(byId('k2')), false);
/* 迁移是「修饰」不是「重建」：别的字段一个字都不能动 */
eq('迁移不动标题', byId('k2').title, '书没了');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
