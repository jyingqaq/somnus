/**
 * 真浏览器验证「更新提示」：打开应用自动弹出、点「已阅」后重开不再弹，顺带出两张图。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-update-notice.png（更新说明弹窗）/ shot-update-log.png（设置 → 更新日志）
 *
 * 为什么 DOM 替身那条 `updateNotice.test.mjs` 不够（替身里全都能过，真机上不一定）：
 *   1) 「打开应用就自动弹」这条链路要**真实的模块加载顺序** —— 弹窗是 app.js 里
 *      `setTimeout(showUpdateNoticeIfAny, 300)` 挂上去的，替身是自己手动调的，验不到。
 *   2) 「已阅之后重开不再弹」要**真的写进 localStorage 再真的重载**（只改 hash 不重跑模块）。
 *   3) 「没有 ×、点遮罩关不掉」在替身里只是「没挂监听器」，真机上还要确认那颗 ×
 *      真的没被 CSS 露出来、遮罩真的点不动 —— 这一条正是本项目踩过的
 *      「用 hidden 藏不住设了 display 的元素」的同类坑。
 *
 * 前置动作（缺一不可）：
 *   1) 先 unregister SW + 清 caches —— 同源资源 cache-first，不清会一直跑旧代码；
 *   2) 塞 localStorage 要在导航之前，塞完必须真 reload。
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
};
const state = () => ev(`JSON.parse(localStorage.getItem('somnus_state_v1') || '{}')`);
const hasModal = () => ev(`!!document.querySelector('#modal-root .modal-root')`);
const modalText = () => ev(`document.querySelector('#modal-root .modal-body').textContent`);
/** 存档里塞一个 ui.lastSeenUpdate 再真重载 */
const seedSeen = async (seen) => {
  await ev(`(() => {
    const k = 'somnus_state_v1';
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    s.ui = Object.assign({ composeOpen: false }, s.ui || {}, { lastSeenUpdate: ${JSON.stringify(seen)} });
    localStorage.setItem(k, JSON.stringify(s));
    return 1;
  })()`);
  await send('Page.reload', {});
  await sleep(1400);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: APP });
await sleep(1800);

// 旧壳必须先清掉：SW 对同源资源 cache-first，会一直喂旧代码
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);

// 从 js/changelog.js 现取最新那一条 —— 写死版本号的话，下次加了新更新这条用例就假红
const { CHANGELOG } = await import('../js/changelog.js');
const newest = CHANGELOG[0];
console.log(`\n== 打开应用：自动弹出没看过的更新（当前 ${newest.id}） ==`);

console.log('\n== 已经「已阅」过：不该弹 ==');
await seedSeen(newest.id);
ok('没有弹窗', !(await hasModal()));

console.log('\n== 从没看过：一打开就自己弹出来 ==');
await seedSeen('');
ok('弹窗自动出现（不用点任何东西）', await hasModal());
ok('标题是「更新说明」', (await ev(`document.querySelector('#modal-root .m-title').textContent`)) === '更新说明');
const bodyText = await modalText();
ok('正文里找得到标题', bodyText.includes(newest.title), bodyText);
ok('正文里逐条都在', newest.items.every((t) => bodyText.includes(t)), bodyText);
ok('带着日期', bodyText.includes(newest.date), bodyText);
ok('只有「已阅」这一颗按钮',
  (await ev(`document.querySelector('#modal-root .modal-foot').querySelectorAll('.btn').length`)) === 1
  && (await ev(`document.querySelector('#modal-root .modal-foot .btn').textContent.trim()`)) === '已阅');
// 真机上确认那颗 × 是真的不存在（不是被藏起来）
ok('没有右上角的 ×（真 DOM 里也查不到）',
  (await ev(`document.querySelectorAll('#modal-root .m-x').length`)) === 0);
// 点遮罩关不掉、也不算已阅：这就是「每次更新只弹一次」的前提
await ev(`document.querySelector('#modal-root .modal-backdrop').click()`);
await sleep(300);
ok('点遮罩关不掉', await hasModal());
ok('点遮罩也没写进「已阅」', ((await state()).ui || {}).lastSeenUpdate === '', JSON.stringify((await state()).ui));
ok('正文样式生效（更新列表用的是圆点列表，不是浏览器默认圆点）',
  (await ev(`getComputedStyle(document.querySelector('#modal-root .un-list')).listStyleType`)) === 'none',
  await ev(`getComputedStyle(document.querySelector('#modal-root .un-list')).listStyleType`));
await shot('shot-update-notice.png');

console.log('\n== 点「已阅」：关窗 + 记档 ==');
await ev(`document.querySelector('#modal-root .modal-foot .btn').click()`);
await sleep(400);
ok('弹窗关掉了', !(await hasModal()));
ok('记下了最新那一条的 id', ((await state()).ui || {}).lastSeenUpdate === newest.id,
  JSON.stringify((await state()).ui));

console.log('\n== 重开应用：不再弹 ==');
await send('Page.reload', {});
await sleep(1400);
ok('重开之后没有弹窗', !(await hasModal()));

console.log('\n== 设置里能回看（弹窗只弹一次，历史得有个地方翻） ==');
await ev(`location.hash = '#/settings'`);
await sleep(600);
ok('设置页有「更新日志」入口',
  (await ev(`document.querySelector('#view').textContent.includes('更新日志')`)) === true);
ok('入口副标题带出了最新那一版的日期与标题',
  (await ev(`document.querySelector('#view').textContent.includes(${JSON.stringify(newest.date)})`)) === true,
  await ev(`document.querySelector('#view').textContent`));

await ev(`location.hash = '#/settings/updates'`);
await sleep(700);
const logText = await ev(`document.querySelector('#view').textContent`);
ok('更新日志页列出了每一条', CHANGELOG.every((it) => logText.includes(it.title)), logText);
ok('每条的正文都在', CHANGELOG.every((it) => it.items.every((t) => logText.includes(t))), logText);
ok('只有最新那条带「最新」小标',
  (await ev(`document.querySelectorAll('#view .un-tag').length`)) === 1);
ok('「最新」小标就是最新那一条',
  (await ev(`document.querySelector('#view .un-tag').textContent.trim()`)) === '最新');
await shot('shot-update-log.png');

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
