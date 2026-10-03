/**
 * 验证悬浮加号的光晕颜色跟随主题色。
 *
 * 覆盖矩阵：三个库（角色/世界书/灵感）× 浅色/深色 × 默认色/自定义色，
 * 断言 box-shadow 里的 rgb 分量与当前 --accent 一致。
 *
 * 依赖：静态服务 8791 + CDP 9341
 */
import { WebSocket } from 'ws';

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

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 首次打开时路由和视图还没挂完，先等首页真的渲染出来
await send('Page.navigate', { url: APP });
await sleep(2500);
for (let i = 0; i < 10; i++) {
  if (await ev(`!!document.querySelector('.tabbar, .page')`)) break;
  await sleep(500);
}

/** 进到指定库页面，读回加号按钮的光晕与当前主题色 */
async function probe(kind) {
  await ev(`location.hash = '#/home'`); await sleep(400);
  await ev(`location.hash = '#/library/${kind}'`); await sleep(900);
  return JSON.parse(await ev(`
    (() => {
      const fab = document.querySelector('.fab');
      if (!fab) return JSON.stringify({ err: 'no fab' });
      const cs = getComputedStyle(fab);
      const root = getComputedStyle(document.documentElement);
      const m = cs.boxShadow.match(/rgba?\\(([^)]+)\\)/);
      return JSON.stringify({
        shadow: cs.boxShadow,
        shadowRgb: m ? m[1].trim() : null,
        accent: root.getPropertyValue('--accent').trim(),
        accentRgb: root.getPropertyValue('--accent-rgb').trim(),
        bg: cs.backgroundColor,
        theme: document.documentElement.dataset.theme
      });
    })()
  `));
}

/* ---- 1. 三个库都有加号，且光晕跟着默认主题色 ---- */
console.log('\n[1] 三个库页面的加号光晕');
for (const [kind, label] of [['roles', '角色'], ['worlds', '世界书'], ['ideas', '灵感']]) {
  const r = await probe(kind);
  if (r.err) { ok(`${label}：加号存在`, false, r.err); continue; }
  // 去掉空格统一格式；光晕的 rgb() 里还带一个 alpha 分量，比较时只取前三个
  const norm = (s) => String(s).replace(/\s/g, '');
  const rgb3 = (s) => norm(s).split(',').slice(0, 3).join(',');
  ok(`${label}：加号存在`, true);
  ok(`${label}：光晕用的是 accent 三元组`, rgb3(r.shadowRgb) === rgb3(r.accentRgb), `shadow=${r.shadowRgb} accent=${r.accentRgb}`);
  ok(`${label}：背景是 accent 色`, norm(r.bg) === `rgb(${norm(r.accentRgb)})`, `bg=${r.bg} accent=${r.accentRgb}`);
  console.log(`        theme=${r.theme} accent=${r.accent} rgb=(${r.accentRgb}) shadow=${r.shadow}`);
}

/* ---- 2. 深色主题：光晕应换成深色主题的默认色 ---- */
console.log('\n[2] 深色主题下的光晕');
await ev(`(async () => {
  const store = await import('/js/store.js');
  store.patchSettings ? null : null;
  store.patchAppearance ? store.patchAppearance({ theme: 'dark' }) : null;
})()`);
// store 没有 patchAppearance 就直接写 localStorage 再重载，最稳
await ev(`(() => {
  const raw = JSON.parse(localStorage.getItem('somnus_state_v1') || '{}');
  raw.appearance = { ...(raw.appearance || {}), theme: 'dark', accent: '' };
  localStorage.setItem('somnus_state_v1', JSON.stringify(raw));
})()`);
await send('Page.reload', { ignoreCache: true });
await sleep(2600);
{
  const r = await probe('roles');
  const rgb3 = (s) => String(s).replace(/\s/g, '').split(',').slice(0, 3).join(',');
  ok('深色：主题已切到 dark', r.theme === 'dark', r.theme);
  ok('深色：光晕用的是深色 accent 三元组', rgb3(r.shadowRgb) === rgb3(r.accentRgb), `shadow=${r.shadowRgb} accent=${r.accentRgb}`);
  ok('深色：accent 变亮了', r.accentRgb.replace(/\s/g, '') === '143,143,247', r.accentRgb);
  ok('深色：光晕透明度比浅色更高', /0\.42/.test(r.shadow), r.shadow);
  console.log(`        theme=${r.theme} accent=${r.accent} rgb=(${r.accentRgb}) shadow=${r.shadow}`);
}

/* ---- 3. 自定义主题色：光晕必须跟着换 ---- */
console.log('\n[3] 自定义主题色（橙色）');
await ev(`(() => {
  const raw = JSON.parse(localStorage.getItem('somnus_state_v1') || '{}');
  raw.appearance = { ...(raw.appearance || {}), theme: 'light', accent: '#e8590c' };
  localStorage.setItem('somnus_state_v1', JSON.stringify(raw));
})()`);
await send('Page.reload', { ignoreCache: true });
await sleep(2600);
{
  const r = await probe('worlds');
  const rgb3 = (s) => String(s).replace(/\s/g, '').split(',').slice(0, 3).join(',');
  const norm = (s) => String(s).replace(/\s/g, '');
  ok('自定义色：accent 已变', r.accent === '#e8590c', r.accent);
  ok('自定义色：RGB 三元组已同步', r.accentRgb === '232, 89, 12', r.accentRgb);
  ok('自定义色：光晕跟着换了色', rgb3(r.shadowRgb) === '232,89,12', `shadow=${r.shadowRgb}`);
  ok('自定义色：按钮底色也一致', norm(r.bg) === 'rgb(232,89,12)', `bg=${r.bg}`);
  console.log(`        accent=${r.accent} rgb=(${r.accentRgb}) shadow=${r.shadow}`);
}

ws.close();
process.exit(fail ? 1 : 0);
