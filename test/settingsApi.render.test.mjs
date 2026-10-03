/**
 * 设置页评论接口卡片的渲染冒烟测试。
 * 用最小 DOM 替身跑真实的 settingsApi.render()，验证结构而不只是语法。
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
  get scrollHeight() { return 0; }
  setSelectionRange() {}
}
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ __text: String(t), nodeType: 3, textContent: String(t) }),
  body: new El('body'),
  addEventListener() {},
  getElementById: () => new El('div'),
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
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
globalThis.structuredClone = structuredClone;

const store = await import('../js/store.js');
const { render } = await import('../js/views/settingsApi.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

/**
 * 把渲染出的树转成纯文本，便于断言。
 * 走 childNodes 而不是 children —— 纯文本节点只落在 childNodes 里。
 * 输入框的 value / placeholder 也一并收集。
 */
function texts(node, out = []) {
  if (!node) return out;
  if (node.__text !== undefined) { out.push(node.__text); return out; }
  if (node._text) out.push(node._text);
  // h() 把 value / placeholder 走 setAttribute，所以要从 attrs 里取
  if (node.tagName === 'INPUT') {
    if (node.attrs.value) out.push(node.attrs.value);
    if (node.attrs.placeholder) out.push(node.attrs.placeholder);
  }
  (node.childNodes || []).forEach((c) => texts(c, out));
  return out;
}
function findAll(node, pred, out = []) {
  if (!node || node.__text !== undefined) return out;
  if (pred(node)) out.push(node);
  (node.childNodes || []).forEach((c) => findAll(c, pred, out));
  return out;
}

store.patchSettings({ apiBase: 'https://main.example/v1', apiKey: 'sk-main', model: 'main-model', temperature: 0.9, maxTokens: 0 });

console.log('\n== 关闭状态渲染 ==');
store.patchCommentApi({ enabled: false, apiBase: '', apiKey: '', model: '', temperature: '', maxTokens: '' });
let page = render();
let all = texts(page);
let flat = all.join(' | ');

ok('渲染出主配置分区', flat.includes('主配置'));
ok('渲染出评论专用分区', flat.includes('评论专用接口'));
ok('有独立接口开关', flat.includes('使用独立接口'));
ok('关闭时说明跟随主配置', flat.includes('关闭中，评论沿用主配置'), flat);
ok('关闭时不显示评论地址输入项', !flat.includes('复制主配置过来'));
ok('关闭时不显示测试连接', !flat.includes('测试连接'));
ok('关闭时不显示当前生效', !flat.includes('当前生效'));
ok('仍保留预设区', flat.includes('保存当前配置为预设'));

// 开关存在且可切换
const sw = findAll(page, (n) => n.className.includes('switch'));
ok('找到开关元素', sw.length === 1, 'got ' + sw.length);

console.log('\n== 开启状态渲染 ==');
store.patchCommentApi({ enabled: true, apiBase: 'https://c.example/v1', apiKey: 'sk-c', model: 'c-model', temperature: '0.2', maxTokens: '2048' });
page = render();
all = texts(page);
flat = all.join(' | ');

ok('开启后显示地址字段', flat.includes('https://c.example/v1'), flat);
ok('开启后显示模型字段', flat.includes('c-model'));
ok('开启后显示当前生效', flat.includes('当前生效'));
ok('生效文案含专用地址', flat.includes('https://c.example/v1'));
ok('提供测试连接', flat.includes('测试连接'));
ok('提供复制主配置', flat.includes('复制主配置过来'));
ok('提供清空评论配置', flat.includes('清空评论配置'));
ok('无差异时不显示多余后缀', !flat.includes('（与主配置一致）'), flat);

// 输入框数量：主配置 5 个（地址/Key/模型/温度/最大长度）+ 评论 5 个 = 10
const inputs = findAll(page, (n) => n.tagName === 'INPUT' && n.className.includes('field'));
ok('输入框共 10 个', inputs.length === 10, 'got ' + inputs.length);

// 评论地址占位符应提示留空回落
const cAddr = inputs.find((i) => (i.attrs.placeholder || '').includes('留空沿用主配置'));
ok('评论字段占位符提示回落', !!cAddr);

console.log('\n== 部分覆盖：占位符回落到主配置值 ==');
store.patchCommentApi({ enabled: true, apiBase: '', apiKey: '', model: 'only-model', temperature: '', maxTokens: '' });
page = render();
flat = texts(page).join(' | ');
ok('占位符带出主配置地址', flat.includes('留空沿用主配置：https://main.example/v1'), flat);
ok('生效地址回落到主配置', flat.includes('当前生效 | https://main.example/v1 · only-model'), flat);
// 模型被单独改过，整体就算「与主配置不一致」，不该出现一致后缀
ok('模型不同时不显示一致后缀', !flat.includes('（与主配置一致）'), flat);

console.log('\n== 全部沿用主配置：显示一致后缀 ==');
store.patchCommentApi({ enabled: true, apiBase: '', apiKey: '', model: '', temperature: '', maxTokens: '' });
page = render();
flat = texts(page).join(' | ');
ok('全空时生效等于主配置', flat.includes('当前生效 | https://main.example/v1 · main-model'), flat);
ok('全空时提示与主配置一致', flat.includes('（与主配置一致）'), flat);

console.log('\n== 输入框改动写回 store ==');
store.patchCommentApi({ enabled: true, apiBase: '', apiKey: '', model: '', temperature: '', maxTokens: '' });
page = render();
const inputs2 = findAll(page, (n) => n.tagName === 'INPUT' && n.className.includes('field'));
// 后 5 个是评论专用：地址/Key/模型/温度/最大长度
const modelInput = inputs2[inputs2.length - 3];
modelInput.value = 'typed-model';
modelInput.dispatch('change');
eq2('改评论模型写回 commentApi', store.getState().settings.commentApi.model, 'typed-model');
ok('改评论模型不污染主配置', store.getState().settings.model === 'main-model');

// 评论地址留空 -> 空串，不写 undefined
const addrInput = inputs2[inputs2.length - 5];
addrInput.value = '   ';
addrInput.dispatch('change');
eq2('空白地址存为空串', store.getState().settings.commentApi.apiBase, '');

// 温度留空必须是空串，不能变成 0
const tempInput = inputs2[inputs2.length - 2];
tempInput.value = '';
tempInput.dispatch('change');
eq2('温度留空存空串', store.getState().settings.commentApi.temperature, '');

function eq2(n, got, want) { ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }

console.log('\n== 开关切换写回 store ==');
store.patchCommentApi({ enabled: true });
page = render();
const sw2 = findAll(page, (n) => n.className.includes('switch'))[0];
ok('开关初始为开', sw2.className.includes('on'));
sw2.dispatch('click');
eq2('点击后关闭', store.getState().settings.commentApi.enabled, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
