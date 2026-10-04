/**
 * 「没配 API 就别进创作中」+「生成中按钮自己变忙态」的守卫测试。
 *
 * 曾出的问题：首页点「生成剧情」时，`showLoading('创作中')` 挂在**发请求之前**，
 * 而默认的 apiBase 本来就带着值（https://api.openai.com/v1），
 * 所以一个什么都没填的用户也会真的发一个注定 401 的请求 ——
 * 先看到满屏「创作中」转一圈，再收到一条看不懂的「请求失败 401 …」。
 *
 * 四件事要一起守住：
 * 1) `apiProblem()` 的判定规则（地址 + Key 都得有，本地无鉴权服务请随便填个 Key）；
 * 2) `chat()` 在没配好时**一个请求都不发**（哪怕调用方忘了先判）；
 * 3) 首页点「生成剧情」：不出现 `.loading`，而是弹出带「去设置」的弹窗；
 *    配好之后同一条路径该走还得走（弹窗别把正常用法也挡住）。
 * 4) **生成中不再盖全屏遮罩**，改成按钮自己变成不可点的「创作中……」
 *    （用户请求的改动：等待期间他能继续去别的页面干别的）。
 *    连带两件事：切走再切回来按钮得还是忙的；用户等待期间新写的字不能被回包冲掉。
 *
 * 书籍「续写」和章节「获取评论」是同一套做法（`createBusyButton`），但那是模块级单例 +
 * 真实路由重渲染才验得全，所以那两处交给真浏览器用例 `verify-inline-busy.mjs`。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

/* ---------- 最小 DOM 替身（同 creationBook.test.mjs） ---------- */
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
  /**
   * innerHTML 得**真的解析出子节点**：loading.js 就是先塞
   * `<div class="spin"></div><div class="txt"></div>` 再 querySelector('.txt') 写文字的。
   * 只存字符串的话，showLoading() 当场就炸。
   * 这里只认标签与属性（够用即可），并且原串仍然留给 innerHTML 读回。
   */
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

// 根节点复用：loading 挂 'layer-root'、弹窗挂 'modal-root'，都得能取回来
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
globalThis.window = {
  addEventListener() {},
  location: loc,
  scrollTo() {},
  history: { length: 0 },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();

/* ---------- 记录 fetch 有没有被发出去 ---------- */
let fetchCalls = 0;
let loadingAtFetch = -1;      // 发请求那一刻，界面上还挂着几个 loading
let busyAtFetch = null;       // 发请求那一刻，「生成剧情」按钮长什么样
let lastUrl = '';
let replyText = '  生成出来的正文  ';
/** 本轮重点是「按钮自己变忙」，所以得知道被点的是哪颗按钮 */
let watchBtn = null;
/** 挂住 fetch，好在「请求还没回来」的中间态里做断言 */
let holdFetch = false;
let releaseFetch = null;
globalThis.fetch = async (url) => {
  fetchCalls++;
  lastUrl = String(url);
  loadingAtFetch = loadingCount();
  busyAtFetch = watchBtn ? { text: textOf(watchBtn), disabled: !!watchBtn.disabled } : null;
  if (holdFetch) await new Promise((r) => { releaseFetch = r; });
  return { ok: true, json: async () => ({ model: 'fake', choices: [{ message: { content: replyText } }] }) };
};

const store = await import('../js/store.js');
const { apiProblem, chat } = await import('../js/services/ai.js');
const { render } = await import('../js/views/home.js');

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
/** 纯文本只落在 childNodes 上，不能用 textContent 取（它会走 children 那条路返回空） */
function textOf(n) {
  if (!n) return '';
  if (n.__text !== undefined) return n.__text;
  const inner = (n.childNodes || []).map(textOf).join('');
  return inner || n._text || '';
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 界面上现在挂着几个全屏 loading 遮罩 */
function loadingCount() {
  return (document.getElementById('layer-root').childNodes || [])
    .filter((n) => n.className && n.className.split(/\s+/).includes('loading')).length;
}
const modalRoot = () => document.getElementById('modal-root');
const clearModals = () => { modalRoot().replaceChildren(); };

/* ================= 1) 判定规则 ================= */

console.log('\n== apiProblem：地址和 Key 都得有 ==');
store.patchSettings({ apiBase: 'https://api.openai.com/v1', apiKey: '' });
eq('没填 Key 时提示 Key', apiProblem(), '还没填 API Key');

store.patchSettings({ apiKey: '   ' });
eq('Key 只有空白也算没填', apiProblem(), '还没填 API Key');

store.patchSettings({ apiKey: 'sk-x', apiBase: '   ' });
eq('没填地址时提示地址（且排在 Key 之前）', apiProblem(), '还没填 API 地址');

store.patchSettings({ apiKey: 'sk-x', apiBase: '' });
eq('地址为空串同样算没填', apiProblem(), '还没填 API 地址');

store.patchSettings({ apiKey: 'ollama', apiBase: 'http://127.0.0.1:11434/v1' });
eq('都填好了返回空串', apiProblem(), '');

console.log('\n== chat 在没配好时一个请求都不发 ==');
store.patchSettings({ apiBase: 'https://api.openai.com/v1', apiKey: '' });
fetchCalls = 0;
let err = '';
try {
  await chat([{ role: 'user', content: 'hi' }]);
} catch (e) { err = e.message; }
eq('抛出的就是给用户看的那句话', err, '还没填 API Key');
eq('没有发出任何请求', fetchCalls, 0);

console.log('\n== 评论专用接口也走同一套判定 ==');
store.patchCommentApi({ enabled: true, apiBase: '', apiKey: '' });
store.patchSettings({ apiBase: '', apiKey: 'sk-main' });
eq('开着但两边都没地址 -> 地址缺失', apiProblem('comment'), '还没填 API 地址');
store.patchSettings({ apiBase: 'https://main.example/v1', apiKey: '' });
eq('回落到主配置后仍缺 Key', apiProblem('comment'), '还没填 API Key');
store.patchSettings({ apiKey: 'sk-main' });
eq('回落补齐后就没问题', apiProblem('comment'), '');
store.patchCommentApi({ enabled: false, apiBase: '', apiKey: '' });

/* ================= 2) 首页点「生成剧情」 ================= */

/**
 * 渲染首页，填上正文，返回 { btn, editor, titleInput }
 *
 * 按钮**只能按 class 找**，不能按文字找：生成中它的文案已经变成「创作中……」，按文字会找不到。
 */
function homePage(request = '写一段开篇', title = '星海归途') {
  const page = render({});
  const ed = findAll(page, (n) => n.attrs && n.attrs.contenteditable === 'true')[0];
  ok('找到输入框', !!ed);
  if (request) ed.appendChild(document.createTextNode(request));
  const titleInput = findAll(page, (n) => n.tagName === 'INPUT' && n.attrs.placeholder === '标题')[0];
  if (titleInput) titleInput.value = title;
  const createBtn = findAll(page, (n) => n.tagName === 'BUTTON'
    && (n.className || '').split(/\s+/).includes('primary'))[0];
  return { page, btn: createBtn, editor: ed, titleInput };
}

console.log('\n== 没配好：只弹窗，不进「创作中」 ==');
store.patchSettings({ apiBase: 'https://api.openai.com/v1', apiKey: '' });
clearModals();
fetchCalls = 0;
const creationsBefore = store.list('creations').length;
const { btn } = homePage();
ok('首页有「生成剧情」按钮', !!btn);
watchBtn = btn;
btn.dispatch('click');
// 同步读一次：忙态是在第一个 await 之前切的，等 sleep 之后早收干净了，
// 「闪一下的创作中」只有这一刻看得见
const loadingRightAfterClick = loadingCount();
const btnRightAfterClick = { text: textOf(btn), disabled: !!btn.disabled };
await sleep(0);

eq('点下去的那一刻就没有 loading 遮罩', loadingRightAfterClick, 0);
eq('没有出现 loading 遮罩', loadingCount(), 0);
// 这条是「先判 requireApi 再切忙态」的顺序守卫：反过来的话用户会先看到
// 「创作中……」，然后卡在那儿不动（这条路径没有 finally 去还原）
eq('按钮没被切成「创作中……」', btnRightAfterClick.text, '生成剧情');
eq('按钮还是可点的', btnRightAfterClick.disabled, false);
eq('没有发请求', fetchCalls, 0);
eq('没有凭空多出一条创作', store.list('creations').length, creationsBefore);
const noApiBtn = btnByText(modalRoot(), '去设置');
ok('弹出了带「去设置」的窗口', !!noApiBtn);
ok('弹窗同时给得出「取消」', !!btnByText(modalRoot(), '取消'));
ok('弹窗里说清了缺什么', textOf(modalRoot()).includes('还没填 API Key'), textOf(modalRoot()));
noApiBtn.dispatch('click');
eq('点「去设置」直接跳到设置页', loc.hash, '#/settings/api');

console.log('\n== 连标题也没填时，先提示「请输入详细要求」而不是弹接口窗 ==');
clearModals();
const { btn: btnEmpty } = homePage('');
btnEmpty.dispatch('click');
await sleep(0);
eq('没有弹「去设置」', btnByText(modalRoot(), '去设置'), undefined);
eq('仍然没发请求', fetchCalls, 0);

console.log('\n== 配好了：按钮自己变「创作中……」，全程不盖全屏遮罩 ==');
store.patchSettings({ apiKey: 'sk-test', apiBase: 'https://api.openai.com/v1' });
clearModals();
fetchCalls = 0;
loadingAtFetch = -1;
busyAtFetch = null;
// 草稿里先留一份旧的，验证成功后确实被清掉
store.patchDraft({ title: '旧草稿标题', html: '旧草稿正文' });
holdFetch = true;
const home = homePage('写一段开篇', '长夜将明');
watchBtn = home.btn;
home.btn.dispatch('click');
const busyRightAfterClick = { text: textOf(home.btn), disabled: !!home.btn.disabled };
await sleep(0);

eq('点下去的那一刻按钮就写着「创作中……」', busyRightAfterClick.text, '创作中……');
eq('点下去的那一刻按钮就不可点', busyRightAfterClick.disabled, true);
eq('界面上没有全屏遮罩', loadingCount(), 0);
eq('发了一次请求', fetchCalls, 1);
ok('请求打到 /chat/completions', lastUrl.endsWith('/chat/completions'), lastUrl);
eq('发请求时界面依然没有遮罩（忙态顶在按钮上）', loadingAtFetch, 0);
eq('发请求时按钮正是忙态', busyAtFetch && busyAtFetch.text, '创作中……');
eq('发请求时按钮确实不可点', busyAtFetch && busyAtFetch.disabled, true);

holdFetch = false;
releaseFetch();
await sleep(0);

eq('完成后按钮文案还原成「生成剧情」', textOf(home.btn), '生成剧情');
eq('完成后按钮重新可点', home.btn.disabled, false);
eq('完成后输入框清空了', home.editor.childNodes.length, 0);
eq('完成后标题框也清空了', home.titleInput.value, '');
eq('草稿跟着清了（切页回来不会留着旧要求）', JSON.stringify(store.getState().draft), JSON.stringify({ title: '', html: '' }));
eq('创作条目 +1', store.list('creations').length, creationsBefore + 1);
eq('全程没有出现过 loading 遮罩', loadingCount(), 0);
const created = store.list('creations').slice(-1)[0];
eq('标题用输入框里的名字', created.title, '长夜将明');
eq('正文是接口返回的内容（已 trim）', created.content, '生成出来的正文');
eq('详细要求存下来了', created.request, '写一段开篇');

console.log('\n== 等待期间离开首页再回来：按钮接着是忙的 ==');
store.patchDraft({ title: '', html: '' });
fetchCalls = 0;
holdFetch = true;
const home2 = homePage('另一段要求', '第二篇');
watchBtn = home2.btn;
home2.btn.dispatch('click');
await sleep(0);
eq('等待中按钮是忙态', textOf(home2.btn), '创作中……');

// 模拟用户切走又切回首页：视图重新渲染，按钮是新节点，忙态得跟过去
const home3 = homePage('', '');
eq('重新渲染出来的按钮也是「创作中……」', textOf(home3.btn), '创作中……');
eq('新按钮同样不可点', home3.btn.disabled, true);
eq('等待期间没有多发出请求', fetchCalls, 1);

// 用户等得不耐烦，回来之后就着手写下一篇了 —— 这些字不能被回包冲掉
home3.editor.appendChild(document.createTextNode('等待时写的新要求'));
home3.titleInput.value = '新标题';
holdFetch = false;
releaseFetch();
await sleep(0);

eq('回包后按钮还原', textOf(home3.btn), '生成剧情');
eq('用户等待时写的正文没被清掉', home3.editor.childNodes.length, 1);
eq('用户等待时写的标题没被清掉', home3.titleInput.value, '新标题');
eq('这篇也落库了', store.list('creations').length, creationsBefore + 2);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
