/**
 * 真浏览器验证「提示式更新」：新壳装好却卡在 waiting 时，底部出提示条；
 * 点一下就换壳并自动重开；点 × 只是静音、不切壳。
 *
 * ── 为什么这个脚本自己起静态服务（其他 verify 脚本是外部起）────────────
 * 要验的是「已装机的用户**不关窗口**也能拿到新版」，就必须在跑到一半时
 * 真的发布一次新版（换 VERSION + 改一份壳内资源）。只有自己服务一份可写的
 * 副本，才做得到。服务的是仓库的临时副本 `test/tmp/pwa-update/`，
 * 跑完删掉，仓库文件一个都不动（`test/tmp/` 已在 .gitignore 里）。
 *
 * ── 依赖 ──────────────────────────────────────────────────────────
 * 只有 CDP 要外部起（服务由脚本自己起在 8799）：
 *   chrome --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-update-bar.png（提示条出现的那一刻）
 *
 * ── 有牙验证（改完记得自己跑一遍）──────────────────────────────────
 * 把 js/pwa.js 里 `waiting.postMessage('skip-waiting')` 删掉 → 第 5 步
 * 「点一下就拿到新版」整段必红（页面停在旧版）。这是这套改动的命门，
 * 断言必须落在「点击**之后**拿到了新版」，只断「提示条出现了」是抓不到它的。
 */

import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMP = fileURLToPath(new URL('./tmp/pwa-update/', import.meta.url));
const PORT = 8799;
const CDP = 'http://127.0.0.1:9341';
const APP = `http://127.0.0.1:${PORT}/index.html`;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

/* ---------------- 临时副本 + 自带服务 ---------------- */

/*
 * 用手写的递归拷贝，不用 fs.cpSync：这个环境里 cpSync 复制目录会让 node
 * 进程被直接杀掉（退出码 127，连异常都不抛、exit 钩子都不跑），
 * 排查了很久才发现是它。mkdirSync + copyFileSync 没事。
 */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(TEMP, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(TEMP, f));
}
for (const d of ['css', 'icons', 'js']) copyDir(path.join(ROOT, d), path.join(TEMP, d));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const full = path.join(TEMP, p);
  if (!full.startsWith(TEMP)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const tempFile = (p) => path.join(TEMP, p);
const swVersion = () => /const VERSION = 'v(\d+)'/.exec(fs.readFileSync(tempFile('sw.js'), 'utf8'))[1];

/** 发一次新版：改一份壳内资源 + 换 VERSION 缓存名（等价于 push.cmd 做的那步） */
function publishVersion(n) {
  const cssPath = tempFile('css/base.css');
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\n:root\{--probe-ver:\d+\}\n/g, '');
  fs.writeFileSync(cssPath, `${css}\n:root{--probe-ver:${n}}\n`);
  const sw = fs.readFileSync(tempFile('sw.js'), 'utf8');
  fs.writeFileSync(tempFile('sw.js'), sw.replace(/const VERSION = 'v(\d+)'/, (_, d) => `const VERSION = 'v${Number(d) + 1}'`));
}

/* ---------------- CDP ---------------- */

const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('没有可用的 CDP 页面，先起无头 Chrome'); process.exit(1); }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 求值；重载过程中上下文会被销毁，出错一律返回 undefined 由调用方重试 */
const ev = async (expr) => {
  try {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return undefined;
    return r.result?.result?.value;
  } catch { return undefined; }
};

async function waitFor(fn, ms = 12000, step = 250) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return undefined;
    await sleep(step);
  }
}

/** 页面看到的版本号（从**当前文档真正解析进内存**的样式表里读）。
 *  不能用 CSS 注释当标记：注释不进 cssRules，也读不到。 */
const pageVersion = () => ev(
  `getComputedStyle(document.documentElement).getPropertyValue('--probe-ver').trim()`
);

const swState = () => ev(`(async () => {
  const r = (await navigator.serviceWorker.getRegistrations())[0];
  const st = (w) => (w ? w.state : null);
  return {
    hasReg: !!r,
    installing: r ? st(r.installing) : null,
    waiting: r ? st(r.waiting) : null,
    active: r ? st(r.active) : null,
    controlled: !!navigator.serviceWorker.controller,
    caches: (await caches.keys()).sort()
  };
})()`);

const barState = () => ev(`(() => {
  const b = document.querySelector('.update-bar');
  if (!b) return { exists: false };
  return {
    exists: true,
    hidden: b.hidden,
    display: getComputedStyle(b).display,
    text: b.textContent,
    btn: (b.querySelector('.btn') || {}).textContent || ''
  };
})()`);

const visible = async () => {
  const s = await barState();
  return s.exists && !s.hidden && s.display !== 'none';
};

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), Buffer.from(r.result.data, 'base64'));
};

/** 真鼠标点击某个元素的正中心，并先确认那一点上真的能摸到它 */
async function clickEl(selector) {
  const box = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) return { hit: 'no-element' };

  const hit = await ev(`(() => {
    const el = document.elementFromPoint(${box.x}, ${box.y});
    if (!el) return 'null';
    return el.closest('.update-bar') ? 'in-bar' : (el.className || el.tagName);
  })()`);
  if (hit !== 'in-bar') return { hit };

  const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  return { hit, box };
}

/* ---------------- 开跑 ---------------- */

const { CHANGELOG } = await import('../js/changelog.js');
const newestId = CHANGELOG[0].id;
const V1 = `v${swVersion()}`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /*
   * 从 document 一建起来就盯着提示条「有没有出现过」。
   *
   * 只断言「某一刻它不可见」是抓不到首次安装误报的：那种误报会在
   * 新壳 activate、controllerchange 触发时被自己收掉，等我们去读时早看不见了
   * （和 api-gate 那次「闪一下的创作中」是同一类假绿）。所以数整段时间里
   * 出现过几次 —— 闪一下也算。
   */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__barSeen = 0;
    new MutationObserver(() => {
      const b = document.querySelector('.update-bar');
      if (b && !b.hidden) window.__barSeen++;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  ` });

  console.log(`\n== [1] 干净起步：清掉旧 SW / 缓存，播种「更新说明已阅」 ==`);
  await send('Page.navigate', { url: APP });
  await sleep(1600);
  // 浏览器 profile 是复用的，里面可能已有 SW 与缓存 —— 同源资源 cache-first，
  // 不清会一直跑上一轮留下的代码。另外要把「更新说明」弹窗摁掉（它 z-index 100、
  // 盖在提示条 z-index 60 上面，不播这一下所有点击都会打在遮罩上）。
  await ev(`(async () => {
    const k = 'somnus_state_v1';
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    s.ui = Object.assign({ composeOpen: false }, s.ui || {}, { lastSeenUpdate: ${JSON.stringify(newestId)} });
    localStorage.setItem(k, JSON.stringify(s));
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    return 1;
  })()`);
  await send('Page.reload', {});
  await sleep(2500);

  const s1 = await swState();
  ok('SW 已注册并 activate', s1.hasReg && s1.active === 'activated', JSON.stringify(s1));
  ok('页面已被 SW 接管', s1.controlled === true);
  ok('启动时没有待启用的新壳', s1.waiting === null && s1.installing === null, JSON.stringify(s1));
  ok('页面是 v1（读不到探针版本号）', (await pageVersion()) !== '2', await pageVersion());
  ok('没有任何提示条（新用户不该看到「有新版本」）', !(await visible()), JSON.stringify(await barState()));
  ok('整段时间里提示条一次都没露过头（首次安装不是「有新版」）',
    (await ev('window.__barSeen')) === 0, `露头 ${await ev('window.__barSeen')} 次`);

  console.log(`\n== [2] 发布新版（${V1} -> v${Number(V1.slice(1)) + 1}），不关窗口重新打开 ==`);
  publishVersion(2);
  const after = `v${swVersion()}`;
  await send('Page.reload', {});
  await sleep(3000);

  const s2 = await swState();
  ok('前提成立：新壳装好了，但卡在 waiting 没接手',
    s2.waiting === 'installed' && s2.active === 'activated', JSON.stringify(s2));
  ok('页面拿到的还是旧版（提示条出现 ≠ 已经更新好）',
    (await pageVersion()) !== '2', await pageVersion());
  ok('底部出现了「有新版本可用」', await visible(), JSON.stringify(await barState()));
  const b2 = await barState();
  ok('文案是「有新版本可用」', (b2.text || '').includes('有新版本可用'), b2.text);
  ok('按钮是「立即更新」', (b2.btn || '').trim() === '立即更新', b2.btn);
  await shot('shot-update-bar.png');

  console.log('\n== [3] 点「立即更新」：切壳 + 自动重开，并且真的拿到新版 ==');
  const cl = await clickEl('.update-bar .btn');
  ok('那一点上真的摸得到按钮（没被弹窗之类盖住）', cl.hit === 'in-bar', cl.hit);
  const gotNew = await waitFor(async () => (await pageVersion()) === '2', 15000);
  ok('点完页面自动重开，并且拿到了新版资源', gotNew === true, `pidVer=${await pageVersion()}`);

  const s3 = await waitFor(async () => {
    const s = await swState();
    return s && s.waiting === null && s.caches.length === 1 ? s : undefined;
  }, 8000);
  ok('waiting 清了（新壳已接手）', !!s3 && s3.waiting === null, JSON.stringify(s3));
  ok('旧缓存被丢掉，只剩新壳那一份',
    !!s3 && s3.caches.length === 1 && s3.caches[0] === `somnus-${after}`,
    s3 && s3.caches.join(','));
  ok('提示条收掉了', !(await visible()), JSON.stringify(await barState()));

  console.log('\n== [4] 再发一版，点 × 只静音、不切壳 ==');
  publishVersion(3);
  await send('Page.reload', {});
  await sleep(3000);
  ok('提示条又出现了（新一轮更新照样提）', await visible(), JSON.stringify(await barState()));
  const clx = await clickEl('.update-bar .up-x');
  ok('× 点得到', clx.hit === 'in-bar', clx.hit);
  await sleep(600);
  ok('点完 × 提示条收起来了', !(await visible()), JSON.stringify(await barState()));
  ok('但页面还停在上一版，没有偷偷更新（× 不是「立即更新」的马甲）',
    (await pageVersion()) === '2', await pageVersion());
  const s4 = await swState();
  ok('新壳仍在 waiting 里等着', s4.waiting === 'installed', JSON.stringify(s4));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
} finally {
  server.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
  ws.close();
}

process.exit(fail ? 1 : 0);
