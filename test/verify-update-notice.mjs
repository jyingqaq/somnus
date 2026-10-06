/**
 * 真浏览器验证「获取更新」页：打开应用不再弹任何东西，更新只能从设置里主动拿。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-update-latest.png（设置 → 获取更新，查到「已经是最新版本」）
 *（「发现新版本」那张由 verify-pwa-update.mjs 出，叫 shot-update-page.png）
 *
 * 为什么 DOM 替身那条 `updateNotice.test.mjs` 不够（替身里全都能过，真机上不一定）：
 *   1) 「打开应用不再自动弹」要**真实的模块加载顺序** —— 以前弹窗是 app.js 里
 *      `setTimeout(showUpdateNoticeIfAny, 300)` 挂上去的，替身是自己手动调的，验不到。
 *   2) 「已经是最新版本」这句要真的走一遍 `registration.update()` ——
 *      替身里没有 Service Worker，只能走到 unsupported 那一支。
 *   3) 真机上还要确认那颗「获取更新」按钮**真的点得到**（没被别的东西盖住）。
 *
 * 前置动作（缺一不可）：
 *   先 unregister SW + 清 caches —— 同源资源 cache-first，不清会一直跑旧代码。
 *   改完记得播种要在导航之前，塞完必须真 reload。
 *
 * 「有没有牙」实测：
 *   把 `js/app.js` 里那行 `setTimeout(showUpdateNoticeIfAny, 300)` 加回去 →
 *   第 1 段「打开应用一个弹窗都没有」立刻红。
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
/** 弹窗、提示条：这两样现在都该彻底不存在了 */
const hasModal = () => ev(`!!document.querySelector('#modal-root .modal-root')`);
const hasBar = () => ev(`!!document.querySelector('.update-bar')`);
const viewText = () => ev(`document.querySelector('#view').textContent`);

async function waitUntil(fn, ms = 10000, step = 250) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await sleep(step);
  }
}

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
  await sleep(1500);
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

// 从 js/changelog.js 现取，别写死版本号 —— 下次加了新更新这条用例就假红
const { CHANGELOG } = await import('../js/changelog.js');
const newest = CHANGELOG[0];
console.log(`\n== [1] 打开应用：一个弹窗、一条提示都不该有（当前 ${newest.id}） ==`);
await seedSeen('');
ok('没有「更新说明」弹窗', !(await hasModal()));
ok('没有底部提示条（那个组件已经删了）', !(await hasBar()));
await sleep(1200); // 老代码是 300ms 后才弹的，多等一会儿把「慢半拍」也盖住
ok('等一会儿也没有弹窗冒出来', !(await hasModal()));

console.log('\n== [2] 设置里有「获取更新」入口 ==');
await ev(`location.hash = '#/settings'`);
await sleep(700);
const sText = await viewText();
ok('设置页有「获取更新」', sText.includes('获取更新'), sText);
ok('入口副标题带出了最新那一版的日期与标题',
  sText.includes(newest.date) && sText.includes(newest.title), sText);
ok('设置页不再叫「更新日志」', !sText.includes('更新日志'), sText);

console.log('\n== [3] 进去就自动查一次：本地没新版，该说「已经是最新版本」 ==');
await ev(`location.hash = '#/settings/updates'`);
await sleep(700);
ok('有「获取更新」按钮', await ev(`!!document.querySelector('#view .up-get')`));
// 点得到点不到要真点一下才算数
const box = await ev(`(() => {
  const b = document.querySelector('#view .up-get');
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
const hit = await ev(`(() => {
  const el = document.elementFromPoint(${box.x}, ${box.y});
  return el && el.closest('.up-get') ? 'btn' : (el ? (el.className || el.tagName) : 'null');
})()`);
ok('按钮那一点上真摸得到它（没被别的东西盖住）', hit === 'btn', String(hit));

const settled = await waitUntil(async () => {
  const t = await ev(`(document.querySelector('#view .up-state') || {}).textContent || ''`);
  return t && !t.includes('正在检查') ? t : '';
}, 12000);
ok('查完给出的是「已经是最新版本」', settled.includes('已经是最新版本'), settled);
ok('没有新版本时不出现「立即更新」',
  !(await ev(`!!document.querySelector('#view .up-go')`)));

const logText = await viewText();
ok('日志页列出了每一条', CHANGELOG.every((it) => logText.includes(it.title)), logText);
ok('每条的正文都在', CHANGELOG.every((it) => it.items.every((t) => logText.includes(t))), logText);
ok('只有最新那条带「最新」小标',
  (await ev(`document.querySelectorAll('#view .un-tag').length`)) === 1);
ok('「最新」小标就是最新那一条',
  (await ev(`document.querySelector('#view .un-tag').textContent.trim()`)) === '最新');
await shot('shot-update-latest.png');

console.log('\n== [4] 没看过的老条目要标「新」，看过就不再标 ==');
await seedSeen(CHANGELOG[2] ? CHANGELOG[2].id : '');
await ev(`location.hash = '#/settings/updates'`);
await sleep(700);
const newTags = await ev(`[...document.querySelectorAll('#view .un-tag')].map(e => e.textContent.trim())`);
ok('没看过的那条标了「新」', newTags.includes('新'), JSON.stringify(newTags));
ok('「新」只标一条（最新那条让给「最新」）',
  newTags.filter((t) => t === '新').length === 1, JSON.stringify(newTags));
ok('记档写的是最新那条', ((await state()).ui || {}).lastSeenUpdate === newest.id,
  JSON.stringify((await state()).ui));

// 切走再回来：已经记过档了，不该再标
await ev(`location.hash = '#/settings'`);
await sleep(500);
await ev(`location.hash = '#/settings/updates'`);
await sleep(700);
const again = await ev(`[...document.querySelectorAll('#view .un-tag')].map(e => e.textContent.trim())`);
ok('再进一次就不标「新」了', !again.includes('新'), JSON.stringify(again));
ok('「最新」还在', again.includes('最新'), JSON.stringify(again));

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
