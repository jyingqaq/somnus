/**
 * 真浏览器验证「点一下就要调 AI」的三处入口，等待态都是**按钮自己的忙态**，
 * 不再弹全屏等待界面 —— 等待期间用户可以去别的页面干别的。
 *
 *   首页「生成剧情」 → 按钮变不可点的「创作中……」
 *   书籍「续写」     → 按钮变不可点的「创作中……」
 *   章节「获取评论」 → 按钮变不可点的「生成中」
 *
 * 依赖：静态服务 8791 + CDP 9341（和 verify-api-gate.mjs 同一套）
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-create-busy.png / shot-create-busy-done.png（首页等待中 / 完成）
 *       shot-continue-busy.png（书籍续写等待中）
 *       shot-comment-busy.png（章节获取评论等待中）
 *
 * 为什么 DOM 替身那条 `apiGate.test.mjs` 不够：
 * - 替身里没有 CSS。「按钮真的点不动」「`.is-busy` 的圈真的转起来了」
 *   「忙态的淡度确实压过了 `[disabled]`」「忙态把原来那颗图标藏了」只有真浏览器能验；
 * - 「等待期间去别的页面」是这条改动的**目的本身**，得靠真实的 hash 路由：
 *   三处都中途切走、再切回原页，断言按钮**仍然是忙的**（视图重渲染后忙态没丢）。
 *
 * 前置动作（同 verify-api-gate.mjs，缺一不可）：
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
/** 轮询等一个条件成立（别用固定 sleep 赌时序：截图之类的一拖就超过了请求的往返时间） */
const waitFor = async (fn, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
};
const state = () => ev(`JSON.parse(localStorage.getItem('somnus_state_v1') || '{}')`);
/** 页面上现在挂着几个全屏 loading 遮罩 */
const loadingCount = () => ev(`document.querySelectorAll('#layer-root .loading').length`);
/** 走真实的 hash 路由 */
const goto = async (hash, ms = 700) => {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(ms);
};

/**
 * 按**选择器**读一颗按钮的忙态全貌。
 * 不能按文字找：忙态时文案已经换成「创作中…… / 生成中」了。
 */
const busy = (sel) => ev(`(() => {
  const b = document.querySelector('#view ${sel}');
  if (!b) return null;
  const ico = b.querySelector('.ico');
  return {
    text: b.textContent.trim(),
    disabled: !!b.disabled,
    busyClass: b.classList.contains('is-busy'),
    opacity: getComputedStyle(b).opacity,
    spin: getComputedStyle(b, '::before').content,
    anim: getComputedStyle(b, '::before').animationName,
    icoShown: !!ico && getComputedStyle(ico).display !== 'none'
  };
})()`);

/**
 * 读忙态按钮的**稳定**淡度。
 * `.btn` 上挂着 `transition: transform .12s, opacity .12s`，点下去那一瞬间读会拿到
 * 过渡中间值（实测读到过 `0.620158`），所以先把过渡等过去再读。
 */
const settledOpacity = async (sel, ms = 220) => {
  await sleep(ms);
  return (await busy(sel))?.opacity;
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

// 接口配好了（这条用例只关心忙态，不关心没配好的拦截）；另备一本书 + 一章给续写 / 评论用
const seed = {
  settings: { apiBase: 'https://api.openai.com/v1', apiKey: 'sk-verify', model: 'gpt-4o-mini', temperature: 0.9, maxTokens: 0 },
  creations: [],
  draft: { title: '', html: '' },
  books: [{
    id: 'b1',
    title: '星海归途',
    intro: '',
    createdAt: 1759300000000,
    chapters: [{ id: 'c1', title: '第1章', content: '他推开门，风灌了进来。', createdAt: 1759300000000, comments: [] }]
  }]
};
await ev(`localStorage.setItem('somnus_state_v1', ${JSON.stringify(JSON.stringify(seed))})`);
/* 必须真 reload：只改 hash 的导航属于同文档导航，模块不会重新执行，load() 读不到刚塞的存档 */
await send('Page.reload', {});
await sleep(1500);

/* 慢一点的假 fetch：好在「请求还没回来」的中间态里做断言。
   必须返回真的 Response —— ai.js 读的是 res.ok / res.json()。
   延迟给到 4 秒是有意的：中途要切页、截图、再切回来，慢一点才不会让请求提前跑完
   （第一版只给 1.4 秒，结果「切回原页」时请求早就回来了，白红两条）。
   返回内容按小节换：正文用纯文本，评论用解析器认的 JSON。 */
await ev(`(() => {
  window.__fetchCalls = 0;
  window.__fetchUrl = '';
  window.__reply = '';
  window.__delay = 4000;
  window.fetch = (url) => {
    window.__fetchCalls++;
    window.__fetchUrl = String(url);
    return new Promise((resolve) => setTimeout(() => resolve(new Response(
      JSON.stringify({ model: 'fake', choices: [{ message: { content: window.__reply } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )), window.__delay));
  };
  return 1;
})()`);

/** 记下整段时间里 loading 遮罩出现过几次（不是某一刻有没有） */
await ev(`(() => {
  window.__loadingSeen = 0;
  window.__loadingObs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('loading')) window.__loadingSeen++;
    }
  });
  window.__loadingObs.observe(document.getElementById('layer-root'), { childList: true });
  return 1;
})()`);

/* ==================== 1) 首页「生成剧情」 ==================== */

console.log('\n== 首页：点「生成剧情」按钮自己变「创作中……」，不弹全屏等待界面 ==');
await ev(`window.__reply = '  测试正文  '`);
await goto('#/home', 600);
const clicked = await ev(`(() => {
  const t = document.querySelector('input[placeholder="标题"]');
  const ed = document.querySelector('.editor');
  if (!t || !ed) return 'nofield';
  t.value = '星海归途';
  ed.textContent = '写一段开篇';
  const b = document.querySelector('#view .btn.primary');
  if (!b) return 'nobtn';
  b.click();
  return {
    text: b.textContent.trim(),
    disabled: !!b.disabled,
    loading: document.querySelectorAll('#layer-root .loading').length
  };
})()`);
ok('首页找得到标题框 / 输入框 / 生成按钮', typeof clicked === 'object' && clicked !== null, String(clicked));
ok('点下去按钮当场就写着「创作中……」', clicked && clicked.text === '创作中……', clicked && clicked.text);
ok('点下去按钮当场就不可点', clicked && clicked.disabled === true, JSON.stringify(clicked));
ok('点下去的那一刻没有全屏遮罩', clicked && clicked.loading === 0, JSON.stringify(clicked));

// 再点一次：disabled 的按钮不该有任何反应
await ev(`document.querySelector('#view .btn.primary').click()`);
await sleep(120);
const mid = await busy('.btn.primary');
ok('等待中按钮文案是「创作中……」', mid.text === '创作中……', mid.text);
ok('等待中按钮挂着 .is-busy', mid.busyClass === true, JSON.stringify(mid));
ok('等待中按钮真的点不动（再点一次没有第二个请求）', (await ev(`window.__fetchCalls`)) === 1,
  'fetchCalls=' + await ev(`window.__fetchCalls`));
ok('请求打的是 /chat/completions', String(await ev(`window.__fetchUrl`)).endsWith('/chat/completions'));
// 忙态的淡度必须压过 .btn[disabled] 的 .45（两者权重相同，靠书写顺序取胜）
const midOp = await settledOpacity('.btn.primary');
ok('忙态的淡度是 .62 而不是禁用态的 .45', Math.abs(Number(midOp) - 0.62) < 0.01, midOp);
ok('按钮里真的有个转圈的 ::before', mid.spin !== 'none' && mid.spin !== '', mid.spin);
ok('转圈动画挂上了', mid.anim === 'rot', mid.anim);
await shot('shot-create-busy.png');

await goto('#/me');
ok('等待期间切到了「我的」页', (await ev(`location.hash`)) === '#/me');
ok('「我的」页真的渲染出来了', (await ev(`document.getElementById('view').children.length`)) > 0);
ok('切页时没被遮罩挡住', (await loadingCount()) === 0);
const still = await ev(`window.__fetchCalls`);
await sleep(200);
ok('用户去了别的页面，请求照样在跑（没有被切断）', (await ev(`window.__fetchCalls`)) === still);

await goto('#/home');
const backHome = await busy('.btn.primary');
ok('切回首页按钮还是「创作中……」', backHome && backHome.text === '创作中……', backHome && backHome.text);
ok('切回首页按钮还是不可点', backHome && backHome.disabled === true, JSON.stringify(backHome));
ok('切回首页也没冒出全屏遮罩', (await loadingCount()) === 0);

const homeSettled = await waitFor(async () => {
  const b = await busy('.btn.primary');
  return b && b.disabled === false;
});
ok('首页：请求回来后按钮重新可点', homeSettled);
const homeDone = await busy('.btn.primary');
ok('首页：文案还原成「生成剧情」', homeDone.text === '生成剧情', homeDone.text);
ok('首页：忙态 class 摘掉了', homeDone.busyClass === false, JSON.stringify(homeDone));
const afterHome = await state();
ok('首页：创作条目 +1', afterHome.creations.length === 1, JSON.stringify(afterHome.creations.map((c) => c.title)));
ok('首页：正文是接口返回内容（已 trim）', afterHome.creations[0] && afterHome.creations[0].content === '测试正文',
  afterHome.creations[0] && afterHome.creations[0].content);
ok('首页：弹出了「创作完成」', await ev(`document.querySelector('#modal-root .modal-body').textContent.includes('星海归途')`),
  await ev(`document.querySelector('#modal-root .modal-body').textContent`));
await shot('shot-create-busy-done.png');
ok('首页：全程没出现过全屏遮罩', (await ev(`window.__loadingSeen`)) === 0, 'loadingSeen=' + await ev(`window.__loadingSeen`));

/* ==================== 2) 书籍「续写」 ==================== */

console.log('\n== 书籍：点「续写」按钮自己变「创作中……」，等待期间还能去别的页面 ==');
await ev(`window.__reply = '  第二章正文  '`);
await ev(`window.__fetchCalls = 0`);
await goto('#/book/b1');
const opened = await ev(`(() => {
  const b = [...document.querySelectorAll('#view .btn')].find((n) => n.textContent.trim() === '续写');
  if (!b) return false;
  b.click();
  return true;
})()`);
ok('书页找得到「续写」按钮并点开了表单', opened === true);
await sleep(400);
const submitted = await ev(`(() => {
  const t = document.querySelector('#modal-root textarea.field-area');
  if (!t) return 'noform';
  t.value = '让他回家';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  const go = [...document.querySelectorAll('#modal-root .modal-foot .btn')].find((n) => n.textContent.trim() === '开始创作');
  if (!go) return 'nosubmit';
  if (go.disabled) return 'submit-disabled';
  go.click();
  return true;
})()`);
ok('填了剧情走向就能提交，提交按钮没被禁用', submitted === true, String(submitted));
await sleep(150);

const contMid = await busy('.btn.primary');
ok('提交后按钮变成「创作中……」', contMid && contMid.text === '创作中……', contMid && contMid.text);
ok('提交后按钮不可点', contMid && contMid.disabled === true, JSON.stringify(contMid));
const contOp = await settledOpacity('.btn.primary');
ok('续写的忙态也是 .62 的淡度（压过 .btn[disabled] 的 .45）', Math.abs(Number(contOp) - 0.62) < 0.01, contOp);
ok('续写按钮本来那颗 spark 图标被藏掉了', contMid.icoShown === false, JSON.stringify(contMid));
ok('续写时没有全屏遮罩', (await loadingCount()) === 0);
await shot('shot-continue-busy.png');

// 等待期间离开这本书，再回来
await goto('#/shelf');
ok('等待期间切到了书架', (await ev(`location.hash`)) === '#/shelf');
ok('书架真的渲染出来了', (await ev(`document.getElementById('view').children.length`)) > 0);
await goto('#/book/b1');
const contBack = await busy('.btn.primary');
ok('切回书页按钮还是「创作中……」', contBack && contBack.text === '创作中……', contBack && contBack.text);
ok('切回书页按钮还是不可点', contBack && contBack.disabled === true, JSON.stringify(contBack));
ok('切回书页也没冒出全屏遮罩', (await loadingCount()) === 0);

const contSettled = await waitFor(async () => {
  const b = await busy('.btn.primary');
  return b && b.disabled === false;
});
ok('续写：请求回来后按钮重新可点', contSettled);
const contDone = await busy('.btn.primary');
ok('续写：文案还原成「续写」', contDone.text === '续写', contDone.text);
ok('续写：spark 图标回来了', contDone.icoShown === true, JSON.stringify(contDone));
const afterBook = await state();
const chapters = afterBook.books[0].chapters;
ok('续写：章节从 1 章变成 2 章', chapters.length === 2, JSON.stringify(chapters.map((c) => c.title)));
ok('续写：新章节名是「第2章」', chapters[1] && chapters[1].title === '第2章', chapters[1] && chapters[1].title);
ok('续写：新章节正文是接口返回内容（已 trim）', chapters[1] && chapters[1].content === '第二章正文',
  chapters[1] && chapters[1].content);
ok('续写：目录里也跟着多了一行', (await ev(`document.querySelectorAll('#view .row').length`)) === 2,
  String(await ev(`document.querySelectorAll('#view .row').length`)));
ok('续写：全程没出现过全屏遮罩', (await ev(`window.__loadingSeen`)) === 0, 'loadingSeen=' + await ev(`window.__loadingSeen`));

/* ==================== 3) 章节「获取评论」 ==================== */

console.log('\n== 章节：点「获取评论」按钮自己变「生成中」，等待期间还能去别的页面 ==');
await ev(`window.__reply = ${JSON.stringify('[{"name":"小鱼","text":"好看，等下一章"}]')}`);
await goto('#/book/b1/chapter/c1');
const cmOpened = await ev(`(() => {
  const b = document.querySelector('#view .cm-get');
  if (!b) return false;
  b.click();
  return true;
})()`);
ok('章节页找得到「获取评论」按钮', cmOpened === true);
await sleep(200);

const cmMid = await busy('.cm-get');
ok('点下去按钮变成「生成中」', cmMid && cmMid.text === '生成中', cmMid && cmMid.text);
ok('点下去按钮不可点', cmMid && cmMid.disabled === true, JSON.stringify(cmMid));
ok('获取评论的忙态也挂着 .is-busy', cmMid && cmMid.busyClass === true, JSON.stringify(cmMid));
ok('获取评论按钮本来那颗 spark 图标被藏掉了', cmMid && cmMid.icoShown === false, JSON.stringify(cmMid));
ok('获取评论时没有全屏遮罩', (await loadingCount()) === 0);
ok('空列表处写着「正在生成评论…」',
  await ev(`(document.querySelector('#view .cm-empty') || {}).textContent === '正在生成评论…'`),
  await ev(`(document.querySelector('#view .cm-empty') || {}).textContent`));
await shot('shot-comment-busy.png');

await goto('#/shelf');
await goto('#/book/b1/chapter/c1');
const cmBack = await busy('.cm-get');
ok('切回章节页按钮还是「生成中」', cmBack && cmBack.text === '生成中', cmBack && cmBack.text);
ok('切回章节页按钮还是不可点', cmBack && cmBack.disabled === true, JSON.stringify(cmBack));
ok('切回章节页也没冒出全屏遮罩', (await loadingCount()) === 0);

const cmSettled = await waitFor(async () => {
  const b = await busy('.cm-get');
  return b && b.disabled === false;
});
ok('获取评论：请求回来后按钮重新可点', cmSettled);
const cmDone = await busy('.cm-get');
ok('获取评论：文案还原成「获取评论」', cmDone.text === '获取评论', cmDone.text);
ok('获取评论：spark 图标回来了', cmDone.icoShown === true, JSON.stringify(cmDone));
const afterCm = await state();
const comments = afterCm.books[0].chapters[0].comments;
ok('获取评论：落了 1 条评论', comments.length === 1, JSON.stringify(comments.map((c) => c.name)));
ok('获取评论：昵称对得上', comments[0] && comments[0].name === '小鱼', comments[0] && comments[0].name);
ok('获取评论：列表里也渲染出来了',
  await ev(`(document.querySelector('#view .cm-item') || {}).textContent.includes('好看，等下一章')`),
  await ev(`(document.querySelector('#view .cm-item') || {}).textContent`));
ok('获取评论：全程没出现过全屏遮罩', (await ev(`window.__loadingSeen`)) === 0, 'loadingSeen=' + await ev(`window.__loadingSeen`));

console.log(`\n${pass} passed, ${fail} failed\n`);
ws.close();
process.exit(fail ? 1 : 0);
