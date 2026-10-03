/**
 * 真浏览器验证「收藏到书架」的命名，顺带出一张图。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-creation-book-chapter1.png（书的目录，第一章应显示「第1章」）
 *
 * 要真浏览器的理由：这条链路一头是 localStorage 里的真实存档（迁移逻辑要对真存档生效），
 * 一头是「点星标 → 弹确认框 → 点收藏 → 重渲染」的整条界面流程；
 * creationBook.test.mjs 用 DOM 替身跑通了，但替身没有真实事件与重渲染，验证不了这些。
 *
 * 两个必须做的前置动作：
 *   1) 先 unregister SW + 清 caches —— 同源资源 cache-first，不清会一直跑旧代码；
 *   2) 塞 localStorage 要在**导航之前**做完，且塞完必须重新导航/等 hashchange，
 *      否则页面里那份 state 还是旧的（load() 只在模块首次执行时跑一次）。
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
/** 按可见文字点按钮，找不到就返回 false（好过默默点错一个） */
const clickByText = (sel, text) => ev(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find((n) => n.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return false;
  el.click();
  return true;
})()`);

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

/* 一份「老版本收藏出来的书」：书名与第一章同名，正是当年那条写入路径留下的样子 */
const legacy = {
  books: [
    { id: 'b1', title: '旧书', intro: '当初的要求', createdAt: 1759300000000,
      chapters: [{ id: 'c1', title: '旧书', content: '第一章正文……', createdAt: 1759300000000 }] }
  ],
  creations: [
    { id: 'cr1', title: '星海归途', request: '要第一人称', content: '开篇正文……', createdAt: 1759300000000 }
  ]
};
await ev(`localStorage.setItem('somnus_state_v1', ${JSON.stringify(JSON.stringify(legacy))})`);
/* 必须是真 reload：只改 hash 的 Page.navigate 属于同文档导航，页面不会重新执行模块，
   塞进去的存档根本没被 load() 读到（第一次跑就栽在这，读到的是播种前那份空 state）。 */
await send('Page.reload', {});
await sleep(1500);

console.log('\n== 老存档：第一章与书名同名，进书架应已改回「第1章」==');
let books = await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).books`);
ok('书名不动', books[0].title === '旧书', JSON.stringify(books[0].title));
ok('第一章已改名为「第1章」', books[0].chapters[0].title === '第1章', JSON.stringify(books[0].chapters[0].title));
ok('正文没被动过', books[0].chapters[0].content === '第一章正文……', JSON.stringify(books[0].chapters[0].content));
ok('简介没被动过', books[0].intro === '当初的要求', JSON.stringify(books[0].intro));

console.log('\n== 书的目录：那一篇应显示「第1章」==');
await ev(`location.hash = '#/book/b1'`);
await sleep(700);
let rows = await ev(`[...document.querySelectorAll('.list .row-title')].map((n) => n.textContent.trim())`);
ok('目录里是「第1章」', rows[0] === '第1章', JSON.stringify(rows));
await shot('shot-creation-book-chapter1.png');

console.log('\n== 界面链路：创作详情点星标收藏 ==');
await ev(`location.hash = '#/creation/cr1'`);
await sleep(700);
ok('星标按钮在', await ev(`!!document.querySelector('.tb-right .tb-btn')`));
await ev(`document.querySelector('.tb-right .tb-btn').click()`);
await sleep(300);
ok('弹出确认框', await ev(`!!document.querySelector('#modal-root .modal-root')`));
ok('确认框里有「收藏」', await clickByText('#modal-root .btn', '收藏'));
await sleep(800);

books = await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).books`);
const saved = books.find((b) => b.title === '星海归途');
ok('书架里多了一本名为「星海归途」的书', !!saved, JSON.stringify(books.map((b) => b.title)));
ok('它的第一章叫「第1章」', saved && saved.chapters[0].title === '第1章', saved && saved.chapters[0].title);
ok('正文进了第一章', saved && saved.chapters[0].content === '开篇正文……', saved && saved.chapters[0].content);
ok('简介是创作时填的要求', saved && saved.intro === '要第一人称', saved && saved.intro);

const cr = await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).creations.find((c) => c.id === 'cr1')`);
ok('创作条目记下了 bookId', !!(cr && cr.bookId && saved && cr.bookId === saved.id), JSON.stringify(cr && cr.bookId));

console.log('\n== 书架列表：显示的是书名 ==');
await ev(`location.hash = '#/shelf'`);
await sleep(700);
const shelf = await ev(`[...document.querySelectorAll('.card .list .row-title')].map((n) => n.textContent.trim())`);
ok('书架里能看到「星海归途」', shelf.includes('星海归途'), JSON.stringify(shelf));
ok('书架里没有叫「第1章」的书', !shelf.includes('第1章'), JSON.stringify(shelf));

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
