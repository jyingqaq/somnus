/**
 * 真浏览器验证「主动获取更新」这条路：**不再自动弹任何东西**，
 * 用户去「设置 → 获取更新」点一下，才查得到新版、才看得到这次改了什么、才换壳重开。
 *
 * ── 为什么这个脚本自己起静态服务（其他 verify 脚本是外部起）────────────
 * 要验的是「线上真的发了新版之后，用户不关窗口也能主动拿到」，就必须在跑到一半时
 * 真的发布一次新版：换 VERSION + 改一份壳内资源 + **往 changelog 最前面插一条**。
 * 最后这步尤其不能省 —— 「列出这次改了什么」靠的正是「线上比本地多出来的条目」，
 * 线上不带新条目的话那条链路根本走不到。只有自己服务一份可写的副本才做得到。
 * 服务的是仓库的临时副本 `test/tmp/pwa-update/`，跑完删掉，仓库文件一个都不动
 *（`test/tmp/` 已在 .gitignore 里）。
 *
 * ── 依赖 ──────────────────────────────────────────────────────────
 * 只有 CDP 要外部起（服务由脚本自己起在 8799）：
 *   chrome --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9341 --user-data-dir=tmp/chrome about:blank
 * 产出：shot-update-page.png（发现新版本那一刻）
 *
 * ── 有牙验证（改完记得自己跑一遍，三条都实测过）────────────────────
 * 1) 在 js/app.js 里加回「启动后 300ms 弹个窗」（或把提示条挂回去）→
 *    第 1、2 段「启动什么都不冒 / 整段时间一次都没露头」必红。
 * 2) 把 js/pwa.js 里 `waiting.postMessage('skip-waiting')` 删掉（换成普通重开）→
 *    第 4 段「waiting 清了 / 旧缓存被丢掉，只剩新壳那一份」必红。
 *    ⚠️ 别只看「点完拿到了新版资源」那一条 —— 它**会假绿**：壳对同源资源是
 *    stale-while-revalidate，上一轮加载就已经把新 css 写回旧缓存了，
 *    于是单靠重开也能读到新版资源，壳其实还卡在 waiting。这两条才是命门。
 * 3) 把 publishVersion 里「往 changelog 插一条」那步去掉 → 第 3 段
 *    「列得出这次改了什么」必红。
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

/** 这次发布带上的更新日志标题/正文，断言要用 */
const probeTitle = (n) => `探针版本 ${n}`;
const probeItem = (n) => `这是第 ${n} 次发布才有的内容`;

/**
 * 发一次新版，一步不落地照真实发布来：
 *   1) 改一份壳内资源（css 里挂个 `--probe-ver`，用来确认页面真的换到新版了）
 *   2) 往 changelog 的**最前面**插一条 —— 「列出这次改了什么」全靠它
 *   3) 换 VERSION 缓存名（等价于 push.cmd 做的那步）
 */
function publishVersion(n) {
  const cssPath = tempFile('css/base.css');
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\n:root\{--probe-ver:\d+\}\n/g, '');
  fs.writeFileSync(cssPath, `${css}\n:root{--probe-ver:${n}}\n`);

  const clPath = tempFile('js/changelog.js');
  const cl = fs.readFileSync(clPath, 'utf8');
  const marker = 'export const CHANGELOG = [\n';
  const entry = '  {\n'
    + `    id: 'probe${n}',\n`
    + "    date: '2026-10-06',\n"
    + `    title: '${probeTitle(n)}',\n`
    + `    items: ['${probeItem(n)}']\n`
    + '  },\n';
  fs.writeFileSync(clPath, cl.replace(marker, marker + entry));

  const sw = fs.readFileSync(tempFile('sw.js'), 'utf8');
  fs.writeFileSync(tempFile('sw.js'),
    sw.replace(/const VERSION = 'v(\d+)'/, (_, d) => `const VERSION = 'v${Number(d) + 1}'`));
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

async function waitFor(fn, ms = 15000, step = 250) {
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

/** 界面上那些「自己冒出来」的东西，一个都不该有 */
const noise = () => ev(`({
  bar: !!document.querySelector('.update-bar'),
  modal: !!document.querySelector('#modal-root .modal-root'),
  seen: window.__noise || null
})`);

const upState = () => ev(`(document.querySelector('#view .up-state') || {}).textContent || ''`);
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), Buffer.from(r.result.data, 'base64'));
};

/** 真鼠标点击某个元素的正中心，并先确认那一点上真的能摸到它 */
async function clickEl(selector, inside) {
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
    return el.closest(${JSON.stringify(inside)}) ? 'target' : (el.className || el.tagName);
  })()`);
  if (hit !== 'target') return { hit };

  const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  return { hit, box };
}

/* ---------------- 开跑 ---------------- */

const V1 = `v${swVersion()}`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /*
   * 从 document 一建起来就盯着「有没有东西自己冒出来」。
   * 只断言「某一刻界面上没有」是抓不到一闪而过的弹窗的（那种误报会自己收掉），
   * 所以数整段时间里露头几次 —— 闪一下也算。老代码里 APP 挂的正是
   * 底部提示条 + 300ms 后自动弹的更新说明。
   */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__noise = { bar: 0, modal: 0 };
    new MutationObserver(() => {
      if (document.querySelector('.update-bar')) window.__noise.bar++;
      if (document.querySelector('#modal-root .modal-root')) window.__noise.modal++;
    }).observe(document, { childList: true, subtree: true, attributes: true });
  ` });

  console.log('\n== [1] 干净起步：清掉旧 SW / 缓存，确认启动什么都不冒 ==');
  await send('Page.navigate', { url: APP });
  await sleep(1600);
  // 浏览器 profile 是复用的，里面可能已有 SW 与缓存 —— 同源资源 cache-first，不清会跑旧代码
  await ev(`(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    return 1;
  })()`);
  await send('Page.reload', {});
  await sleep(2600);

  const s1 = await swState();
  ok('SW 已注册并 activate', s1.hasReg && s1.active === 'activated', JSON.stringify(s1));
  ok('页面已被 SW 接管', s1.controlled === true);
  ok('启动时没有待启用的新壳', s1.waiting === null && s1.installing === null, JSON.stringify(s1));
  ok('页面是 v1（读不到探针版本号）', (await pageVersion()) !== '2', await pageVersion());
  const n1 = await noise();
  ok('界面上没有提示条', !n1.bar, JSON.stringify(n1));
  ok('启动没有弹窗', !n1.modal, JSON.stringify(n1));

  console.log(`\n== [2] 发布新版（${V1} -> v${Number(V1.slice(1)) + 1}），重开：**什么都不该冒出来** ==`);
  publishVersion(2);
  const after = `v${swVersion()}`;
  await send('Page.reload', {});
  await sleep(3200);

  const s2 = await swState();
  ok('前提成立：新壳装好了，但卡在 waiting 没接手',
    s2.waiting === 'installed' && s2.active === 'activated', JSON.stringify(s2));
  ok('页面拿到的还是旧版（没偷偷更新）', (await pageVersion()) !== '2', await pageVersion());
  const n2 = await noise();
  ok('新壳就绪了，界面上依然没有提示条（以前这里会挂一条）', !n2.bar, JSON.stringify(n2));
  ok('新壳就绪了，也没有弹窗（以前这里会弹更新说明）', !n2.modal, JSON.stringify(n2));
  ok('整段时间里这两样一次都没露过头',
    n2.seen && n2.seen.bar === 0 && n2.seen.modal === 0, JSON.stringify(n2.seen));

  console.log('\n== [3] 设置 → 获取更新：查出来的是新版，而且列得出这次改了什么 ==');
  await ev(`location.hash = '#/settings/updates'`);
  await sleep(800);
  ok('页面标题是「更新」',
    (await ev(`(document.querySelector('#view .tb-title') || {}).textContent || ''`)).includes('更新'),
    await ev(`(document.querySelector('#view .tb-title') || {}).textContent || ''`));

  const settled = await waitFor(async () => {
    const t = await upState();
    return t && !t.includes('正在检查') && t !== '看看有没有新版本' ? t : '';
  }, 15000);
  ok('查出的结论是「发现新版本」', (settled || '').includes('发现新版本'), settled);

  const vtext = await ev(`document.querySelector('#view').textContent`);
  ok('列出了这次新增的标题', (vtext || '').includes(probeTitle(2)), vtext);
  ok('列出了这次新增的正文（这才是「具体内容」）', (vtext || '').includes(probeItem(2)), vtext);
  ok('有「立即更新」按钮', await ev(`!!document.querySelector('#view .up-go')`));
  ok('说了更新后会自动重开',
    (vtext || '').includes('自动重新打开'), vtext);
  await shot('shot-update-page.png');

  console.log('\n== [4] 点「立即更新」：切壳 + 自动重开，并且真的拿到新版 ==');
  const cl = await clickEl('#view .up-go', '.up-go');
  ok('那一点上真的摸得到按钮', cl.hit === 'target', cl.hit);
  const gotNew = await waitFor(async () => (await pageVersion()) === '2', 20000);
  ok('点完页面自动重开，并且拿到了新版资源', gotNew === true, `pidVer=${await pageVersion()}`);

  const s3 = await waitFor(async () => {
    const s = await swState();
    return s && s.waiting === null && s.caches.length === 1 ? s : undefined;
  }, 8000);
  ok('waiting 清了（新壳已接手）', !!s3 && s3.waiting === null, JSON.stringify(s3));
  ok('旧缓存被丢掉，只剩新壳那一份',
    !!s3 && s3.caches[0] === `somnus-${after}`, s3 && s3.caches.join(','));

  // 新版已经生效，那条更新日志也该跟着进到本机了
  await ev(`location.hash = '#/settings/updates'`);
  await sleep(900);
  const afterText = await ev(`document.querySelector('#view').textContent`);
  ok('新版生效后，那条更新日志已经进了本机的历史列表',
    (afterText || '').includes(probeTitle(2)), afterText);

  console.log('\n== [5] 再发一版：还是要用户自己去拿 ==');
  publishVersion(3);
  await send('Page.reload', {});
  await sleep(3200);
  const n5 = await noise();
  ok('又发了新版，界面上照样什么都不冒', !n5.bar && !n5.modal, JSON.stringify(n5));

  await ev(`location.hash = '#/settings/updates'`);
  await sleep(800);
  const settled5 = await waitFor(async () => {
    const t = await upState();
    return t && t.includes('发现新版本') ? t : '';
  }, 15000);
  ok('主动进来查得到这一版', !!settled5, settled5);
  const vtext5 = await ev(`document.querySelector('#view').textContent`);
  ok('列的是这一版的新增内容', (vtext5 || '').includes(probeItem(3)), vtext5);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
} finally {
  server.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
  ws.close();
}

process.exit(fail ? 1 : 0);
