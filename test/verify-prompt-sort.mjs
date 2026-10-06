/**
 * 真浏览器验证：提示词块的「长按拖动排序」在手机（触摸）上真的拖得动。
 *
 * ── 为什么有这个用例 ─────────────────────────────────────────────
 * 电脑上一直正常，手机上却是「长按进了拖动，手指往上一移就动不了、那块自己弹回原位」。
 * 根因不在排序逻辑，而是浏览器把手势抢走了：
 *
 *   begin() 会把被拖的那一行 appendChild 到 document.body —— 它当场就不再是 .list 的
 *   后代。而当时拦滚动的 touchmove 恰恰挂在 .list 上，于是再也收不到事件；
 *   没人 preventDefault → 浏览器把这一移判成「滚动」接管 → 发 pointercancel
 *   → onUp() → finish() → 行被插回原位。表现就是「移一点就复原」。
 *
 * 这类问题 DOM 替身里连 touch-action / 手势仲裁都没有，测了也白测，只能在真浏览器里
 * 用真触摸事件跑（CDP Input.dispatchTouchEvent）。电脑上用鼠标永远碰不到，所以
 * 这个用例必须带触摸模拟。
 *
 * 依赖：静态服务 8791 + CDP 9341（和 verify-sheet-batch 等同一套端口，别同时跑两个）
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp about:blank
 * 产出：shot-prompt-sort-drag.png（拖动进行中，行浮在手指下、原位留着虚线占位）
 */
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9341';
const BASE = 'http://127.0.0.1:8791/index.html';
const APP = BASE + '#/prompt/create';
const SEED_N = 12;          // 块够多，页面才滚得动（滚动那条断言需要它）
const SHOT = (n) => fileURLToPath(new URL('./' + n, import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

/* ─────────── 源码守卫：先把「代码对不对」和「浏览器拿到的是不是新代码」分开 ─────────── */
{
  const src = fs.readFileSync(new URL('../js/components/sortable.js', import.meta.url), 'utf8');
  ok('拦滚动的 touchmove 挂在 window 上（原来挂 container，行一挪走就收不到）',
    /window\.addEventListener\(\s*'touchmove'/.test(src));
  ok('不再有挂在 container 上的 touchmove', !/container\.addEventListener\(\s*'touchmove'/.test(src),
    src.match(/container\.addEventListener\([^)]*\)/g)?.join(' | ') || '(无)');
  ok('这个监听是非 passive 的（passive 下 preventDefault 无效）',
    /addEventListener\(\s*'touchmove'[\s\S]{0,120}passive:\s*false/.test(src));
  ok('destroy() 用同一个 capture 旗标摘监听（否则摘不掉）',
    /removeEventListener\(\s*'touchmove'\s*,\s*onTouchMove\s*,\s*true\s*\)/.test(src));

  const css = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* ---- 长按拖动排序 ---- */'));
  ok('可排序的行关掉了文本选择 / iOS 长按放大镜',
    /\.sortable \.row\s*\{[^}]*user-select:\s*none[^}]*\}/.test(block) &&
    /-webkit-touch-callout:\s*none/.test(block),
    block.slice(0, 240).replace(/\s+/g, ' '));
}

/* ─────────────────────────── 起浏览器 ─────────────────────────── */
const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有可用的 page target，Chrome 起了吗？');
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
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
};

/* 手机视口 + 触摸。宽度必须小，否则一屏装得下 12 块，滚动那条就无从谈起 */
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });   // 只管 HTTP 缓存，管不到 SW
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: APP });
await sleep(1600);

// SW 是 cache-first，不清就会一直喂旧代码（本项目最贵的坑）
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);

/** 播种 N 个自定块（应用不再自动弹更新说明，不必再顺手按掉什么弹窗） */
const seed = async () => {
  await ev(`(() => {
    const k = 'somnus_state_v1';
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    s.prompt = s.prompt || {};
    s.prompt.create = {
      system: '',
      blocks: Array.from({ length: ${SEED_N} }, (_, i) => ({
        id: 'pbseed' + String(i).padStart(2, '0'),
        type: 'text',
        enabled: true,
        name: '块' + String(i + 1).padStart(2, '0'),
        text: '第 ' + (i + 1) + ' 块的内容，用来把页面撑长一点'
      }))
    };
    localStorage.setItem(k, JSON.stringify(s));
    return 1;
  })()`);
  // 播种后必须整页重载：只改 hash 是同文档导航，模块不重新执行，读到的还是旧存档
  await send('Page.navigate', { url: BASE + '?t=' + Date.now() + '#/prompt/create' });
  await sleep(1800);
};

const touch = (type, x, y) => send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }]
});
/** 第 i 行中心的坐标（拖动前取，拖动中这行已经不在列表里了） */
const rowGeo = (i) => ev(`(() => {
  const r = [...document.querySelectorAll('.pblock')][${i}].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
const isDragging = () => ev(`!!document.querySelector('.sort-drag')`);
const dragTop = () => ev(`(() => { const d = document.querySelector('.sort-drag'); return d ? Math.round(parseFloat(d.style.top)) : null })()`);
const scrollTop = () => ev(`Math.round(document.scrollingElement.scrollTop)`);
/** 存档里真实的块顺序 */
const stored = () => ev(`(JSON.parse(localStorage.getItem('somnus_state_v1')).prompt.create.blocks || []).map(b => b.id)`);
/** 数一段时间里 pointercancel / touchcancel 出现过几次（中途某一刻读一次会漏掉） */
const watchCancel = () => ev(`(() => {
  window.__pc = 0;
  if (!window.__pcBound) {
    window.__pcBound = 1;
    window.addEventListener('pointercancel', () => { window.__pc++; }, true);
    window.addEventListener('touchcancel', () => { window.__pc++; }, true);
  }
  return 1;
})()`);
const cancels = () => ev(`window.__pc`);
/** 拖动收尾必须把现场收干净，否则下次进页面还留着浮层 */
const leftovers = () => ev(`({
  drag: !!document.querySelector('.sort-drag'),
  ph: !!document.querySelector('.sort-ph'),
  lock: document.documentElement.classList.contains('sort-lock'),
  sorting: !!document.querySelector('.list.sorting')
})`);

await seed();
ok('页面够长、滚得动（滚动那条断言的前提）',
  (await ev(`document.scrollingElement.scrollHeight`)) > (await ev('innerHeight')),
  `scrollHeight=${await ev('document.scrollingElement.scrollHeight')} innerHeight=${await ev('innerHeight')}`);
ok('12 个块都在', (await ev(`document.querySelectorAll('.pblock').length`)) === SEED_N);
ok('可排序容器打上了 .sortable 标记', await ev(`!!document.querySelector('.list.sortable')`));

/* ─────────────────────────── 场景 1：普通滑动仍然只是滚动 ─────────────────────────── */
console.log('\n== 场景 1：在行上快速滑动 = 滚列表，不该误进拖动 ==');
await watchCancel();
{
  const before = await stored();
  const g = await rowGeo(4);
  const top0 = await scrollTop();
  await touch('touchStart', g.x, g.y);
  await sleep(20);
  await touch('touchMove', g.x, g.y - 40); await sleep(16);
  await touch('touchMove', g.x, g.y - 110); await sleep(16);
  await touch('touchMove', g.x, g.y - 190); await sleep(16);
  await touch('touchEnd');
  await sleep(500);

  const top1 = await scrollTop();
  ok('列表真的滚了', top1 > top0, `scrollTop ${top0} -> ${top1}`);
  ok('没有进入拖动状态', !(await isDragging()));
  // 注意：这里**故意不断言**「没有 pointercancel」—— 用手指滚动，浏览器接管手势、
  // 发 pointercancel 是正常且正确的（正是它让页面滚起来的）。这条链路只该关心
  // 「没被误判成拖动」。真正要断「零 pointercancel」的是拖动中那两段。
  ok('顺序没被改', JSON.stringify(await stored()) === JSON.stringify(before));
  ok('没留下拖动残迹', Object.values(await leftovers()).every((v) => v === false));
}

/* ─────────────────────────── 场景 2：长按拖动（这次的 bug 本体） ─────────────────────────── */
console.log('\n== 场景 2：长按进入拖动，移动时不该被指针取消 ==');
await ev(`document.scrollingElement.scrollTop = 0`);
await sleep(300);
await watchCancel();
{
  const before = await stored();
  const D = before[2];                    // 拖第 3 块往下走
  const g = await rowGeo(2);

  await touch('touchStart', g.x, g.y);
  await sleep(520);                       // 真等过 320ms 的阈值
  ok('长按进入拖动（.sort-drag 出现）', await isDragging());
  const t0 = await dragTop();

  await touch('touchMove', g.x, g.y + 18);
  await sleep(120);
  // ↓↓↓ 修复前就是这一步挂掉：浏览器发 pointercancel，finish() 把行插回原位
  ok('移动 18px 后仍在拖动（修复前这里已经 false）', await isDragging());
  const t1 = await dragTop();
  ok('浮起来的行跟着手指往下走了', t1 > t0, `top ${t0} -> ${t1}`);

  await touch('touchMove', g.x, g.y + 100); await sleep(100);
  ok('继续移动仍是拖动', await isDragging());
  await touch('touchMove', g.x, g.y + 170); await sleep(140);
  await shot(SHOT('shot-prompt-sort-drag.png'));
  ok('整个拖动过程一次 pointercancel 都没有', (await cancels()) === 0);

  await touch('touchEnd');
  await sleep(400);

  const after = await stored();
  const strip = (a) => a.filter((x) => x !== D);
  ok('松手后新的顺序真的写进了存档', JSON.stringify(after) !== JSON.stringify(before));
  ok('被拖的块确实往下挪了', after.indexOf(D) > before.indexOf(D),
    `${before.indexOf(D)} -> ${after.indexOf(D)}`);
  ok('它直接越过的那个邻居换到了它前面',
    after.indexOf(before[before.indexOf(D) + 1]) < after.indexOf(D));
  ok('其余各块的相对顺序没乱',
    JSON.stringify(strip(after)) === JSON.stringify(strip(before)));
  ok('DOM 顺序与存档一致',
    JSON.stringify(await ev(`[...document.querySelectorAll('.list > [data-sort-id]')].map(n => n.dataset.sortId)`))
      === JSON.stringify(after));
  ok('收尾把手势现场收拾干净了',
    Object.values(await leftovers()).every((v) => v === false),
    JSON.stringify(await leftovers()));
}

/* ───────────────── 场景 1b：起手很慢（头两下都在容差内）也要能滚起来 ───────────────── */
console.log('\n== 场景 1b：慢慢起手，仍要能把列表滚起来（修拖动不能把滚动弄坏） ==');
{
  const before = await stored();
  const g = await rowGeo(5);
  const top0 = await scrollTop();
  await touch('touchStart', g.x, g.y);
  await sleep(40);
  await touch('touchMove', g.x, g.y - 6);    // 容差内 → 被我们按住
  await sleep(40);
  await touch('touchMove', g.x, g.y - 9);    // 还在容差内 → 继续按住
  await sleep(40);
  await touch('touchMove', g.x, g.y - 70);   // 出容差 → 松手交给浏览器
  await sleep(16);
  await touch('touchMove', g.x, g.y - 150);
  await sleep(16);
  await touch('touchEnd');
  await sleep(500);

  ok('起手慢也照样滚起来了', (await scrollTop()) > top0, `scrollTop ${top0} -> ${await scrollTop()}`);
  ok('同样没有误进拖动', !(await isDragging()));
  ok('顺序没被改', JSON.stringify(await stored()) === JSON.stringify(before));
}

/* ───────── 场景 3：等待期里手指轻微抖动，不该把长按判死 ───────── */
console.log('\n== 场景 3：长按等待期里手指抖一下，仍要能进拖动 ==');
await ev(`document.scrollingElement.scrollTop = 0`);
await sleep(300);
await watchCancel();
{
  const before = await stored();
  const g = await rowGeo(0);

  await touch('touchStart', g.x, g.y);
  await sleep(140);
  await touch('touchMove', g.x, g.y + 5);    // 容差内的抖动
  await sleep(70);
  await touch('touchMove', g.x, g.y + 9);
  await sleep(60);

  // 实测记录：这两下抖动浏览器**一个 touchmove 都不派发**（没过它自己的手势门限），
  // 所以「长按还没到时长就被判成滚动」这条路不存在 —— 这里只把数量记下来，
  // 以后哪版 Chrome 改了行为、真的开始上报，会从日志里一眼看出来。
  console.log(`  （等待期里浏览器上报的 touchmove 条数：${await ev(`(window.__tm || []).length`)}）`);

  ok('抖动没有把指针判死', (await cancels()) === 0);
  await sleep(180);                          // 稳稳越过 320ms
  ok('抖过之后仍然进了拖动', await isDragging());

  await touch('touchMove', g.x, g.y + 90); await sleep(120);
  ok('抖过之后这一拖也是完整的（没被取消）', (await isDragging()) && (await cancels()) === 0);
  await touch('touchEnd');
  await sleep(400);
  const after = await stored();
  ok('这一拖也真的落库了', JSON.stringify(after) !== JSON.stringify(before));
  ok('收尾干净', Object.values(await leftovers()).every((v) => v === false));
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
ws.close();
process.exit(fail ? 1 : 0);
