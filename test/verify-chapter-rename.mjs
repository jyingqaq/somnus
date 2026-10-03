/**
 * 真浏览器验证「点章节名改名」，顺带出两张图。
 *
 * 依赖：静态服务 8777 + CDP 9333（与 verify-pwa.mjs 同一套，可以一起跑）
 *   python -m http.server 8777 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9333 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-chapter-title.png（标题下的虚线提示） / shot-chapter-rename.png（改名弹窗）
 *
 * 为什么非得真浏览器：这次的入口是「标题看着能点」这件事本身 ——
 * 虚线是画在 inline span 上的 border-bottom，DOM 替身里没有 CSS，
 * 断不了「虚线有没有真的贴在文字上、是不是把整格拉满」。所以这里真读 computed style。
 */
import { WebSocket } from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9333';
const APP = 'http://localhost:8777/index.html';

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
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);

await ev(`localStorage.setItem('somnus_state_v1', ${JSON.stringify(JSON.stringify({
  books: [{
    id: 'b1', title: '旧书', intro: '简介', createdAt: 1759300000000,
    chapters: [{ id: 'c1', title: '第1章', content: '第一章的正文。', createdAt: 1759300000000 }]
  }]
}))})`);
/* 只改 hash 的 Page.navigate 是同文档导航，模块不会重跑、读不到刚塞的存档 */
await send('Page.reload', {});
await sleep(1500);
await ev(`location.hash = '#/book/b1/chapter/c1'`);
await sleep(900);

console.log('\n== 章节页：标题可点 + 虚线提示 ==');
ok('标题带 .editable', await ev(`!!document.querySelector('.tb-title.editable')`));
ok('标题文字是章节名', await ev(`document.querySelector('.tb-label').textContent.trim()`) === '第1章');
const css = await ev(`(() => {
  const lab = document.querySelector('.tb-title.editable .tb-label');
  const cs = getComputedStyle(lab);
  const title = document.querySelector('.tb-title');
  const bar = document.querySelector('.topbar');
  return {
    style: cs.borderBottomStyle, width: cs.borderBottomWidth, color: cs.borderBottomColor,
    cursor: cs.cursor,
    labelW: Math.round(lab.getBoundingClientRect().width),
    titleW: Math.round(title.getBoundingClientRect().width),
    barW: Math.round(bar.getBoundingClientRect().width)
  };
})()`);
ok('虚线是 dashed', css.style === 'dashed', JSON.stringify(css));
ok('虚线 1px', css.width === '1px', css.width);
ok('虚线颜色取自 --dim（不是写死色值）', /rgb\(138, 138, 149\)|rgb\(139, 139, 151\)/.test(css.color), css.color);
ok('虚线只贴文字，没拉满整条顶栏', css.labelW < css.barW * 0.5, JSON.stringify(css));
ok('鼠标是 pointer', css.cursor === 'pointer', css.cursor);
await shot('shot-chapter-title.png');

console.log('\n== 点标题 → 弹改名框 ==');
await ev(`document.querySelector('.tb-title.editable').click()`);
await sleep(400);
ok('弹出表单', await ev(`!!document.querySelector('#modal-root .modal-card')`));
ok('标题写着「章节名」', await ev(`(document.querySelector('#modal-root .m-title')||{}).textContent`) === '章节名');
ok('输入框预填当前章节名', await ev(`document.querySelector('#modal-root input.field').value`) === '第1章');
await shot('shot-chapter-rename.png');

console.log('\n== 改成「楔子」并保存 ==');
await ev(`(() => {
  const inp = document.querySelector('#modal-root input.field');
  inp.value = '楔子';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
ok('「保存」已可用', await ev(`!document.querySelector('#modal-root .btn.primary').disabled`));
ok('点到了保存', await clickByText('#modal-root .btn', '保存'));
await sleep(700);
ok('弹窗已关闭', !(await ev(`!!document.querySelector('#modal-root .modal-card')`)));
ok('顶栏显示新名', await ev(`document.querySelector('.tb-label').textContent.trim()`) === '楔子');
ok('库里的章节名也改了',
  (await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).books[0].chapters[0].title`)) === '楔子');
ok('正文没被动过',
  (await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).books[0].chapters[0].content`)) === '第一章的正文。');
ok('正文还显示在页面上', (await ev(`document.querySelector('.reader').textContent.trim()`)) === '第一章的正文。');

console.log('\n== 回到书的目录，名字跟着变 ==');
await ev(`location.hash = '#/book/b1'`);
await sleep(700);
const rows = await ev(`[...document.querySelectorAll('.list .row-title')].map((n) => n.textContent.trim())`);
ok('目录里是「楔子」', rows[0] === '楔子', JSON.stringify(rows));

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
