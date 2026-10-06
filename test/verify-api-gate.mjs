/**
 * 真浏览器验证「没配 API 时点生成剧情，不会先进创作中」，顺带出一张图。
 *
 * 依赖：静态服务 8791 + CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-api-gate-no-api.png（那个「还没有可用的接口」弹窗）
 *
 * 为什么 DOM 替身那条 `apiGate.test.mjs` 不够：
 * 替身里 `.loading` 是同步读一次就下结论的，而这里用 MutationObserver 记**整段时间里
 * 有没有出现过** loading 遮罩 —— 真正的用户观感就是这个，闪一下也算出现过。
 * 同理「点『去设置』真的跳到设置页」要靠真实的 hash 路由，替身只验到按钮存在。
 *
 * > 「生成中」本身的行为（三处按钮变忙态、等待期间能去别的页面）另有专条：
 * > `verify-inline-busy.mjs`。这条只顺带确认忙态**取代**了全屏遮罩。
 *
 * 前置动作（和 verify-creation-book.mjs 一样，缺一不可）：
 *   1) 先 unregister SW + 清 caches —— 同源资源 cache-first，不清会一直跑旧代码；
 *   2) 塞 localStorage 要在导航之前，塞完必须真 reload（只改 hash 不重新执行模块）。
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

/* 一份「装着应用但什么 API 都没填」的存档：地址有默认值、Key 是空的，
   正是用户报这个 bug 时的状态。另外放一条老创作，用来数条目有没有凭空变多。

   `ui.lastSeenUpdate` 必须写成**当前最新那条更新的 id** —— 不然一打开应用，
   「更新说明」弹窗（dismissable:false、只留「已阅」一条出路）会先挂在 #modal-root 里。
   这条用例全程没换过 hash（本来就在 #/home），也就没有一次路由重置去关掉它，
   于是下面读 `.modal-body` 读到的是更新说明的正文，「说清了缺的是 Key」这条永远红。
   id 从 js/changelog.js 现取而不是写死，下次加更新条目不用回来改这里。 */
const { CHANGELOG } = await import('../js/changelog.js');
const seed = {
  settings: { apiBase: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', temperature: 0.9, maxTokens: 0 },
  ui: { lastSeenUpdate: CHANGELOG[0] && CHANGELOG[0].id },
  creations: [{ id: 'old1', title: '旧创作', request: '旧要求', content: '旧正文', createdAt: 1759300000000 }]
};
await ev(`localStorage.setItem('somnus_state_v1', ${JSON.stringify(JSON.stringify(seed))})`);
/* 必须真 reload：只改 hash 的导航属于同文档导航，模块不会重新执行，load() 读不到刚塞的存档 */
await send('Page.reload', {});
await sleep(1500);

/** 记下整段时间里 loading 遮罩出现过几次（不是某一刻有没有） */
const watchLoading = () => ev(`(() => {
  window.__loadingSeen = 0;
  if (window.__loadingObs) window.__loadingObs.disconnect();
  window.__loadingObs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('loading')) window.__loadingSeen++;
    }
  });
  window.__loadingObs.observe(document.getElementById('layer-root'), { childList: true });
  return 1;
})()`);

/** 在首页填好标题与正文，然后点「生成剧情」；返回**点完那一刻**按钮的状态 */
const createOnHome = () => ev(`(() => {
  location.hash = '#/home';
  return 1;
})()`).then(() => sleep(600)).then(() => ev(`(() => {
  const t = document.querySelector('input[placeholder="标题"]');
  const ed = document.querySelector('.editor');
  if (!t || !ed) return null;
  t.value = '星海归途';
  ed.textContent = '写一段开篇';
  const btn = [...document.querySelectorAll('#view .btn')].find((n) => n.textContent.trim() === '生成剧情');
  if (!btn) return null;
  btn.click();
  return { text: btn.textContent.trim(), disabled: !!btn.disabled };
})()`));

console.log('\n== 没配 API：点「生成剧情」不进创作中 ==');
await watchLoading();
ok('首页找得到标题框 / 输入框 / 生成按钮', await createOnHome());
await sleep(900);

ok('整段时间里没有出现过 loading 遮罩', (await ev(`window.__loadingSeen`)) === 0,
  'loadingSeen=' + await ev(`window.__loadingSeen`));
ok('弹出「还没有可用的接口」', await ev(`!!document.querySelector('#modal-root .modal-root')`));
ok('弹窗里有「去设置」', await ev(`[...document.querySelectorAll('#modal-root .btn')].some((n) => n.textContent.trim() === '去设置')`));
ok('弹窗没把「取消」漏掉', await ev(`[...document.querySelectorAll('#modal-root .btn')].some((n) => n.textContent.trim() === '取消')`));
ok('说清了缺的是 Key', await ev(`document.querySelector('#modal-root .modal-body').textContent.includes('还没填 API Key')`),
  await ev(`document.querySelector('#modal-root .modal-body').textContent`));
ok('没有凭空多出创作条目', (await state()).creations.length === 1);
await shot('shot-api-gate-no-api.png');

console.log('\n== 点「去设置」真的跳到设置页 ==');
await ev(`[...document.querySelectorAll('#modal-root .btn')].find((n) => n.textContent.trim() === '去设置').click()`);
await sleep(700);
ok('hash 跳到 #/settings/api', (await ev(`location.hash`)) === '#/settings/api', await ev(`location.hash`));
ok('弹窗关掉了', !(await ev(`!!document.querySelector('#modal-root .modal-root')`)));

console.log('\n== 填上 Key 之后，同一条路径照常走通（改成按钮忙态，不再盖全屏） ==');
const hashBefore = await ev(`(() => {
  const el = document.querySelector('#view input[type="password"]');
  if (!el) return 'nokeyfield';
  el.value = 'sk-verify';
  el.dispatchEvent(new Event('change'));
  return location.hash;
})()`);
ok('设置页有 API Key 输入框且已写入', hashBefore !== 'nokeyfield', hashBefore);
await sleep(400);
ok('Key 已经存进存档', (await state()).settings.apiKey === 'sk-verify');

// 真发一个请求会打到 api.openai.com，这里换成假的（同 verify-cloud-backup.mjs 的做法）
await ev(`(() => {
  window.fetch = async (url) => {
    window.__fetchUrl = String(url);
    return new Response(JSON.stringify({ model: 'fake', choices: [{ message: { content: '  测试正文  ' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return 1;
})()`);

await watchLoading();
const clicked = await createOnHome();
ok('回到首页并点了按钮', !!clicked);
await sleep(1200);

ok('发请求时打的是 /chat/completions', String(await ev(`window.__fetchUrl`)).endsWith('/chat/completions'),
  await ev(`window.__fetchUrl`));
ok('这次忙态出现在按钮上（文案变「创作中……」）', clicked && clicked.text === '创作中……', JSON.stringify(clicked));
ok('这次按钮不可点', clicked && clicked.disabled === true, JSON.stringify(clicked));
ok('这次整段时间里都没有全屏遮罩', (await ev(`window.__loadingSeen`)) === 0,
  'loadingSeen=' + await ev(`window.__loadingSeen`));
ok('没有漏下 loading 遮罩', !(await ev(`!!document.querySelector('.loading')`)));
const after = await state();
ok('创作条目 +1', after.creations.length === 2, JSON.stringify(after.creations.map((c) => c.title)));
const made = after.creations.find((c) => c.title === '星海归途');
ok('新创作正文是接口返回内容（已 trim）', made && made.content === '测试正文', made && made.content);

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
