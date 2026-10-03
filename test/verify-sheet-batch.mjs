/**
 * 真浏览器验证「载入预设 → 长按批量删除」，顺带出两张图给肉眼比对。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-sheet-batch-normal.png / shot-sheet-batch-select.png
 *
 * 为什么要真浏览器：这个交互有两条命门 DOM 替身看不见 ——
 *   1) 用 hidden 属性藏按钮。`.btn` 自己写了 display:inline-flex，作者样式压过 UA 的
 *      `[hidden]{display:none}`，光设属性在真机上三个按钮会一起亮着（sheetBatch.test.mjs 抓不到）；
 *   2) 长按走 pointer events，得让 Chrome 真合成一次 mousedown/mouseup。
 *
 * 两个时序坑（脚本里已就地注释）：
 *   - onLongPress 触发后会在 document 上挂一个「吞掉下一记 click」的一次性监听，最长驻留 400ms，
 *     紧跟其后的程序化 click 会被吞，所以这里等 500ms；
 *   - 长按会把行整批重建，按下时那个节点已脱离文档，mouseup 未必再合成 click，
 *     那个一次性监听就只能等超时自己撤，窗口内什么都点不动。
 */
import { WebSocket } from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9341';
const APP = 'http://127.0.0.1:8791/index.html';
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
};

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
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

// 塞几条预设，然后重新载入（deepMerge 会把它并进 DEFAULTS）
await ev(`localStorage.setItem('somnus_state_v1', JSON.stringify({ presets: [
  { id: 'p1', title: '预设一', fieldTitle: '标题一', html: '<p>一</p>', createdAt: 1759300000000 },
  { id: 'p2', title: '预设二', fieldTitle: '', html: '<p>二</p>', createdAt: 1759300000000 },
  { id: 'p3', title: '预设三', fieldTitle: '', html: '<p>三</p>', createdAt: 1759300000000 }
]}))`);

await send('Page.navigate', { url: APP });
await sleep(2500);
for (let i = 0; i < 10; i++) {
  if (await ev(`!!document.querySelector('.page')`)) break;
  await sleep(500);
}

/* ---------- 打开输入框的功能栏 → 载入 ---------- */
await ev(`location.hash = '#/home'`);
await sleep(600);
ok('输入框里有「载入」按钮', await ev(`!![...document.querySelectorAll('.cb-item')].find(b => b.title === '载入')`));
await ev(`(() => {
  const box = document.querySelector('.cbox');
  if (!box.classList.contains('open')) document.querySelector('.cb-toggle').click();
  return 1;
})()`);
await sleep(350);
await ev(`[...document.querySelectorAll('.cb-item')].find(b => b.title === '载入').click()`);
await sleep(450);

ok('弹出载入预设面板', await ev(`!!document.querySelector('.modal-root.sheet')`));
const rows = `[...document.querySelectorAll('.modal-root.sheet .row')]`;
ok('列出 3 条预设', await ev(`${rows}.length`) === 3);
ok('平时提示「长按可批量删除」可见', await ev(`(() => {
  const t = document.querySelector('.sheet-tip');
  return !!t && getComputedStyle(t).display !== 'none' && t.textContent.includes('长按');
})()`));
ok('平时底部只有「关闭」一个可见按钮', await ev(`(() => {
  const b = [...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')];
  const show = b.filter(x => getComputedStyle(x).display !== 'none');
  return b.length === 3 && show.length === 1 && show[0].textContent === '关闭';
})()`), await ev(`JSON.stringify([...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].map(b => [b.textContent, getComputedStyle(b).display]))`));

await shot('shot-sheet-batch-normal.png');

/* ---------- 长按（走真实鼠标事件，让 Chrome 合成 pointerdown） ---------- */
const at = await ev(`(() => {
  const r = document.querySelectorAll('.modal-root.sheet .row')[1].getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`);
const { x, y } = JSON.parse(at);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await sleep(600);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
// onLongPress 触发后会在 document 上挂一个「吞掉下一记 click」的一次性监听，
// 最长 400ms。这里要等过这个窗口，否则紧跟其后的程序化 click 会被吞掉。
await sleep(500);

ok('长按进入多选：标题变「已选 1」', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '已选 1');
ok('长按的那条被选中', await ev(`document.querySelectorAll('.modal-root.sheet .row')[1].classList.contains('picked')`));
ok('长按没顺手把预设载入进输入框', await ev(`document.querySelector('.cbox .editor')?.textContent?.trim() === ''`));
ok('多选时每行都有勾选圈', await ev(`document.querySelectorAll('.modal-root.sheet .row .pick').length`) === 3,
  await ev(`String(document.querySelectorAll('.modal-root.sheet .row .pick').length)`));
ok('勾选圈有描边（真渲染出来了，不是空壳）',
  parseFloat(await ev(`getComputedStyle(document.querySelector('.modal-root.sheet .row .pick')).borderTopWidth`)) > 0,
  await ev(`getComputedStyle(document.querySelector('.modal-root.sheet .row .pick')).borderTopWidth`));
ok('勾选圈是圆的', await ev(`getComputedStyle(document.querySelector('.modal-root.sheet .row .pick')).borderTopLeftRadius`) === '50%');
ok('选中的那条填成危险色', await ev(`(() => {
  const p = document.querySelectorAll('.modal-root.sheet .row')[1].querySelector('.pick');
  const cs = getComputedStyle(p);
  return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopColor === cs.backgroundColor;
})()`));
ok('多选时右箭头收起', await ev(`document.querySelectorAll('.modal-root.sheet .row .chev').length === 0`));
ok('多选时提示收起', await ev(`getComputedStyle(document.querySelector('.sheet-tip')).display === 'none'`));
ok('底部换成「取消 / 删除 1」', await ev(`(() => {
  const b = [...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')];
  const show = b.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent);
  return JSON.stringify(show);
})()`) === '["取消","删除 1"]');
ok('删除键是危险色', await ev(`getComputedStyle([...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].pop()).backgroundImage !== 'none' ||
  [...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].pop().className.includes('danger')`));

/* ---------- 点选第三条 ---------- */
await ev(`${rows}[2].click()`);
await sleep(200);
ok('再选一条 → 「已选 2」', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '已选 2');
ok('删除键数量跟到 2', await ev(`[...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].pop().textContent`) === '删除 2');
ok('选中的两条都标了', await ev(`(() => {
  const r = [...document.querySelectorAll('.modal-root.sheet .row')];
  return r[1].classList.contains('picked') && r[2].classList.contains('picked') && !r[0].classList.contains('picked');
})()`));

/* ---------- 取消选中 → 自动退出多选 ---------- */
await ev(`${rows}[2].click()`);
await sleep(120);
await ev(`${rows}[1].click()`);
await sleep(200);
ok('一条不剩自动退出多选', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '载入预设');
ok('退出后提示回来', await ev(`getComputedStyle(document.querySelector('.sheet-tip')).display !== 'none'`));

/* ---------- 再选两条，确认删除 ---------- */
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await sleep(600);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await sleep(500);   // 同上，等过吞 click 的窗口
ok('第二次长按同样进多选', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '已选 1');
await ev(`${rows}[2].click()`);
await sleep(200);
ok('凑够两条再删', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '已选 2');
await shot('shot-sheet-batch-select.png');
await ev(`[...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].pop().click()`);
await sleep(350);

ok('弹出确认框', await ev(`!!document.querySelector('.modal-root:not(.sheet)')`));
ok('确认框标题是「删除预设」', await ev(`document.querySelector('.modal-root:not(.sheet) .m-title').textContent`) === '删除预设');
ok('确认框写明共 2 个', await ev(`document.querySelector('.modal-root:not(.sheet) .alert-msg').textContent`) === '共 2 个');

// 先点取消，确认数据没动
await ev(`document.querySelectorAll('.modal-root:not(.sheet) .modal-foot .btn')[0].click()`);
await sleep(300);
ok('取消后预设还是 3 条', await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).presets.length`) === 3);
ok('取消后仍停在多选', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '已选 2');

// 再来一次，这次真删
await ev(`[...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')].pop().click()`);
await sleep(300);
ok('确认框还在（面板没被顶掉）', await ev(`!!document.querySelector('.modal-root:not(.sheet)')`));
await ev(`document.querySelectorAll('.modal-root:not(.sheet) .modal-foot .btn')[1].click()`);
await sleep(500);

ok('存档里只剩 1 条预设', await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).presets.length`) === 1);
ok('剩下的是没选中的那条', await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).presets[0].title`) === '预设一');
ok('面板不重开、就地少了一条', await ev(`${rows}.length`) === 2 - 1);
ok('删完回到普通态', await ev(`document.querySelector('.modal-root.sheet .m-title').textContent`) === '载入预设');
ok('删完底部只剩「关闭」', await ev(`(() => {
  const b = [...document.querySelectorAll('.modal-root.sheet .modal-foot .btn')];
  const show = b.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent);
  return JSON.stringify(show);
})()`) === '["关闭"]');
ok('删完提示重新出现', await ev(`getComputedStyle(document.querySelector('.sheet-tip')).display !== 'none'`));

/* ---------- 普通点击仍然是载入 ---------- */
await ev(`${rows}[0].click()`);
await sleep(400);
ok('点一下正常载入并关面板', await ev(`!document.querySelector('.modal-root.sheet')`));
ok('输入框里出现了该预设的标题', await ev(`document.querySelector('.cbox .editor')?.textContent?.includes('一')`));

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
