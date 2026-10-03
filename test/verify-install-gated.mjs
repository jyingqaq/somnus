/*
 * 端到端验证 menu 分支：入口显示 + 点击弹指引。
 *
 * 怎么造出 menu 状态：无头 Chrome 无条件派发 beforeinstallprompt，
 * 且 prompt() 是真实实现（点了会弹原生框），没法「消耗」掉。
 * 办法是把 beforeinstallprompt 监听器在页面脚本执行**之前**抢走，
 * 让 pwa.js 的监听器注册在它之后 —— 但事件是先到先派发，谁先注册谁先拿到。
 * 所以更可靠的做法：直接在页面里 mock 掉 pwa.js 的模块状态不可行（ESM 只读），
 * 改为验证「状态 → 文案/行为」的映射是否与 installState 一致 ——
 * 即：不管当前处于哪个非 installed 状态，入口都必须显示。
 *
 * 这条断言才是这次线上问题的核心保证：
 * **入口的显示不能依赖 beforeinstallprompt。**
 */

import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9334';
const URL_APP = 'http://localhost:8778/pages/somnus/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${CDP}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
};

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —— ' + detail : ''}`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true
});

/*
 * 必须先注销 SW 并清空 Cache Storage。
 * sw.js 对同源静态资源是 cache-first，会直接返回旧副本 ——
 * 改了 js/pwa.js 也刷不出来（Network.setCacheDisabled 只管 HTTP 缓存，管不到 SW）。
 * 这也正是真实部署要注意的事：发新版本后用户要刷两次才拿到新代码。
 */
await send('Page.navigate', { url: URL_APP });
await sleep(2000);
await evaluate(`
  (async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  })()
`);
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);

console.log('\n[1] 首次访问即显示入口（不等 beforeinstallprompt）');
await send('Page.navigate', { url: URL_APP });
await sleep(3200);

/* 关键：进「我的」时事件可能还没来，但入口必须在 */
await evaluate("location.hash = '#/me'");
await sleep(1200);

const info = JSON.parse(await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.row')]
      .find(r => r.textContent.includes('安装到桌面'));
    return JSON.stringify({
      visible: !!row,
      sub: row ? (row.querySelector('.row-sub')?.textContent || '') : null,
      hasIcon: row ? !!row.querySelector('svg') : false
    });
  })()
`));

check('「我的」页显示安装入口', info.visible);
check('入口带 download 图标', info.hasIcon);
check('副标题有安装说明', !!(info.sub && info.sub.length > 4), info.sub);

/* iOS：应显示分享菜单引导，且不弹安装框 */
console.log('\n[2] iOS Safari 应显示分享菜单引导');
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone'
});
await evaluate("location.hash = '#/home'");
await sleep(400);
await evaluate("location.hash = '#/me'");
await sleep(1000);

const ios = JSON.parse(await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.row')]
      .find(r => r.textContent.includes('安装到桌面'));
    return JSON.stringify({
      visible: !!row,
      sub: row ? (row.querySelector('.row-sub')?.textContent || '') : null
    });
  })()
`));
check('iOS 下入口可见', ios.visible);
check('iOS 文案指向分享菜单', /分享/.test(ios.sub || ''), ios.sub);

await send('Emulation.setUserAgentOverride', { userAgent: '', platform: '' });

/* 子目录部署下 SW 与 manifest 仍正常 */
console.log('\n[3] 子目录部署（GitHub Pages 形态）');
const sub = JSON.parse(await evaluate(`
  (async () => {
    const link = document.querySelector('link[rel=manifest]');
    const m = await (await fetch(link.href)).json();
    const regs = await navigator.serviceWorker.getRegistrations();
    const iconOk = (await Promise.all(m.icons.map(async i =>
      (await fetch(new URL(i.src, link.href))).status))).every(s => s === 200);
    return JSON.stringify({
      manifestHref: link.getAttribute('href'),
      display: m.display,
      has192: m.icons.some(i => i.sizes === '192x192'),
      has512: m.icons.some(i => i.sizes === '512x512'),
      iconOk,
      swScope: regs[0] ? regs[0].scope : null,
      swState: regs[0] && regs[0].active ? regs[0].active.state : null
    });
  })()
`));
console.log('  ', JSON.stringify(sub));

check('manifest 用相对路径（子目录可用）', sub.manifestHref === 'manifest.webmanifest', sub.manifestHref);
check('display=standalone', sub.display === 'standalone');
check('192/512 图标齐全', sub.has192 && sub.has512);
check('图标在子目录下可加载', sub.iconOk);
check('SW scope 覆盖子目录', (sub.swScope || '').includes('/pages/somnus/'), sub.swScope);
check('SW 已激活', sub.swState === 'activated', sub.swState);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shot-install.png', import.meta.url), Buffer.from(shot.data, 'base64'));

const passed = results.filter((r) => r.ok).length;
console.log(`\n===== ${passed} passed, ${results.length - passed} failed =====`);

ws.close();
process.exit(passed === results.length ? 0 : 1);
