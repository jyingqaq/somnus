/**
 * 真浏览器验证：首页输入框左上角加号展开后，**点功能图标不会把面板收回去**，
 * 只有再点那个 × 才收起。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-compose-open.png（展开态）/ shot-compose-closed.png（收起态）
 *
 * 为什么要真浏览器：这里验的是「点一下之后状态有没有被人改掉」，而功能图标点下去会连开
 * 底部面板 / 表单弹窗 —— 弹窗走 .modal-root（z-index 100），功能栏是 .cb-tools（z-index 3），
 * 展开后同屏共存会不会被遮住、点完还能不能接着点，只有真浏览器 + 真 CSS 说了算。
 *
 * 另一个坑：sw.js 对同源资源是 cache-first，改了 composeBox.js 后**不清 SW 会一直跑旧代码**，
 * 现象就是「明明改对了，验证还是 FAIL」。所以下面先 unregister + 清 caches 再重载，
 * 并且额外做一条源码守卫（直接读磁盘上的文件），把「代码对不对」和「浏览器拿到的是不是新代码」分开断言。
 */
import { WebSocket } from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9341';
const APP = 'http://127.0.0.1:8791/index.html';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

/* ---------- 源码守卫：功能图标不该再调 setOpen(false) ---------- */
{
  const src = fs.readFileSync(new URL('../js/components/composeBox.js', import.meta.url), 'utf8');
  const itemBlock = src.slice(src.indexOf('const items = h('), src.indexOf('/* ---- 右上角'));
  ok('功能图标区不再出现 setOpen(false)', !/setOpen\(\s*false\s*\)/.test(itemBlock),
    itemBlock.match(/setOpen\([^)]*\)/g)?.join(',') || '(无)');
  ok('功能图标仍是只跑 a.onClick()', /onClick:\s*\(\)\s*=>\s*a\.onClick\(\)/.test(itemBlock));
}

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
};

const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once('open', r));

let id = 0; const pend = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当前是否展开 */
const isOpen = () => ev(`!!document.querySelector('.cbox')?.classList.contains('open')`);
/** 左上角那个图标的 svg（plus / close 不一样，用它判断有没有变） */
const toggleIcon = () => ev(`document.querySelector('.cb-toggle .ico')?.innerHTML || ''`);
/** 点一个功能图标 */
const clickItem = async (title) => {
  const found = await ev(`(() => {
    const b = [...document.querySelectorAll('.cb-item')].find(x => x.title === ${JSON.stringify(title)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(430);
  return found;
};
/** 关掉最上面那层弹窗（底部面板点「关闭」，表单点「取消」） */
const closeModal = async (label) => {
  const r = await ev(`(() => {
    const roots = [...document.querySelectorAll('.modal-root')];
    const top = roots[roots.length - 1];
    if (!top) return 'no-modal';
    const btn = [...top.querySelectorAll('.modal-foot .btn')]
      .find(b => b.textContent === ${JSON.stringify(label)} && getComputedStyle(b).display !== 'none');
    if (btn) { btn.click(); return 'btn'; }
    const x = top.querySelector('.m-x');
    if (x) { x.click(); return 'm-x'; }
    return 'nothing';
  })()`);
  await sleep(380);
  return r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: APP });
await sleep(2000);

// 旧壳必须先清掉：SW 对同源资源 cache-first，会一直喂旧代码
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);

// 干净起点：不播种 composeOpen（走默认的收起），但**要播种角色/世界书**，
// 否则「角色」面板是空的（暂无内容），点不到行，也走不到「选中 → 插入 chip」这条真实路径。
await ev(`localStorage.setItem('somnus_state_v1', JSON.stringify({
  roles: [{ id: 'r1', title: '艾伦', detail: '主角' }],
  worlds: [{ id: 'w1', title: '北境', detail: '地理设定' }],
  ideas: [{ id: 'i1', title: '雨夜重逢', detail: '开场灵感' }]
}))`);
await send('Page.navigate', { url: APP });
await sleep(2200);

// 浏览器真的拿到了新代码？
const liveSrc = await ev(`fetch('js/components/composeBox.js').then(r => r.text())`);
ok('浏览器加载到的 composeBox.js 是新的（SW 没喂旧壳）',
  typeof liveSrc === 'string' && !/setOpen\(false\);\s*a\.onClick\(\)/.test(liveSrc));

await ev(`location.hash = '#/home'`);
await sleep(700);

/* ---------- 1. 起点：收起 ---------- */
ok('能拿到输入框', await ev(`!!document.querySelector('.cbox')`));
ok('功能栏默认收起', (await isOpen()) === false);
const iconClosed = await toggleIcon();
// 跟 icons.js 现算的 plus 比对，别用「字符串非空」这种永远成立的断言。
// 两个坑：
//   - Runtime.evaluate 里动态 import 不认相对写法，得先拼成绝对 URL；
//   - svg() 吐的是自闭合 `<path/>`，而 innerHTML 读回来会被序列化成 `<path></path>`，
//     所以要拿同一个 DOM 走一遍再比，否则比的是「序列化方式」而不是「图标」。
const svgInDom = (name) => ev(`import(new URL('js/util/icons.js', location.href).href).then(m => {
  const d = document.createElement('span');
  d.innerHTML = m.svg(${JSON.stringify(name)}, 20);
  return d.innerHTML;
})`);
const plusSvg = await svgInDom('plus');
const closeSvg = await svgInDom('close');
ok('收起时左上角就是 icons.js 的 plus', iconClosed === plusSvg, iconClosed.slice(0, 60));

/* ---------- 2. 展开，然后逐个点功能图标，都不该收回去 ---------- */
await ev(`document.querySelector('.cb-toggle').click()`);
await sleep(400);
ok('点加号后展开', (await isOpen()) === true);
const iconOpen = await toggleIcon();
ok('展开后左上角图标换成 icons.js 的 close（×）', iconOpen === closeSvg, iconOpen.slice(0, 60));

const cases = [
  ['角色', '关闭'],
  ['世界书', '关闭'],   // 用户报的就是这个：以前点完自己收回去
  ['灵感', '关闭'],
  ['载入', '关闭'],
  ['保存', '取消']      // 这个开的是表单弹窗，不是底部面板
];

for (const [label, closeLabel] of cases) {
  const clicked = await clickItem(label);
  ok(`找到并点到「${label}」`, clicked);

  const modalKind = await ev(`(() => {
    const roots = [...document.querySelectorAll('.modal-root')];
    const top = roots[roots.length - 1];
    if (!top) return 'none';
    return top.classList.contains('sheet') ? 'sheet' : 'modal';
  })()`);
  ok(`「${label}」弹出了面板/表单`, modalKind !== 'none', modalKind);
  ok(`点「${label}」之后面板仍展开`, (await isOpen()) === true);

  const how = await closeModal(closeLabel);
  ok(`「${label}」的面板关得掉`, how !== 'no-modal' && how !== 'nothing', how);
  ok(`关掉「${label}」的面板后面板仍展开`, (await isOpen()) === true);
}

/* ---------- 2b. 真实用法：选中一个角色 → 插入 chip → 面板还开着，能接着挑世界书 ---------- */
const chipCount = () => ev(`document.querySelectorAll('.cbox .chip').length`);
const chipText = () => ev(`[...document.querySelectorAll('.cbox .chip')].map(c => c.textContent).join('|')`);

const ok0 = await chipCount();
await clickItem('角色');
ok('「角色」面板列出了播种的角色', await ev(`[...document.querySelectorAll('.modal-root.sheet .row-title')].some(n => n.textContent === '艾伦')`));
// 点面板里那一行才会插 chip（row 的 onClick 里先 modal.close() 再 insertChip）
await ev(`[...document.querySelectorAll('.modal-root.sheet .row')].find(r => r.textContent.includes('艾伦')).click()`);
await sleep(450);
ok('挑中角色后 chip 真的插进输入框了', (await chipCount()) === ok0 + 1, await chipText());
ok('挑中角色后面板仍展开', (await isOpen()) === true);

await clickItem('世界书');
await ev(`[...document.querySelectorAll('.modal-root.sheet .row')].find(r => r.textContent.includes('北境')).click()`);
await sleep(450);
ok('接着挑世界书也能插进 chip（不用重新展开）', (await chipCount()) === ok0 + 2, await chipText());
ok('挑完两样面板仍然展开', (await isOpen()) === true);

// 展开态留一张图给肉眼比对（此时 chip 已插入、功能栏亮着）
await shot('shot-compose-open.png');

/* ---------- 3. 切页往返也不收起 ---------- */
await ev(`location.hash = '#/shelf'`);
await sleep(700);
await ev(`location.hash = '#/home'`);
await sleep(800);
ok('离开首页再回来仍是展开（只有 × 能收起）', (await isOpen()) === true);

/* ---------- 4. 全屏进出不影响展开状态 ---------- */
await ev(`document.querySelector('.cb-full').click()`);
await sleep(700);
ok('进了全屏，且仍是展开', (await ev(`!!document.querySelector('.fs-layer .cbox')`)) === true && (await isOpen()) === true);
await ev(`document.querySelector('.cb-full').click()`);
await sleep(700);
ok('退出全屏后仍是展开', (await isOpen()) === true);

/* ---------- 5. 只有 × 能收起 ---------- */
await ev(`document.querySelector('.cb-toggle').click()`);
await sleep(400);
ok('点 × 才收起', (await isOpen()) === false);
ok('收起后图标变回加号', (await toggleIcon()) === iconClosed);
await shot('shot-compose-closed.png');

// 收起状态下点空白 / 切页也不该自己展开
await ev(`document.querySelector('.editor')?.click()`);
await sleep(350);
ok('收起后点输入区不会自己弹开', (await isOpen()) === false);

/* ---------- 6. 可反复展开收起 ---------- */
await ev(`document.querySelector('.cb-toggle').click()`);
await sleep(400);
ok('再点加号又能展开', (await isOpen()) === true);
await clickItem('角色');
await closeModal('关闭');
ok('第二轮点「角色」仍然不收起来', (await isOpen()) === true);
await ev(`document.querySelector('.cb-toggle').click()`);
await sleep(300);
ok('再点 × 又能收起', (await isOpen()) === false);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
