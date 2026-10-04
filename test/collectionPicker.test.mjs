/**
 * 首页输入框的「角色 / 世界书 / 灵感」选取面板必须跟着「我的」页的文件夹分组走。
 *
 * 曾出的问题：首页那三个功能是 `store.list()` **全量平铺**，而「我的 → 角色 / 世界书 / 灵感」
 * 里分好的文件夹到不了首页 —— 用户在一堆条目里找不着北，得先记住名字才知道该挑哪个。
 * 文件夹本来就是同一份数据（`state.folders` + 条目的 `folderId`），换了个入口不该变样。
 *
 * 这个用例跑的是**真实的** `views/home.js`（含输入框、功能栏、选取面板）和
 * `views/library.js`（管理页），只把 DOM 换成最小的替身，所以能顺带守住一条：
 * 两边用的是同一套行结构（components/collectionList.js）。
 *
 * 最要紧的一条断言：「艾伦」被放进文件夹后，**根目录不许再出现他**。
 * 之前正是「根目录把文件夹里的条目也一起列出来」，才让文件夹形同虚设。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

/* ---------- 最小 DOM 替身（同 apiGate.test.mjs，多补一个 getSelection） ---------- */
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
  /** innerHTML 要真的解析出子节点（编辑器芯片、loading 等都靠它） */
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
  /** editor.insertChip 收尾会 dispatchEvent(new Event('input'))（真 DOM 的成员，替身得补） */
  dispatchEvent(ev) { this.dispatch(ev && ev.type, ev); }
  click() { this.dispatch('click'); }
  focus() {}
  closest() { return null; }
  contains() { return true; }
  querySelector(sel) {
    const s = String(sel);
    const match = (n) => {
      if (s.startsWith('.')) return (n.className || '').split(/\s+/).includes(s.slice(1));
      return n.tagName === s.toUpperCase();
    };
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
  execCommand() { return true; },
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
/**
 * 编辑器插入芯片时会问 window.getSelection()。
 * 替身里给一个「没有选区」的返回值，走 `box.append(chip, space)` 那条分支 ——
 * 真浏览器里点完面板光标位置仍然实测过（verify-compose-open.mjs），这里只验「芯片真的插进去了」。
 */
const emptySelection = () => ({ rangeCount: 0, anchorNode: null, removeAllRanges() {}, addRange() {} });
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  location: loc,
  scrollTo() {},
  history: { length: 0 },
  getSelection: emptySelection,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.getSelection = emptySelection;

const store = await import('../js/store.js');
const { render: homeRender } = await import('../js/views/home.js');
const { render: libraryRender } = await import('../js/views/library.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const section = (t) => console.log('\n== ' + t + ' ==');

function findAll(node, pred, out = []) {
  if (!node || node.__text !== undefined) return out;
  if (pred(node)) out.push(node);
  (node.childNodes || []).forEach((c) => findAll(c, pred, out));
  return out;
}
/** 纯文本只落在 childNodes 上，textContent 走的是 children 那条路，读不全 */
function textOf(n) {
  if (!n) return '';
  if (n.__text !== undefined) return n.__text;
  const inner = (n.childNodes || []).map(textOf).join('');
  return inner || n._text || '';
}
const hasClass = (n, c) => (n.className || '').split(/\s+/).includes(c);

const modalRoot = () => globalThis.document.getElementById('modal-root');
const openSheets = () => (modalRoot().childNodes || []).filter((n) => hasClass(n, 'modal-root'));
/** 面板里的文件夹行 / 条目行 / 面包屑 */
const sheetFolders = () => findAll(modalRoot(), (n) => hasClass(n, 'folder-row'));
const sheetItems = () => findAll(modalRoot(), (n) => hasClass(n, 'row'));
const labelOf = (row) => textOf(findAll(row, (n) => hasClass(n, 'row-title') || hasClass(n, 'fo-name'))[0]);
const countOf = (row) => textOf(findAll(row, (n) => hasClass(n, 'fo-count'))[0]);
const emptyText = () => textOf(findAll(modalRoot(), (n) => hasClass(n, 'empty'))[0]);
const crumbText = () => textOf(findAll(modalRoot(), (n) => hasClass(n, 'crumb'))[0]);

/* ---------------- 播种：三个库各自建文件夹，条目分「进文件夹」和「未分类」 ---------------- */
const fRole = store.addFolder('roles', '主角组');
const fWorld = store.addFolder('worlds', '北境地理');
const fIdea = store.addFolder('ideas', '开场灵感');

store.add('roles', { title: '艾伦', detail: '主角设定：落魄剑客，左手有旧伤。', folderId: fRole.id });
store.add('roles', { title: '莉娜', detail: '未分类的女主，药师。', folderId: '' });
store.add('worlds', { title: '极夜城', detail: '北境唯一的城邦。', folderId: fWorld.id });
store.add('worlds', { title: '大陆通史', detail: '未分类的世界背景。', folderId: '' });
store.add('ideas', { title: '雨夜重逢', detail: '开场：雨夜，两个人时隔十年再见。', folderId: fIdea.id });
store.add('ideas', { title: '会飞的猫', detail: '未分类的零碎点子。', folderId: '' });

const page = homeRender({});
const actionBtn = (label) => findAll(page, (n) => n.tagName === 'BUTTON' && n.attrs['aria-label'] === label)[0];
const openPicker = (label) => {
  modalRoot().replaceChildren();
  const btn = actionBtn(label);
  ok(`首页功能栏找得到「${label}」`, !!btn);
  if (btn) btn.click();
  return btn;
};

/* ---------------- 1. 根目录：先文件夹，条目不越级 ---------------- */
section('根目录：先文件夹，文件夹里的条目不跟着列出来');
openPicker('角色');

eq('面板里出现 1 个文件夹', sheetFolders().map(labelOf), ['主角组']);
eq('文件夹副文案是条目数', countOf(sheetFolders()[0]), '1 项');
eq('根目录只列未分类的条目', sheetItems().map(labelOf), ['莉娜']);
ok('「艾伦」被放进文件夹后，根目录不再出现（这次修的就是这条）',
  !sheetItems().some((r) => labelOf(r) === '艾伦'), JSON.stringify(sheetItems().map(labelOf)));
eq('只列本库的文件夹（世界书 / 灵感的夹子不串进来）', sheetFolders().length, 1);

/* ---------------- 2. 进文件夹 / 面包屑返回 ---------------- */
section('点文件夹只列该文件夹的条目，面包屑能回来');
sheetFolders()[0].click();

eq('标题下出现面包屑', crumbText(), '角色/主角组');
eq('文件夹里只列自己的条目', sheetItems().map(labelOf), ['艾伦']);
ok('进去之后不再显示文件夹行（不能再往里套）', sheetFolders().length === 0);
ok('文件夹外的条目不会跟进来看见', !sheetItems().some((r) => labelOf(r) === '莉娜'));

const back = findAll(modalRoot(), (n) => hasClass(n, 'crumb-back'))[0];
ok('面包屑前的类别名是可点的返回', !!back);
back.click();
eq('点面包屑回到根目录', sheetItems().map(labelOf), ['莉娜']);
eq('文件夹行也回来了', sheetFolders().map(labelOf), ['主角组']);

/* ---------------- 3. 选中：面板先关，芯片再插进输入框 ---------------- */
section('选中条目：面板关掉、芯片插进输入框');
{
  sheetItems()[0].click();   // 莉娜
  eq('挑完之后面板已关闭', openSheets().length, 0);

  const chips = findAll(page, (n) => hasClass(n, 'chip'));
  eq('输入框里插进了 1 个芯片', chips.length, 1);
  eq('芯片记的是哪一类', chips[0].attrs['data-chip'], 'role');
  eq('芯片上写的是条目标题', chips[0].attrs['data-title'], '莉娜');

  // 进文件夹里挑一个，同样插得进去
  openPicker('角色');
  sheetFolders()[0].click();
  sheetItems()[0].click();
  const chips2 = findAll(page, (n) => hasClass(n, 'chip'));
  eq('从文件夹里挑也能插进输入框', chips2.length, 2);
  eq('插进去的是文件夹里那一条', chips2[1].attrs['data-title'], '艾伦');
}

/* ---------------- 4. 三个入口各看各的库 ---------------- */
section('世界书 / 灵感各自的分组');
{
  openPicker('世界书');
  eq('世界书面板列自己的文件夹', sheetFolders().map(labelOf), ['北境地理']);
  eq('世界书面板的根目录只有自己的未分类条目', sheetItems().map(labelOf), ['大陆通史']);

  openPicker('灵感');
  eq('灵感面板列自己的文件夹', sheetFolders().map(labelOf), ['开场灵感']);
  eq('灵感面板的根目录只有自己的未分类条目', sheetItems().map(labelOf), ['会飞的猫']);
}

/* ---------------- 5. 空态 ---------------- */
section('空态文案');
{
  const fEmpty = store.addFolder('roles', '空夹子');
  openPicker('角色');
  const empty = sheetFolders().find((r) => labelOf(r) === '空夹子');
  ok('空文件夹也照常列出来', !!empty);
  eq('空文件夹的计数是 0', countOf(empty), '0 项');
  empty.click();
  eq('空文件夹里有话说明', emptyText(), '该文件夹暂无内容');
  eq('空文件夹里没有条目行', sheetItems().length, 0);

  // 根目录一条条目都没有、但还有文件夹在看 —— 这时不该说「暂无内容」
  store.remove('roles', store.list('roles').find((it) => it.title === '莉娜').id);
  openPicker('角色');
  eq('只剩下文件夹时不算「暂无内容」', emptyText(), '');
  store.add('roles', { title: '莉娜', detail: '未分类的女主，药师。', folderId: '' });
}

/* ---------------- 6. 管理页用同一套行结构 ---------------- */
section('管理页（我的 → 角色）与面板同源');
{
  openPicker('角色');
  const lib = libraryRender({ params: { type: 'roles' } });
  const libFolders = findAll(lib, (n) => hasClass(n, 'folder-row'));
  const libItems = findAll(lib, (n) => hasClass(n, 'row'));

  eq('管理页根目录的文件夹与面板一致', libFolders.map(labelOf), sheetFolders().map(labelOf));
  eq('管理页的条目也只在未分类里', libItems.map(labelOf), ['莉娜']);
  eq('管理页的条目与面板一致', sheetItems().map(labelOf), ['莉娜']);
  eq('计数文案两边一样', libFolders.map(countOf), sheetFolders().map(countOf));
  ok('管理页的文件夹行带操作钮（重命名 / 删除）',
    findAll(libFolders[0], (n) => hasClass(n, 'fo-op')).length === 1);
  ok('选取面板的文件夹行没有那个操作钮（挑的时候不该改名）',
    findAll(sheetFolders()[0], (n) => hasClass(n, 'fo-op')).length === 0);
  ok('两边条目的图标都是 .row-ico（同一个 itemRow）',
    findAll(libItems[0], (n) => hasClass(n, 'row-ico')).length === 1
    && findAll(sheetItems()[0], (n) => hasClass(n, 'row-ico')).length === 1);

  libFolders[0].click();   // 进「主角组」
  eq('管理页进文件夹也只列该文件夹的条目',
    findAll(lib, (n) => hasClass(n, 'row')).map(labelOf), ['艾伦']);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
