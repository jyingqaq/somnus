/**
 * 截取「我的」页三个库入口 + 库页加号的对比图，肉眼确认光晕与主题色一致。
 * 依赖：静态服务 8791 + CDP 9341
 */
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9341';
const APP = 'http://127.0.0.1:8791/index.html';

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
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function setTheme(theme, accent) {
  await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem('somnus_state_v1') || '{}');
    raw.appearance = { ...(raw.appearance || {}), theme: ${JSON.stringify(theme)}, accent: ${JSON.stringify(accent || '')} };
    localStorage.setItem('somnus_state_v1', JSON.stringify(raw));
  })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);
}

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(s.result.data, 'base64'));
  console.log('  saved', name);
}

console.log('浅色 · 默认紫');
await setTheme('light', '');
await ev(`location.hash = '#/library/roles'`); await sleep(1100);
await shot('./shot-fab-light.png');

console.log('浅色 · 自定义橙');
await setTheme('light', '#e8590c');
await ev(`location.hash = '#/library/roles'`); await sleep(1100);
await shot('./shot-fab-orange.png');

console.log('深色 · 默认紫');
await setTheme('dark', '');
await ev(`location.hash = '#/library/roles'`); await sleep(1100);
await shot('./shot-fab-dark.png');

ws.close();
process.exit(0);
