/**
 * 「更新提示」的守卫测试。
 *
 * 需求：给自己一个写更新内容的地方（`js/changelog.js`），用户在应用里有改动时弹窗告知，
 * **每次更新只弹一次**，附一个「已阅」按键。
 *
 * 这个用例守四件事：
 * 1) `js/changelog.js` 的数据体检（id 唯一、日期格式、items 有内容）——
 *    这份数据是手写的，写错一个 id 的代价是「用户看不到这一版更新」，不报错、静默失效。
 * 2) `pendingUpdates()` 的三条规则，尤其是**第一次打开只给最新一条**：
 *    绝不能回退成「全部」，否则新用户会被积攒的十几版更新糊一脸。
 * 3) 弹窗真的弹出来、正文真写着这次更新、**只有「已阅」一条出路**（没有 ×、点遮罩不关）、
 *    点「已阅」之后记档并关闭。
 * 4) 记档之后不再弹；等下一版（往列表前面塞一条）**会再弹一次，且只弹新的那条**。
 *
 * 「有没有牙」实测（写完照例验一次）：
 * - 把 `pendingUpdates` 最后一行 `[list[0]]` 改成 `list` 再看第 2 节，本应只红 1 条，
 *   实际会连第 4 节一起红（弹窗里冒出已阅过的旧条目）。
 * - 把 `closable: false` 去掉，第 3 节「没有 ×」立刻 FAIL。
 * - 把 `dismissable: false` 改成 true，第 3 节「点遮罩弹窗还在」立刻 FAIL。
 * - 把 `markUpdatesSeen` 从「已阅」的 onClick 里删掉，第 4 节「不再弹」全部 FAIL。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

/* ---------- 最小 DOM 替身（同 apiGate.test.mjs） ---------- */
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
  /** innerHTML 要真的解析出子节点：icon() 是先塞 svg 串再挂上去的 */
  set innerHTML(v) {
    this._html = v;
    this.childNodes = [];
    this.children = [];
    const VOID = /^(br|img|input|meta|link|path|circle|line|rect|polyline|polygon|use|stop)$/i;
    const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|<\/([a-zA-Z][\w-]*)>/g;
    const stack = [this];
    let m;
    while ((m = tagRe.exec(String(v)))) {
      if (m[4]) { if (stack.length > 1) stack.pop(); continue; }
      const el = new El(m[1]);
      const attrRe = /([\w-]+)(?:="([^"]*)")?/g;
      let a;
      while ((a = attrRe.exec(m[2] || ''))) {
        if (a[1] === 'class') el.className = a[2] || '';
        else el.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
      }
      stack[stack.length - 1].appendChild(el);
      if (!m[3] && !VOID.test(m[1])) stack.push(el);
    }
  }
  get innerHTML() { return this._html || ''; }
  appendChild(c) {
    if (c && c.__text !== undefined) { this.childNodes.push(c); }
    else { this.children.push(c); this.childNodes.push(c); if (c) c.parentNode = this; }
    return c;
  }
  append(...n) { n.forEach((x) => this.appendChild(x)); }
  prepend(...n) { n.reverse().forEach((x) => this.children.unshift(x)); }
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
  contains() { return true; }
  querySelector(sel) {
    const s = String(sel);
    const match = (n) => (s.startsWith('.')
      ? (n.className || '').split(/\s+/).includes(s.slice(1))
      : n.tagName === s.toUpperCase());
    const walk = (n) => {
      for (const c of n.childNodes || []) {
        if (c.__text !== undefined) continue;
        if (match(c)) return c;
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
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
const loc = { hash: '#/home' };
globalThis.location = loc;
globalThis.window = {
  addEventListener() {},
  location: loc,
  scrollTo() {},
  history: { length: 0 },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();

const store = await import('../js/store.js');
const { CHANGELOG } = await import('../js/changelog.js');
const {
  updates, latestUpdate, updateSummary, pendingUpdates, showUpdateNoticeIfAny
} = await import('../js/services/updateNotice.js');

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
/** 纯文本只落在 childNodes 上，不能用 textContent 取 */
function textOf(n) {
  if (!n) return '';
  if (n.__text !== undefined) return n.__text;
  return (n.childNodes || []).map(textOf).join('') || n._text || '';
}
const hasClass = (n, c) => (n.className || '').split(/\s+/).includes(c);
const modalRoot = () => document.getElementById('modal-root');
const modalCount = () => (modalRoot().childNodes || []).length;
const clearModals = () => { modalRoot().replaceChildren(); };
const btnByText = (node, t) => findAll(node, (n) => n.tagName === 'BUTTON' && textOf(n) === t)[0];
const modalText = () => textOf(modalRoot());

/* ================= 1) 数据体检 ================= */

console.log('\n== js/changelog.js 的数据得是能用的 ==');
ok('CHANGELOG 是非空数组', Array.isArray(CHANGELOG) && CHANGELOG.length > 0);
const ids = CHANGELOG.map((it) => it && it.id);
eq('id 不重复', new Set(ids).size, ids.length);
ok('每条都有非空 id', ids.every((id) => typeof id === 'string' && id.trim().length > 0), JSON.stringify(ids));
ok('每条 date 都是 2026-10-04 这种格式',
  CHANGELOG.every((it) => /^\d{4}-\d{2}-\d{2}$/.test(it.date || '')),
  JSON.stringify(CHANGELOG.map((it) => it.date)));
ok('每条都有标题', CHANGELOG.every((it) => typeof it.title === 'string' && it.title.trim().length > 0));
ok('每条 items 都是非空数组、且每行都是非空字符串',
  CHANGELOG.every((it) => Array.isArray(it.items) && it.items.length > 0
    && it.items.every((t) => typeof t === 'string' && t.trim().length > 0)));
ok('updates() 把不能用的条目挡在外面（缺 id / 缺 items 直接丢）',
  updates().length === CHANGELOG.filter((it) => it && it.id && it.items).length);
eq('latestUpdate() 就是列表第一条', latestUpdate() && latestUpdate().id, CHANGELOG[0].id);
ok('updateSummary() 给设置页拼出「日期 · 标题」',
  updateSummary(latestUpdate()).startsWith(CHANGELOG[0].date), updateSummary(latestUpdate()));
eq('没有更新时摘要也不崩', updateSummary(null), '暂无更新记录');

/* ================= 2) pendingUpdates 的三条规则 ================= */

console.log('\n== 哪些算「没看过」 ==');
const A = { id: 'v14', date: '2026-10-04', title: 'A', items: ['a'] };
const B = { id: 'v13', date: '2026-10-01', title: 'B', items: ['b'] };
const C = { id: 'v12', date: '2026-09-20', title: 'C', items: ['c'] };
const three = [A, B, C];
const idsOf = (arr) => arr.map((it) => it.id).join(',');

eq('列表为空 -> 什么都不弹', idsOf(pendingUpdates([], '')), '');
eq('列表为空且看过 -> 什么都不弹', idsOf(pendingUpdates([], 'v14')), '');
// 这条是「第一次打开别被历史糊一脸」的守卫
eq('从没看过 -> 只给最新那一条（不是全部）', idsOf(pendingUpdates(three, '')), 'v14');
eq('只有一条时从没看过 -> 就给那一条', idsOf(pendingUpdates([A], '')), 'v14');
eq('看过的正好是最新 -> 不弹', idsOf(pendingUpdates(three, 'v14')), '');
eq('看过中间那条 -> 只弹它前面的', idsOf(pendingUpdates(three, 'v13')), 'v14');
eq('看过最老那条 -> 弹前面两条', idsOf(pendingUpdates(three, 'v12')), 'v14,v13');
// 列表被删改过（id 对不上）也不能把整份历史倒出来
eq('看过的 id 已经不在列表里 -> 只给最新那一条', idsOf(pendingUpdates(three, 'v99')), 'v14');
eq('lastSeen 是脏数据 -> 只给最新那一条', idsOf(pendingUpdates(three, '瞎写的')), 'v14');

/* ================= 3) 弹窗本身 ================= */

console.log('\n== 弹出来的是什么样 ==');
store.patchUi({ lastSeenUpdate: '' });
clearModals();
eq('这次该弹', showUpdateNoticeIfAny(), true);
eq('只挂了一个弹窗', modalCount(), 1);
ok('标题是「更新说明」', modalText().includes('更新说明'), modalText());
ok('写着这次更新的标题', modalText().includes(CHANGELOG[0].title), modalText());
ok('写着这次更新的正文（一条一行）',
  CHANGELOG[0].items.every((t) => modalText().includes(t)), modalText());
ok('带着日期', modalText().includes(CHANGELOG[0].date));

const readBtn = btnByText(modalRoot(), '已阅');
ok('有一颗「已阅」按钮', !!readBtn);
eq('弹窗里只有「已阅」这一颗按钮',
  findAll(modalRoot(), (n) => n.tagName === 'BUTTON').length, 1);
// 「只弹一次」的前提是用户必须真的表态 —— 留个 × 等于允许他随手点掉、下次又弹
eq('没有右上角的 ×', findAll(modalRoot(), (n) => hasClass(n, 'm-x')).length, 0);
const backdrop = findAll(modalRoot(), (n) => hasClass(n, 'modal-backdrop'))[0];
ok('找得到遮罩', !!backdrop);
backdrop.dispatch('click');
eq('点遮罩关不掉', modalCount(), 1);
eq('点遮罩也不算已阅', store.getState().ui.lastSeenUpdate, '');

readBtn.dispatch('click');
eq('点「已阅」后记下最新那条 id', store.getState().ui.lastSeenUpdate, CHANGELOG[0].id);
eq('点「已阅」后弹窗关掉', modalCount(), 0);

/* ================= 4) 只弹一次 / 下一版会再弹 ================= */

console.log('\n== 每次更新只弹一次 ==');
eq('同一次打开再检查一遍 -> 不再弹', showUpdateNoticeIfAny(), false);
eq('没弹就没多挂窗口', modalCount(), 0);

console.log('\n== 出了下一版：会再弹，而且只弹新的那条 ==');
const NEXT = { id: 'v15', date: '2026-10-05', title: '第二版', items: ['又改了点什么'] };
CHANGELOG.unshift(NEXT);
eq('新版本该弹', showUpdateNoticeIfAny(), true);
ok('弹的是新的那条', modalText().includes('又改了点什么'), modalText());
// 已经「已阅」过的旧条目绝不该跟着回来
ok('不重复出现已经已阅过的旧条目', !modalText().includes(CHANGELOG[1].items[0]), modalText());
eq('旧条目的标题也不出现', modalText().includes(CHANGELOG[1].title), false);
btnByText(modalRoot(), '已阅').dispatch('click');
eq('已阅记的是最新那条', store.getState().ui.lastSeenUpdate, 'v15');
eq('这次也不再多弹', showUpdateNoticeIfAny(), false);

/* ================= 5) 设置里的更新日志页 ================= */

console.log('\n== 设置 → 更新日志：随时回看 ==');
const { render: renderLog } = await import('../js/views/settingsUpdates.js');
const logPage = renderLog({});
ok('日志页列出了每一条', CHANGELOG.every((it) => textOf(logPage).includes(it.title)), textOf(logPage));
eq('只有最新那条带「最新」小标',
  findAll(logPage, (n) => hasClass(n, 'un-tag')).length, 1);
eq('「最新」小标就在第一条上', textOf(findAll(logPage, (n) => hasClass(n, 'un-tag'))[0]), '最新');
ok('每条的正文都在', CHANGELOG.every((it) => it.items.every((t) => textOf(logPage).includes(t))));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
