/**
 * 提示词编辑页的渲染冒烟测试。
 * 用最小 DOM 替身跑真实的 promptEdit.render()，验证结构而不只是语法。
 *
 * 关注两件事：
 * 1) 右上角「更多」点开后，菜单项从上到下依次是 保存 / 载入 / 恢复
 * 2) 预设区只列当前这一类的，别的类别存了预设也不显示
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
  prepend(...n) { n.reverse().forEach((x) => this.children.unshift(x)); }
  replaceChildren(...n) { this.children = []; this.childNodes = []; n.forEach((x) => this.appendChild(x)); }
  remove() {}
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
  querySelectorAll() { return []; }
  contains() { return false; }
  getBoundingClientRect() {
    return { top: 10, bottom: 50, left: 300, right: 340, width: 40, height: 40 };
  }
  get scrollHeight() { return 0; }
  setSelectionRange() {}
}
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ __text: String(t), nodeType: 3, textContent: String(t) }),
  body: new El('body'),
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => new El('div'),
  querySelector: () => new El('div'),
  documentElement: new El('html')
};
globalThis.window = {
  innerWidth: 390,
  innerHeight: 844,
  addEventListener() {},
  removeEventListener() {},
  location: { hash: '' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
globalThis.structuredClone = structuredClone;

const store = await import('../js/store.js');
const { render } = await import('../js/views/promptEdit.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const section = (t) => console.log('\n== ' + t + ' ==');

function texts(node, out = []) {
  if (!node) return out;
  if (node.__text !== undefined) { out.push(node.__text); return out; }
  if (node._text) out.push(node._text);
  (node.childNodes || []).forEach((c) => texts(c, out));
  return out;
}
function findAll(node, pred, out = []) {
  if (!node || node.__text !== undefined) return out;
  if (pred(node)) out.push(node);
  (node.childNodes || []).forEach((c) => findAll(c, pred, out));
  return out;
}

/* ---------------- 基础渲染 ---------------- */

section('创作提示词页渲染');
let page = render({ params: { kind: 'create' } });
let flat = texts(page).join(' | ');

ok('标题是「创作提示词」', flat.includes('创作提示词'), flat.slice(0, 120));
ok('有系统提示词分区', flat.includes('系统提示词'));
ok('有添加提示词块按钮', flat.includes('添加提示词块'));
ok('有预设分区', flat.includes('创作预设'), flat.slice(0, 200));
ok('预设区有「保存当前为预设」入口', flat.includes('保存当前为预设'));
ok('没渲染出别的类别的预设分区', !flat.includes('续写预设') && !flat.includes('评论预设'));

/* ---------------- 顶栏「更多」菜单 ---------------- */

section('右上角更多菜单');
{
  // 顶栏按钮里，返回键也是 .tb-btn，按 title 精确定位更稳
  const btns = findAll(page, (n) => n.className.includes('tb-btn'));
  const more = btns.find((n) => n.attrs.title === '更多');
  ok('顶栏有「更多」按钮', !!more, 'got ' + btns.length + ' ' +
    JSON.stringify(btns.map((b) => b.attrs.title)));

  more.click();

  const panel = globalThis.document.body.children.find((c) => (c.className || '').includes('dd-menu'));
  ok('点开后菜单已挂到 body 上', !!panel);
  if (panel) {
    const items = findAll(panel, (n) => n.className.includes('dd-item'));
    const labels = items.map((n) => (n._text || '') + texts(n).join(''));

    ok('菜单有 3 项', items.length === 3, 'got ' + items.length + ' ' + JSON.stringify(labels));
    ok('从上到下：保存', labels[0].startsWith('保存'), labels[0]);
    ok('第二项：载入', labels[1].startsWith('载入'), labels[1]);
    ok('第三项：恢复', labels[2].startsWith('恢复'), labels[2]);

    const joined = labels.join(' | ');
    ok('「恢复」写作恢复而非恢复默认', joined.includes('恢复') && !joined.includes('恢复默认'), joined);
    ok('菜单项带说明文字', joined.includes('存为预设') && joined.includes('回到初始状态'), joined);
    ok('没有分隔线以外的杂项', !joined.includes('预览'), joined);
  }
}

/* ---------------- 预设隔离：别的类别不显示 ---------------- */

section('预设不串页');
{
  store.savePromptPreset('create', '创作-短篇');
  store.savePromptPreset('continue', '续写-细腻');
  store.savePromptPreset('comment', '评论-毒舌');

  const p2 = render({ params: { kind: 'create' } });
  const flat2 = texts(p2).join(' | ');
  ok('创作页列出自己的预设', flat2.includes('创作-短篇'), flat2.slice(0, 300));
  ok('创作页不显示续写的预设', !flat2.includes('续写-细腻'), flat2.slice(0, 300));
  ok('创作页不显示评论的预设', !flat2.includes('评论-毒舌'), flat2.slice(0, 300));

  const p3 = render({ params: { kind: 'continue' } });
  const flat3 = texts(p3).join(' | ');
  ok('续写页列出自己的预设', flat3.includes('续写-细腻'));
  ok('续写页不显示创作的预设', !flat3.includes('创作-短篇'));
  ok('续写页标题带「续写」', flat3.includes('续写提示词'));
  ok('续写页分区是「续写预设」', flat3.includes('续写预设'));

  const p4 = render({ params: { kind: 'comment' } });
  const flat4 = texts(p4).join(' | ');
  ok('评论页列出自己的预设', flat4.includes('评论-毒舌'));
  ok('评论页不显示其它类别的预设', !flat4.includes('创作-短篇') && !flat4.includes('续写-细腻'));
}

/* ---------------- 非法 kind 兜底 ---------------- */

section('非法 kind 兜底');
{
  const p5 = render({ params: { kind: 'nope' } });
  const flat5 = texts(p5).join(' | ');
  ok('未知 kind 落到创作', flat5.includes('创作提示词'), flat5.slice(0, 80));
  const p6 = render({ params: {} });
  ok('缺 params 也不炸', texts(p6).join(' ').includes('创作提示词'));
}

/* ---------------- 预设行可点、有点操作钮 ---------------- */

section('预设行结构');
{
  const p7 = render({ params: { kind: 'create' } });
  const rows = findAll(p7, (n) => n.className.split(/\s+/).includes('row') && texts(n).join('').includes('创作-短篇'));
  ok('找到预设行', rows.length === 1, 'got ' + rows.length);
  const ops = findAll(rows[0] || new El('div'), (n) => n.className.includes('row-op'));
  ok('预设行带操作按钮（重命名/删除）', ops.length === 1, 'got ' + ops.length);
  const btns = findAll(p7, (n) => n.className.split(/\s+/).includes('row') && texts(n).join('').includes('保存当前为预设'));
  ok('有「保存当前为预设」行', btns.length === 1);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
