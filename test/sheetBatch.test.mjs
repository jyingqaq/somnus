/**
 * 底部面板 showSheet 的「长按批量删除」冒烟测试。
 *
 * 这里验的是**交互状态机**，不是样式：长按进多选 → 点选加减 → 一条不剩自动退出 →
 * 删除走确认框 → onDelete 拿到的是被选中的那批 id → 面板本地也把这批摘掉。
 * 所以 DOM 替身必须能派发 pointerdown（真实走一遍 onLongPress 的 420ms 定时器）
 * 并且 getElementById('modal-root') 每次要返回**同一个**根节点 ——
 * settingsApi 那份替身每次新建，挂上去的节点取不回来，这里不能照抄。
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
  closest() { return null; }   // onLongPress 用它判断落点是不是按钮/输入框
  querySelectorAll() { return []; }
  get scrollHeight() { return 0; }
  setSelectionRange() {}
}

// 关键差异：根节点复用，否则 showSheet 挂进去的东西取不回来
const roots = new Map();
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ __text: String(t), nodeType: 3, textContent: String(t) }),
  body: new El('body'),
  addEventListener() {},
  removeEventListener() {},   // onLongPress 吞掉点击后会去摘掉那个一次性监听
  getElementById: (id) => {
    if (!roots.has(id)) roots.set(id, new El('div'));
    return roots.get(id);
  },
  querySelector: () => new El('div'),
  documentElement: new El('html')
};
globalThis.window = {
  addEventListener() {},
  location: { hash: '' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();

const { showSheet } = await import('../js/components/modal.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) => ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 遍历工具 ---------- */
function walk(node, out = []) {
  if (!node || node.__text !== undefined) return out;
  out.push(node);
  (node.childNodes || []).forEach((c) => walk(c, out));
  return out;
}
const hasCls = (n, name) => (n.className || '').split(/\s+/).includes(name);
const pickBy = (root, name) => walk(root).filter((n) => hasCls(n, name));
const oneBy = (root, name) => pickBy(root, name)[0] || null;

/** 真实走一遍 onLongPress：按下 → 等过 420ms 阈值 */
async function longPress(el) {
  el.dispatch('pointerdown', { pointerType: 'touch', button: 0, clientX: 1, clientY: 1, target: el });
  await sleep(470);
}

const root = () => roots.get('modal-root');

/* ---------- 一批假预设 ---------- */
const opened = [];
const preset = (id, label) => ({
  id, label, sub: '2026-10-01 10:00', icon: 'load',
  onClick: () => opened.push(id)
});
const presets = () => [preset('a', '预设 A'), preset('b', '预设 B'), preset('c', '预设 C')];

/* ================= 批量模式 ================= */
console.log('\n== 长按之前的初始态 ==');
const deleted = [];
showSheet({
  title: '载入预设',
  items: presets(),
  confirmTitle: '删除预设',
  onDelete: (ids) => { deleted.push(...ids); }
});

let sheet = root().children[0];
const footBtns = () => pickBy(sheet, 'btn');
let rows = pickBy(sheet, 'row');

eq('列出 3 条预设', rows.length, 3);
eq('底部按钮 3 个（关闭/取消/删除）', footBtns().length, 3);
eq('标题是「载入预设」', oneBy(sheet, 'm-title').textContent, '载入预设');
ok('平时只显示「关闭」', footBtns()[0].hidden === false && footBtns()[1].hidden === true && footBtns()[2].hidden === true);
ok('有「长按可批量删除」提示', oneBy(sheet, 'sheet-tip').textContent === '长按可批量删除');
ok('平时没有勾选圈', pickBy(sheet, 'pick').length === 0);

console.log('\n== 长按进入多选 ==');
await longPress(rows[1]);            // 长按第 2 条
rows = pickBy(sheet, 'row');
eq('标题变成「已选 1」', oneBy(sheet, 'm-title').textContent, '已选 1');
ok('第 2 条被选中', hasCls(rows[1], 'picked'));
ok('第 1 条未选中', !hasCls(rows[0], 'picked'));
eq('每行都有勾选圈', pickBy(sheet, 'pick').length, 3);
ok('长按没有顺手触发「载入」', opened.length === 0, 'opened=' + JSON.stringify(opened));
ok('取消按钮出现', footBtns()[1].hidden === false);
ok('关闭按钮收起', footBtns()[0].hidden === true);
eq('删除按钮带数量', footBtns()[2].textContent, '删除 1');
ok('多选时提示收起来', oneBy(sheet, 'sheet-tip').hidden === true);
ok('多选时不显示右箭头', pickBy(sheet, 'chev').length === 0);

console.log('\n== 点选加减 ==');
rows = pickBy(sheet, 'row');
rows[2].click();
rows = pickBy(sheet, 'row');
eq('再选一条 → 「已选 2」', oneBy(sheet, 'm-title').textContent, '已选 2');
eq('删除按钮跟到 2', footBtns()[2].textContent, '删除 2');
ok('多选下点行不会载入', opened.length === 0);

rows[2].click();                     // 取消选中第 3 条
rows = pickBy(sheet, 'row');
eq('取消一条 → 「已选 1」', oneBy(sheet, 'm-title').textContent, '已选 1');
ok('再点一次后第 3 条不再是选中态', !hasCls(pickBy(sheet, 'row')[2], 'picked'));

rows[1].click();                     // 全部取消
sheet = root().children[0];
eq('一条不剩自动退出多选', oneBy(sheet, 'm-title').textContent, '载入预设');
ok('退出后删除按钮收起', footBtns()[2].hidden === true);
ok('退出后关闭按钮回来', footBtns()[0].hidden === false);
ok('退出后勾选圈消失', pickBy(sheet, 'pick').length === 0);
ok('退出后提示回来', oneBy(sheet, 'sheet-tip').hidden === false);

console.log('\n== 取消：不动数据 ==');
rows = pickBy(sheet, 'row');
await longPress(rows[0]);
rows = pickBy(sheet, 'row');
rows[1].click();                     // 选 a + b
footBtns()[1].click();               // 取消
sheet = root().children[0];
eq('取消后标题复原', oneBy(sheet, 'm-title').textContent, '载入预设');
ok('取消后没有任何删除', deleted.length === 0);

console.log('\n== 确认删除 ==');
rows = pickBy(sheet, 'row');
await longPress(rows[0]);            // 选中 a
rows = pickBy(sheet, 'row');
rows[2].click();                     // 加上 c
footBtns()[2].click();               // 删除

const confirmWrap = root().children[1];
ok('弹出了确认框', !!confirmWrap);
eq('确认框标题用 confirmTitle', oneBy(confirmWrap, 'm-title').textContent, '删除预设');
ok('确认框写明数量', oneBy(confirmWrap, 'alert-msg').textContent === '共 2 个');
eq('确认框两个按钮', pickBy(confirmWrap, 'btn').length, 2);

// 先点取消，验证不会删
pickBy(confirmWrap, 'btn')[0].click();
await sleep(0);
ok('确认框点取消不删除', deleted.length === 0);
ok('取消后仍停在多选里', oneBy(root().children[0], 'm-title').textContent === '已选 2');

// 再来一次，这次确认
footBtns()[2].click();
await sleep(0);
pickBy(root().children[1], 'btn')[1].click();
await sleep(0);
await sleep(0);

sheet = root().children[0];
eq('onDelete 收到被选中的 id', deleted.join(','), 'a,c');
rows = pickBy(sheet, 'row');
eq('面板本地摘掉这两条', rows.length, 1);
eq('剩下的是没选的那条', oneBy(sheet, 'row-title').textContent, '预设 B');
eq('删完退出多选', oneBy(sheet, 'm-title').textContent, '载入预设');
ok('删完删除按钮收起', footBtns()[2].hidden === true);

console.log('\n== 点行正常载入（非多选态） ==');
pickBy(sheet, 'row')[0].click();
eq('点一下就是载入', opened.join(','), 'b');
eq('载入后面板自己关掉', root().children.length, 0);

/* ================= 非批量模式：结构必须跟以前一样 ================= */
console.log('\n== 不传 onDelete 时行为不变 ==');
showSheet({ title: '角色', items: [preset('x', '角色 X')] });
const plain = root().children.at(-1);
eq('只有「关闭」一个按钮', pickBy(plain, 'btn').length, 1);
ok('没有批量提示', pickBy(plain, 'sheet-tip').length === 0);
ok('内容直接挂在 .modal-body 上（不多包一层）', hasCls(oneBy(plain, 'list').parentNode, 'modal-body'));
await longPress(pickBy(plain, 'row')[0]);
ok('长按无事发生', pickBy(plain, 'pick').length === 0 && oneBy(plain, 'm-title').textContent === '角色');

console.log('\n== 空列表 ==');
showSheet({ title: '载入预设', items: [], onDelete: () => {} });
const emptySheet = root().children.at(-1);
eq('空列表显示占位文案', oneBy(emptySheet, 'empty').textContent, '暂无内容');
ok('空列表不显示长按提示', oneBy(emptySheet, 'sheet-tip').hidden === true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
