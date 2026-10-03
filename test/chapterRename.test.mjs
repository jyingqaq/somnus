/**
 * 章节页「点顶栏章节名改名」的渲染冒烟测试。
 *
 * 用最小 DOM 替身跑真实的 `chapter.render()`，走完整条链路：
 * 点标题 → 表单预填当前章节名 → 改名 → 顶栏跟着变、库里的值也变了。
 *
 * 重点盯两件靠肉眼很难发现的事：
 * 1) 章节名在界面上**没有别的改名入口**（书名是点标题改的，章节当时只能靠重建），
 *    所以这条路径断了就等于改不了名 —— 断言必须落在「点一下真的能改」上；
 * 2) 改完**只许重画顶栏**。正文区可能正在编辑（editing），整页 draw() 会把
 *    textarea 里没保存的字冲掉 —— 这是这次拆分 drawBar() 的起因，必须有用例守着。
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
    this.dataset = {};
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
const loc = { hash: '#/book/b1/chapter/c1' };
globalThis.location = loc;
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  location: loc,
  scrollTo() {},
  history: { length: 0 },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
globalThis.structuredClone = structuredClone;

const store = await import('../js/store.js');
const { render } = await import('../js/views/chapter.js');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modalRoot = () => roots.get('modal-root');
const byText = (node, sel, t) =>
  findAll(node, (n) => n.tagName === sel && n.textContent === t)[0];
const titleNode = (page) => findAll(page, (n) => n.className.includes('tb-title'))[0];
const barAction = (page, i) => {
  const right = findAll(page, (n) => n.className === 'tb-side tb-right')[0];
  return findAll(right, (n) => n.tagName === 'BUTTON')[i];
};

/** 点标题打开改名表单（不提交），返回表单里的控件 */
function openRename(page) {
  titleNode(page).dispatch('click');
  const input = findAll(modalRoot(), (n) => n.tagName === 'INPUT' && n.className.includes('field'))[0];
  return {
    input,
    prefilled: input && input.value,
    saveBtn: byText(modalRoot(), 'BUTTON', '保存'),
    cancelBtn: byText(modalRoot(), 'BUTTON', '取消')
  };
}

/** 打开表单 → 填新名字 → 提交 */
async function doRename(page, next) {
  const form = openRename(page);
  form.input.value = next;
  form.input.dispatch('input');
  form.saveBtn.dispatch('click');
  await sleep(0);
  return form;
}

const book = store.addBook({ title: '旧书', intro: '', chapters: [{ title: '第1章', content: '正文。' }] });
const cid = book.chapters[0].id;
const fresh = () => store.getChapter(book.id, cid);

console.log('\n== 顶栏章节名：可点 ==');
let page = render({ params: { id: book.id, cid } });
ok('标题存在', !!titleNode(page));
eq('标题显示章节名', titleNode(page).textContent, '第1章');
ok('标题带 .editable（说明可点、有虚线提示）', titleNode(page).className.includes('editable'),
  titleNode(page).className);
ok('虚线画在 .tb-label 上（不然会拉满整格）', !!findAll(titleNode(page), (n) => n.className === 'tb-label')[0]);

console.log('\n== 点一下 → 改名 ==');
const readerBefore = findAll(page, (n) => n.className === 'reader')[0];
const { prefilled } = await doRename(page, '楔子');
eq('表单预填当前章节名', prefilled, '第1章');
eq('库里章节名已改', fresh().title, '楔子');
eq('顶栏跟着变', titleNode(page).textContent, '楔子');
eq('正文没动', fresh().content, '正文。');
ok('正文区没有被重画（节点还是原来那个）',
  page.children[1].children[0] === readerBefore);

console.log('\n== 取消不改名 ==');
openRename(page).cancelBtn.dispatch('click');
await sleep(0);
eq('取消后章节名不变', fresh().title, '楔子');

console.log('\n== 空名字不能提交 ==');
const blank = openRename(page);
blank.input.value = '';
blank.input.dispatch('input');
ok('清空后「保存」被禁用', blank.saveBtn.disabled === true);
blank.cancelBtn.dispatch('click');
await sleep(0);
eq('取消后依然没变', fresh().title, '楔子');

console.log('\n== 正文编辑中改名：不能冲掉没保存的正文 ==');
barAction(page, 0).dispatch('click');    // 铅笔 -> 进入编辑
const area = findAll(page, (n) => n.tagName === 'TEXTAREA' && n.className.includes('reader-edit'))[0];
ok('进入编辑态，textarea 已挂上', !!area);
area.value = '我改了一半的字';
await doRename(page, '楔子·改名');
eq('章节名改成功', fresh().title, '楔子·改名');
eq('顶栏显示新名', titleNode(page).textContent, '楔子·改名');
eq('没保存的正文还在 textarea 里', area.value, '我改了一半的字');
eq('库里的正文没被偷偷写进去', fresh().content, '正文。');

console.log('\n== 书/章节取不到时不炸 ==');
ok('章节 id 不存在时返回空页', render({ params: { id: book.id, cid: 'nope' } }).children.length === 0);
ok('书 id 不存在时返回空页', render({ params: { id: 'nope', cid } }).children.length === 0);

console.log('\n== 其它页面的标题不受影响 ==');
const { topbar } = await import('../js/components/topbar.js');
const plain = topbar({ title: '我的书架', hero: true });
const plainTitle = findAll(plain, (n) => n.className.includes('tb-title'))[0];
ok('不传 onTitle 就没有 editable 类', !plainTitle.className.includes('editable'), plainTitle.className);
eq('文字照旧渲染', plainTitle.textContent, '我的书架');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
