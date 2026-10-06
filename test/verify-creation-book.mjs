/**
 * 真浏览器验证「收藏到书架」的命名，顺带出一张图。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-creation-book-chapter1.png（书的目录，第一章应显示「第1章」）、
 *      shot-creation-book-delete-confirm.png（删创作的确认框，应写明书架那本会保留）、
 *      shot-creation-book-after-delete.png（删完创作后的书架，那本还应在）
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
/* 以前播种时得顺手把 ui.lastSeenUpdate 写成最新那条更新，不然「更新说明」弹窗会先占住
   #modal-root（它只留「已阅」一条出路），后面按文字找按钮可能找错弹窗。
   应用已经不再自动弹任何东西了，这段播种跟着撤掉。 */

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

/*
 * 星标的「实心 / 空心」只能认 fill 属性：svg() 给每颗图标都写了 stroke="currentColor"，
 * 拿 innerHTML.includes('currentColor') 当判据的话空心实心都会判成真（踩过）。
 */
const starFill = () => ev(`document.querySelector('.tb-right .tb-btn svg').getAttribute('fill')`);
/** 首页那条创作右侧的书签图标（表示「已收藏到书架」）在不在 */
const homeBookmark = () => ev(`!!document.querySelector('#view .card .list .row .row-ico')`);
/** 走完整的书架删除流程：进多选 → 选中第一本 → 删除 → 确认 */
const deleteFirstBook = async () => {
  await ev(`document.querySelector('.tb-right .tb-btn').click()`);
  await sleep(300);
  await ev(`document.querySelector('#view .card .list .row').click()`);
  await sleep(300);
  await ev(`document.querySelector('.tb-right .tb-btn.danger').click()`);
  await sleep(300);
  await clickByText('#modal-root .btn', '删除');
  await sleep(700);
};

console.log('\n== 书架里删书，首页那条创作的「已收藏」图标要跟着消失 ==');
await ev(`location.hash = '#/home'`);
await sleep(700);
ok('收藏后首页挂着书签图标', await homeBookmark());
await ev(`location.hash = '#/shelf'`);
await sleep(700);
await deleteFirstBook();
/* 存档里还播着一本老书「旧书」（上面验迁移用），所以一律按书名找，别数总数 */
const bookTitles = () => ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).books.map((b) => b.title)`);
ok('书架里已经没这本书了', !(await bookTitles()).includes('星海归途'), JSON.stringify(await bookTitles()));
ok('创作的 bookId 也一并清掉了',
  (await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).creations.find((c) => c.id === 'cr1').bookId`)) === '');
await ev(`location.hash = '#/home'`);
await sleep(700);
ok('首页的书签图标消失了（以前会一直挂着）', !(await homeBookmark()));

console.log('\n== 详情：取消收藏真的把书删掉 ==');
await ev(`location.hash = '#/creation/cr1'`);
await sleep(700);
ok('删书后星标回到空心', (await starFill()) === 'none', await starFill());
await ev(`document.querySelector('.tb-right .tb-btn').click()`);
await sleep(300);
ok('点「收藏」重新加入书架', await clickByText('#modal-root .btn', '收藏'));
await sleep(800);
ok('书架上又有一本「星海归途」', (await bookTitles()).includes('星海归途'), JSON.stringify(await bookTitles()));
ok('星标变实心', (await starFill()) === 'currentColor', await starFill());

await ev(`document.querySelector('.tb-right .tb-btn').click()`);
await sleep(300);
const unfavBtns = await ev(`[...document.querySelectorAll('#modal-root .btn')].map((n) => n.textContent.trim())`);
ok('取消收藏的确认框是「再想想 / 取消收藏」，不会看混', unfavBtns.join('|') === '再想想|取消收藏', JSON.stringify(unfavBtns));
ok('点「取消收藏」', await clickByText('#modal-root .btn', '取消收藏'));
await sleep(800);
ok('书架里又没它了', !(await bookTitles()).includes('星海归途'), JSON.stringify(await bookTitles()));
ok('星标回到空心', (await starFill()) === 'none', await starFill());
await ev(`location.hash = '#/home'`);
await sleep(700);
ok('首页书签图标也没了', !(await homeBookmark()));

console.log('\n== 删除创作：只删创作，书架那本要留下 ==');
/*
 * 用户报的问题：收藏之后回首页把那条创作删掉，书架里那本会跟着一起没 ——
 * 于是首页的创作列表越堆越长，谁也不敢删。这条链路在 DOM 替身里跑通了，
 * 但真浏览器里走的是「点删除 → 弹确认框 → 重渲染 + 路由跳回首页」，得实测。
 */
await ev(`location.hash = '#/creation/cr1'`);
await sleep(700);
await ev(`document.querySelector('.tb-right .tb-btn').click()`);
await sleep(300);
ok('先把这条创作重新收藏起来', await clickByText('#modal-root .btn', '收藏'));
await sleep(900);
ok('书架上有「星海归途」了', (await bookTitles()).includes('星海归途'), JSON.stringify(await bookTitles()));

await ev(`document.querySelector('.tb-right .tb-btn.danger').click()`);
await sleep(300);
const delBtns = await ev(`[...document.querySelectorAll('#modal-root .btn')].map((n) => n.textContent.trim())`);
ok('删除确认框是「取消 / 删除」', delBtns.join('|') === '取消|删除', JSON.stringify(delBtns));
ok('确认框里交代了书架那本会保留', await ev(
  `(document.querySelector('#modal-root .alert-msg') || {}).textContent.includes('保留')`));
await shot('shot-creation-book-delete-confirm.png');
await clickByText('#modal-root .btn', '删除');
await sleep(900);

ok('首页那条创作没了', !(await ev(
  `JSON.parse(localStorage.getItem('somnus_state_v1')).creations.some((c) => c.id === 'cr1')`)));
ok('书架那本还在（以前会被一起删掉）', (await bookTitles()).includes('星海归途'), JSON.stringify(await bookTitles()));
await ev(`location.hash = '#/shelf'`);
await sleep(700);
const shelfAfter = await ev(`[...document.querySelectorAll('.card .list .row-title')].map((n) => n.textContent.trim())`);
ok('书架列表里还能看到「星海归途」', shelfAfter.includes('星海归途'), JSON.stringify(shelfAfter));
await shot('shot-creation-book-after-delete.png');

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
