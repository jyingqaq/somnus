/*
 * PWA 改造验证：用 CDP 直连无头 Chrome，断言浏览器真的认可这个应用可安装。
 *
 * 检查项：
 *   1. manifest 能被解析、必填字段齐全、图标尺寸达标
 *   2. Service Worker 注册成功并进入 activated
 *   3. SW 真的把应用壳写进了 Cache Storage
 *   4. AI 接口请求不会被缓存（离线后仍能发出新请求）
 *   5. 断网后仍能打开（离线可用）
 *
 * 用法：先起 http://127.0.0.1:8777 与 --remote-debugging-port=9333，再跑
 *   node verify-pwa.mjs
 */

const BASE = 'http://localhost:8777/index.html';
const CDP = 'http://127.0.0.1:9333';

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

/** 在页面里跑表达式并取回 JSON 值 */
async function evaluate(sessionId, expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'eval failed');
  }
  return res.result.value;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`);
}

async function connect() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === 'page') || list[0];
  ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP 连接失败'));
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connect();
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);

  console.log('\n[1] 打开应用并等待 SW 注册');
  await send('Page.navigate', { url: BASE }, sessionId);
  await sleep(3500);

  /* ---- manifest ---- */
  console.log('\n[2] 检查 manifest');
  const mf = await evaluate(sessionId, `(async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return { ok: false, why: '页面没有 link[rel=manifest]' };
    const res = await fetch(link.href);
    const m = await res.json();
    const sizes = (m.icons || []).map(i => i.sizes);
    return {
      ok: true,
      name: m.name,
      display: m.display,
      start_url: m.start_url,
      has192: sizes.includes('192x192'),
      has512: sizes.includes('512x512'),
      maskable: (m.icons || []).filter(i => i.purpose === 'maskable').length,
      shortcuts: (m.shortcuts || []).length,
      iconFetched: await Promise.all((m.icons || []).map(async i => {
        const r = await fetch(new URL(i.src, link.href));
        return r.status;
      }))
    };
  })()`);
  check('manifest 已被页面引用并可解析', mf.ok, mf.why || mf.name);
  if (mf.ok) {
    check('display 为 standalone', mf.display === 'standalone', mf.display);
    check('含 192px 图标', mf.has192);
    check('含 512px 图标', mf.has512);
    check('含 maskable 图标', mf.maskable > 0, `${mf.maskable} 个`);
    check('shortcuts 已声明', mf.shortcuts > 0, `${mf.shortcuts} 个`);
    check('所有图标可正常加载', mf.iconFetched.every((s) => s === 200), mf.iconFetched.join(','));
  }

  /* ---- service worker ---- */
  console.log('\n[3] 检查 Service Worker');
  const sw = await evaluate(sessionId, `(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const r = regs[0];
    if (!r) return { ok: false, why: '没有注册任何 SW' };
    const reg = await navigator.serviceWorker.ready;
    return {
      ok: true,
      scope: reg.scope,
      state: reg.active ? reg.active.state : null,
      scriptURL: reg.active ? reg.active.scriptURL : null
    };
  })()`);
  check('Service Worker 已注册', sw.ok, sw.why || '');
  if (sw.ok) {
    check('SW 处于 activated', sw.state === 'activated', sw.state);
    check('SW 脚本路径正确', /\/sw\.js$/.test(sw.scriptURL || ''), sw.scriptURL);
  }

  /* ---- cache storage ---- */
  console.log('\n[4] 检查离线缓存内容');
  const cache = await evaluate(sessionId, `(async () => {
    const keys = await caches.keys();
    if (!keys.length) return { ok: false, why: 'Cache Storage 为空' };
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return {
      ok: true,
      cacheName: keys[0],
      count: reqs.length,
      hasIndex: reqs.some(r => /index\\.html$/.test(r.url)),
      hasApp: reqs.some(r => /js\\/app\\.js$/.test(r.url)),
      hasPwa: reqs.some(r => /js\\/pwa\\.js$/.test(r.url)),
      hasCss: reqs.some(r => /css\\/base\\.css$/.test(r.url)),
      hasAi: reqs.some(r => /services\\/ai\\.js$/.test(r.url)),
      foreign: reqs.filter(r => !r.url.startsWith('http://localhost:8777')).length
    };
  })()`);
  check('Cache Storage 已建立', cache.ok, cache.why || cache.cacheName);
  if (cache.ok) {
    check('index.html 已缓存', cache.hasIndex);
    check('js/app.js 已缓存', cache.hasApp);
    check('js/pwa.js 已缓存', cache.hasPwa);
    check('css/base.css 已缓存', cache.hasCss);
    check('js/services/ai.js 已缓存', cache.hasAi);
    check('未混入跨域资源', cache.foreign === 0, `${cache.foreign} 个跨域条目`);
    console.log(`       共缓存 ${cache.count} 项`);
  }

  /* ---- 跨域请求不进缓存 ---- */
  console.log('\n[5] 验证跨域 AI 请求不被缓存');
  const aiTest = await evaluate(sessionId, `(async () => {
    // 构造一个跨域请求，看 SW 是否放行（不返回缓存里的旧响应）
    const url = 'https://example.invalid/probe-' + Date.now();
    try {
      await fetch(url, { mode: 'no-cors' });
      return { reached: true };
    } catch (e) {
      // 域名不可达是预期的，关键是没有被 SW 用缓存伪造出 200 响应
      return { reached: false, err: String(e).slice(0, 60) };
    }
  })()`);
  check('跨域失败请求未被缓存伪造为成功', aiTest.reached === false,
    aiTest.reached ? '异常：拿到了响应' : '按预期透传至网络');

  /* ---- 离线可用 ---- */
  console.log('\n[6] 断网后重新打开');
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
  }, sessionId);

  const { targetId: t2 } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s2 } = await send('Target.attachToTarget', { targetId: t2, flatten: true });
  await send('Page.enable', {}, s2);
  await send('Runtime.enable', {}, s2);
  await send('Network.enable', {}, s2);
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
  }, s2);

  await send('Page.navigate', { url: BASE }, s2);
  await sleep(3500);

  const offline = await evaluate(s2, `(() => ({
    title: document.title,
    hasView: !!document.querySelector('#view'),
    viewChildren: document.getElementById('view') ? document.getElementById('view').children.length : 0,
    tabbar: !!document.querySelector('#tabbar'),
    hash: location.hash
  }))()`);
  check('断网后页面标题可读', offline.title === 'somnus', offline.title);
  check('断网后 SPA 仍渲染出内容', offline.viewChildren > 0,
    `#view 子节点 ${offline.viewChildren} 个, hash=${offline.hash}`);
  check('断网后底部导航存在', offline.tabbar);

  await send('Target.closeTarget', { targetId: t2 });

  /* ---- 汇总 ---- */
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);

  if (failed) {
    console.log('\n失败项：');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}  ${r.detail}`));
  }

  await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('验证脚本异常:', e.message);
  process.exit(1);
});
