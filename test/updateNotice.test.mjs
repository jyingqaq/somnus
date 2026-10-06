/**
 * 「获取更新」的守卫测试。
 *
 * 需求：更新改成**用户主动获取** —— 打开应用不再自动弹「更新说明」、底部也不再挂
 * 「有新版本可用」条。用户走「设置 → 获取更新」，在那里看到「有没有新版本 /
 * 这次改了什么 / 要不要现在更新」。
 *
 * 这个用例守四件事：
 * 1) `js/changelog.js` 的数据体检（id 唯一、日期格式、items 有内容）——
 *    这份数据是手写的，写错一个 id 的代价是「用户看不到这一版更新」，不报错、静默失效。
 * 2) `pendingUpdates()` 的三条规则，尤其是**第一次打开只给最新一条**：
 *    绝不能回退成「全部」，否则更新页会给新用户标出一整屏「新」。
 * 3) `newerUpdates()` —— 「线上比本地多出来的条目」才是这次要告诉用户的内容。
 *    本机跑的 changelog 是旧壳里的，不知道线上新条目；判定全靠 id 集合。
 * 4) 更新页本身：有「获取更新」按钮、历史条目都在、最新标「最新」、没看过的标「新」、
 *    渲染后把「看到哪一版」记下来；点检查按钮会根据结果换文案、有新版时出「立即更新」。
 *
 * 一份不在这里、只在真浏览器里验的：**新版本的具体内容**。
 * 那要求线上真的有一份更长的 changelog，只有 `verify-pwa-update.mjs`
 * （自己起服务、跑到一半真发一版）做得到。
 *
 * 「有没有牙」实测（写完照例验一次）：
 * - 把 `pendingUpdates` 最后一行 `[list[0]]` 改成 `list`，第 2 节连红。
 * - 把 `newerUpdates` 里的过滤条件去掉（不过滤 known），第 3 节立刻红一片。
 * - 把更新页里的 `markUpdatesSeen(...)` 删掉，第 4 节「记下看到哪一版」红。
 * - 把 `busy.attach(btn, label)` 的第二个参数去掉，第 4 节「忙态只换文字、
 *   不抹掉图标」红（那正是 `attach` 的第二个参数存在的理由）。
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
/*
 * 默认**没有** serviceWorker —— 也就是 file:// 直接打开那种环境。
 * 更新页在这种环境下点「获取更新」应该给出明确说法，而不是崩在
 * `navigator.serviceWorker` 上。后面第 4 节会临时把它补上。
 *
 * 注意得用 defineProperty：Node 22 自带一个只读的 globalThis.navigator。
 */
const stubNavigator = {};
Object.defineProperty(globalThis, 'navigator', {
  value: stubNavigator, writable: true, configurable: true
});

const store = await import('../js/store.js');
const { CHANGELOG } = await import('../js/changelog.js');
const notice = await import('../js/services/updateNotice.js');
const {
  updates, latestUpdate, updateSummary, pendingUpdates, newerUpdates, updateItem
} = notice;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) => ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const btnByText = (node, t) => findAll(node, (n) => n.tagName === 'BUTTON' && textOf(n) === t)[0];
const buttonsOf = (node) => findAll(node, (n) => n.tagName === 'BUTTON');

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

console.log('\n== 自动弹出的老路子必须已经拆掉了 ==');
ok('updateNotice.js 不再导出 showUpdateNoticeIfAny',
  typeof notice.showUpdateNoticeIfAny === 'undefined',
  Object.keys(notice).join(','));
ok('updateNotice.js 不再提「弹窗」这件事',
  !/openModal/.test(await (await import('node:fs/promises')).readFile(
    new URL('../js/services/updateNotice.js', import.meta.url), 'utf8')));

/* ================= 2) pendingUpdates 的三条规则 ================= */

console.log('\n== 哪些算「没看过」 ==');
const A = { id: 'v14', date: '2026-10-04', title: 'A', items: ['a'] };
const B = { id: 'v13', date: '2026-10-01', title: 'B', items: ['b'] };
const C = { id: 'v12', date: '2026-09-20', title: 'C', items: ['c'] };
const three = [A, B, C];
const idsOf = (arr) => arr.map((it) => it.id).join(',');

eq('列表为空 -> 什么都不算新', idsOf(pendingUpdates([], '')), '');
eq('列表为空且看过 -> 什么都不算新', idsOf(pendingUpdates([], 'v14')), '');
// 这条是「第一次打开别被历史糊一脸」的守卫
eq('从没看过 -> 只算最新那一条（不是全部）', idsOf(pendingUpdates(three, '')), 'v14');
eq('只有一条时从没看过 -> 就算那一条', idsOf(pendingUpdates([A], '')), 'v14');
eq('看过的正好是最新 -> 没有新的', idsOf(pendingUpdates(three, 'v14')), '');
eq('看过中间那条 -> 只算它前面的', idsOf(pendingUpdates(three, 'v13')), 'v14');
eq('看过最老那条 -> 算前面两条', idsOf(pendingUpdates(three, 'v12')), 'v14,v13');
// 列表被删改过（id 对不上）也不能把整份历史倒出来
eq('看过的 id 已经不在列表里 -> 只算最新那一条', idsOf(pendingUpdates(three, 'v99')), 'v14');
eq('lastSeen 是脏数据 -> 只算最新那一条', idsOf(pendingUpdates(three, '瞎写的')), 'v14');

/* ================= 3) newerUpdates：线上比本地多出来的 ================= */

console.log('\n== 「这次改了什么」= 线上有、本地没有的条目 ==');
const X = { id: 'v16', date: '2026-10-07', title: 'X', items: ['x'] };
const Y = { id: 'v15', date: '2026-10-06', title: 'Y', items: ['y'] };

eq('线上多一条 -> 就是它', idsOf(newerUpdates([X, A, B], [A, B])), 'v16');
eq('线上多两条 -> 两条都要，且保持线上的顺序', idsOf(newerUpdates([X, Y, A], [A, B])), 'v16,v15');
eq('线上和本地一模一样 -> 空', idsOf(newerUpdates([A, B], [A, B])), '');
eq('线上反而更旧（本地是自己改过的开发版）-> 空', idsOf(newerUpdates([B, C], [A, B, C])), '');
eq('线上是空的 -> 空', idsOf(newerUpdates([], [A])), '');
eq('线上是 null / 脏数据 -> 空', idsOf(newerUpdates(null, [A])), '');
eq('线上条目缺 items 的丢掉', idsOf(newerUpdates([{ id: 'v99' }, X], [A])), 'v16');
eq('线上条目缺 id 的丢掉', idsOf(newerUpdates([{ items: ['x'] }, X], [A])), 'v16');
// 只认 id：改了标题不算新条目（否则每次改一次错别字都会通知用户「有新版本」）
eq('同 id 但文字改了 -> 不算新',
  idsOf(newerUpdates([{ id: 'v14', date: '2026-10-04', title: 'A 改过', items: ['a 改过'] }], [A])), '');
// 默认 local 取本地这份 CHANGELOG —— 自己跟自己比必然没有新东西
eq('不传 local 时拿本地 CHANGELOG 比 -> 空', idsOf(newerUpdates(updates())), '');

/* ================= 4) 更新页 ================= */

console.log('\n== 设置 → 获取更新：长什么样 ==');
const { render: renderUpdates } = await import('../js/views/settingsUpdates.js');

/** 按 class 取节点：按钮上的文案会被忙态改掉，按文字取会取不到 */
const getBtnOf = (p) => findAll(p, (n) => n.tagName === 'BUTTON' && hasClass(n, 'up-get'))[0];
const stateOf = (p) => textOf(p.querySelector('.up-state'));
const tagsOf = (p, label) => findAll(p, (n) => hasClass(n, 'un-tag') && textOf(n) === label);
/** 轮询等条件成立（检查是异步的，还有一次真的 import） */
async function waitUntil(fn, ms) {
  const until = Date.now() + (ms || 5000);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await sleep(50);
  }
}

// 故意把「看到哪一版」停在中间那一条：这样最新那条之外，中间那两条也该标「新」
store.patchUi({ lastSeenUpdate: CHANGELOG[2] && CHANGELOG[2].id });

const page = renderUpdates({});
const getBtn = getBtnOf(page);
ok('页面上有「获取更新」按钮', !!getBtn);
ok('按钮里带刷新图标（不是纯文字）', !!getBtn.querySelector('.ico'), getBtn.innerHTML);

ok('历史日志列出了每一条', CHANGELOG.every((it) => textOf(page).includes(it.title)), textOf(page));
ok('每条的正文都在', CHANGELOG.every((it) => it.items.every((t) => textOf(page).includes(t))));

const items = findAll(page, (n) => hasClass(n, 'un-item'));
eq('条目数与日志条数一致', items.length, CHANGELOG.length);
const tagOfItem = (el) => textOf(findAll(el, (n) => hasClass(n, 'un-tag'))[0] || null);
eq('最新那条标「最新」', tagOfItem(items[0]), '最新');
eq('没看过的那条标「新」', tagOfItem(items[1]), '新');
eq('看过的老条目不带标', tagOfItem(items[2]), '');
eq('整页只有一颗「最新」', tagsOf(page, '最新').length, 1);
eq('整页没看过的就一条', tagsOf(page, '新').length, 1);
ok('「看到哪一版」渲染后被记成最新那条',
  store.getState().ui.lastSeenUpdate === CHANGELOG[0].id,
  store.getState().ui.lastSeenUpdate);

/* ---------- 没有 Service Worker 的环境（file:// 直接打开） ---------- */
console.log('\n== 点一下「获取更新」：这个环境查不了，得说清楚 ==');
await waitUntil(() => stateOf(page).includes('http'));
ok('查不了时给的是「用 http 打开才能用」，不是沉默或报错',
  stateOf(page).includes('http'), stateOf(page));
ok('查不了时不出现「立即更新」按钮', !btnByText(page, '立即更新'), stateOf(page));

/* ---------- 记档之后再进：不再标「新」 ---------- */
console.log('\n== 看过之后不该再标「新」 ==');
const page2 = renderUpdates({});
eq('记档之后再进这个页面 -> 不再标「新」', tagsOf(page2, '新').length, 0);
// 等这一份**自己那次**自动检查跑完，免得它占着忙态
await waitUntil(() => stateOf(page2).includes('http'));
eq('查完按钮恢复可点', getBtnOf(page2).disabled, false);
eq('没东西可更时「获取更新」是主按钮', hasClass(getBtnOf(page2), 'primary'), true);

/* ---------- 有 Service Worker 且线上有新壳 ---------- */
console.log('\n== 有新版可用：文案换了，并且多出「立即更新」 ==');
const fakeReg = {
  waiting: { postMessage() {} },
  installing: null,
  update: async () => {}
};
globalThis.navigator.serviceWorker = {
  getRegistration: async () => fakeReg,
  addEventListener() {}
};

const btn2 = getBtnOf(page2);
btn2.dispatch('click');   // run() 是异步的，先看它当场进忙态
eq('点下去按钮立刻变忙（不等到结果才反应）', btn2.disabled, true);
ok('忙态只换文字，不抹掉左边那颗图标',
  !!btn2.querySelector('.ico') && !!btn2.querySelector('.up-get-label'),
  btn2.innerHTML);
eq('忙态文案是「检查中…」', textOf(btn2.querySelector('.up-get-label')), '检查中…');

await waitUntil(() => stateOf(page2).includes('有新版本'));
ok('查出有新版本时文案变成「发现新版本」', stateOf(page2).includes('发现新版本'), stateOf(page2));
ok('也说明了下面列的是这次改了什么', textOf(page2).includes('这次改了什么'), textOf(page2));
const goBtn = btnByText(page2, '立即更新');
ok('多出一颗「立即更新」按钮', !!goBtn);
ok('提醒了更新后会自动重开', textOf(page2).includes('自动重新打开'), textOf(page2));
eq('有新版时「获取更新」降成次要（主位让给「立即更新」）', hasClass(btn2, 'primary'), false);
eq('查完按钮恢复可点', btn2.disabled, false);
eq('按钮文字回到「获取更新」', textOf(btn2.querySelector('.up-get-label')), '获取更新');

goBtn.dispatch('click');
eq('点「立即更新」后按钮不许再点（切壳 + 重开是不可逆的）', goBtn.disabled, true);
eq('点完的文案是「更新中…」', textOf(goBtn), '更新中…');

/* ---------- 一条更新都没有的兜底 ---------- */
console.log('\n== 日志为空时也不崩 ==');
CHANGELOG.splice(0, CHANGELOG.length);
const emptyPage = renderUpdates({});
ok('空日志给的是「还没有更新记录」', textOf(emptyPage).includes('还没有更新记录'), textOf(emptyPage));
ok('空日志下「获取更新」按钮还在', !!getBtnOf(emptyPage));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
