/**
 * 浏览器验证：云端备份页 —— 手动上传 / 手动恢复，以及「恢复不动外观」。
 *
 * 跑法（服务 8823 + CDP 9363，与别的用例分开，免得 SW / localStorage 互相污染）：
 *
 *   cd .. && python -m http.server 8823 --bind 127.0.0.1 &
 *   chrome --headless=new --disable-gpu --no-sandbox \
 *          --remote-debugging-port=9363 --user-data-dir=../.agent-browser/tmp/cloud-verify about:blank &
 *   node verify-cloud-backup.mjs
 *
 * 为什么必须真浏览器：这一轮验的是「点一下，数据真的按预期变了」——
 * 页面装配、弹窗确认链路、以及**恢复之后外观到底动没动**。
 * 纯 node 用例能测 store.replaceContent，但测不到「视图接的是不是那个函数」——
 * 之前踩过一次「只测了 store、视图里自己另拼一份参数」的亏（见 creationBook.test.mjs）。
 *
 * GitHub 请求全部由一个假的 fetch 接住（页面里 `realFetch` 是 `(...a) => fetch(...a)`，
 * 运行时才取全局 fetch，所以在页面里覆盖 window.fetch 就能接管），
 * 于是不需要真令牌、也不会真的往仓库里写东西。
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { WebSocket } from 'ws';

const CDP = 'http://127.0.0.1:9363';
const APP = 'http://127.0.0.1:8823/index.html';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find((x) => x.type === 'page');
if (!page) throw new Error('没有 page target，Chrome 起了吗？');
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
const t = { send, ev, sleep, shot, ok };

/**
 * 走到某个路由并**真的重新加载**。
 *
 * 两个都必须绕开：只改 hash 属于同文档导航，模块不会重新执行（播种 / 改配置之后那样导航，
 * 读到的还是重载前那份数据）；而「navigate 到带 hash 的地址紧接着 reload」也不行 ——
 * reload 用的是调用那一刻的 document URL，hash 导航还没提交时它会把旧地址再load 一遍。
 * 所以这里给 URL 带一个每次都变的查询串，强制走完整导航。
 */
let nav = 0;
const goto = async (hash) => {
  await send('Page.navigate', { url: `${APP}?v=${++nav}${hash || ''}` });
  await sleep(1900);
};

/** 点一行（按文案找 .row） */
const clickRow = (text) => ev(`(() => {
  const el = [...document.querySelectorAll('.row')].find(e => e.textContent.includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`);

/** 点弹窗底部按钮，**必须完全相等** —— 「整份恢复」里也含「恢复」，用 includes 会点错 */
const clickFootBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('.modal-foot .btn')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false;
  b.click();
  return true;
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }); // 只管 HTTP 缓存，管不到 SW
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: APP });
await sleep(2000);
// 坑 1：SW cache-first 会把旧代码一直喂回来，先清干净再重载
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);
await send('Page.navigate', { url: APP });
await sleep(2200);

/* ---------------- 1) 源码守卫：先把「代码错了」和「浏览器拿到旧壳」分开 ---------------- */

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const srcView = read('js/views/backup.js');
const srcStore = read('js/store.js');
const srcSvc = read('js/services/backup.js');
const srcSw = read('sw.js');

ok('备份页不再调 applyAppearance', !srcView.includes('applyAppearance'), '还有 applyAppearance');
ok('备份页改走 replaceContent', srcView.includes('store.replaceContent('), '没接上新函数');
ok('store 里没有 replaceState 了', !srcStore.includes('replaceState'), '旧函数还在');
ok('备份服务里没有 stripApiConfig 了', !srcSvc.includes('stripApiConfig'), '旧函数还在');
ok('备份服务有内容白名单', srcSvc.includes('CONTENT_TOP_KEYS'));
ok('SW 预缓存了 cloud.js', srcSw.includes("'./js/services/cloud.js'"));
ok('SW 预缓存了 cloudConfig.js', srcSw.includes("'./js/services/cloudConfig.js'"));
ok('SW 预缓存了 backupCloud.js', srcSw.includes("'./js/views/backupCloud.js'"));
ok('SW 版本号提上去了', /const VERSION = 'v7'/.test(srcSw), 'VERSION 没改');

/* ---------------- 2) 播种本机存档 ---------------- */

const SEED = {
  settings: {
    apiBase: 'https://local.example/v1',
    apiKey: 'sk-local-secret',
    model: 'local-model',
    temperature: 0.3,
    maxTokens: 2048
  },
  apiPresets: [{ id: 'p1', name: '本机预设', apiKey: 'sk-preset-secret' }],
  activeApiPreset: 'p1',
  appearance: { theme: 'dark', accent: '#123456' },
  profile: { nickname: '本机昵称', bio: '本机简介', avatar: 'data:image/jpeg;base64,AVATAR-SECRET' },
  ui: { composeOpen: true },
  // 两本本机的书，云端只有一本 —— 这样确认框里「本机数据 / 云端数据」的摘要才分得开
  books: [
    { id: 'b-local', title: '本机的书', chapters: [{ id: 'c-local', title: '第1章', content: '本机正文' }] },
    { id: 'b-local2', title: '本机的书二', chapters: [{ id: 'c-local2', title: '第1章', content: '本机正文二' }] }
  ],
  creations: [],
  roles: [{ id: 'r-local', title: '本机角色' }],
  worlds: [],
  ideas: [],
  presets: [],
  folders: { roles: [], worlds: [], ideas: [] },
  draft: { title: '', html: '' }
};

/** 云端那份：故意用 v1 的老格式（整份存档、带 Key 带外观带头像），验证它也会被削干净 */
const REMOTE = {
  app: 'somnus',
  version: 1,
  exportedAt: Date.parse('2026-10-03T15:00:00'),
  data: {
    settings: { apiBase: 'https://remote.example/v1', apiKey: 'sk-remote-secret', model: 'remote-model' },
    appearance: { theme: 'light', accent: '#ff0000' },
    profile: { nickname: '云端昵称', bio: '云端简介', avatar: 'data:image/png;base64,REMOTE-AVATAR' },
    books: [{ id: 'b-remote', title: '云端的书', chapters: [{ id: 'c-remote', title: '第1章', content: '云端正文' }] }],
    roles: [{ id: 'r-remote', title: '云端角色' }],
    creations: [],
    worlds: [],
    ideas: [],
    presets: [],
    folders: { roles: [], worlds: [], ideas: [] }
  }
};

await ev(`localStorage.setItem('somnus_state_v1', ${JSON.stringify(JSON.stringify(SEED))}); 1`);
await goto('');

const seeded = await ev(`JSON.parse(localStorage.getItem('somnus_state_v1')).profile.avatar`);
ok('播种生效（避免读到默认空档）', seeded === 'data:image/jpeg;base64,AVATAR-SECRET', String(seeded));

/* ---------------- 3) 未连接时的云端备份页 ---------------- */

await goto('#/backup/cloud');

const blank = await ev(`({
  title: (document.querySelector('.tb-title') || {}).textContent || '',
  hint: document.body.textContent.includes('连接 GitHub'),
  scope: document.body.textContent.includes('图片和主题不会上传'),
  local: document.body.textContent.includes('只支持手动上传和手动恢复'),
  connected: document.body.textContent.includes('立即备份')
})`);
ok('进了云端备份页', blank.title.includes('云端备份'), blank.title);
ok('未连接时给的是「连接 GitHub」入口', blank.hint);
ok('写清了备份范围不含图片与主题', blank.scope);
ok('写清了只做手动', blank.local);
ok('未连接时不显示「立即备份」', blank.connected === false);
await shot('shot-cloud-empty.png');

/* ---------------- 4) 从备份页能进云端页 ---------------- */

await goto('#/backup');
const backupPage = await ev(`({
  hasCloud: [...document.querySelectorAll('.row-title')].some(e => e.textContent.includes('云端备份')),
  scopeNote: document.body.textContent.includes('只含文字内容'),
  restoreWord: [...document.querySelectorAll('.row-title')].some(e => e.textContent.includes('从文件恢复'))
})`);
ok('备份页有「云端备份」入口', backupPage.hasCloud);
ok('导出项写明只含文字内容', backupPage.scopeNote);
ok('「导入」已改称「恢复」', backupPage.restoreWord);

ok('能点开「云端备份」那一行', await clickRow('云端备份'), '没找到那一行');
await sleep(900);
const navOk = await ev(`location.hash.includes('/backup/cloud')`);
ok('点入口能跳到云端页', navOk === true, await ev('location.hash'));

/* ---------------- 5) 连接之后的样子 ---------------- */

await ev(`localStorage.setItem('somnus_cloud_v1', ${JSON.stringify(JSON.stringify({
  token: 'ghp_fake_token', owner: 'someone', repo: 'novel-backup', branch: '', path: 'somnus-backup.json', lastSyncAt: 0, lastSha: ''
}))}); 1`);
await goto('#/backup/cloud');
await sleep(1500);

const conn = await ev(`({
  repo: document.body.textContent.includes('someone/novel-backup'),
  path: document.body.textContent.includes('somnus-backup.json'),
  never: document.body.textContent.includes('还没有'),
  hasUpload: [...document.querySelectorAll('.row-title')].some(e => e.textContent.includes('立即备份')),
  hasRestore: [...document.querySelectorAll('.row-title')].some(e => e.textContent.includes('从云端恢复'))
})`);
ok('显示仓库', conn.repo);
ok('显示文件路径', conn.path);
ok('还没同步过时如实写「还没有」', conn.never);
ok('有「立即备份」', conn.hasUpload);
ok('有「从云端恢复」', conn.hasRestore);

const leaked = await ev(`document.body.textContent.includes('ghp_fake_token')`);
ok('页面上不回显令牌原文', leaked === false);
await shot('shot-cloud-connected.png');

/* ---------------- 6) 装一个假的 fetch 接管 GitHub ---------------- */

const installFake = (mode) => ev(`(() => {
  window.__calls = [];
  window.__mode = ${JSON.stringify(mode)};
  window.__remote = ${JSON.stringify(JSON.stringify(REMOTE))};
  const b64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  window.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    window.__calls.push({
      method,
      url: String(url),
      accept: ((init || {}).headers || {}).Accept || '',
      body: (init && init.body) || ''
    });
    const json = (status, obj) => ({
      ok: status >= 200 && status < 300, status,
      json: async () => obj, text: async () => JSON.stringify(obj)
    });
    if (method === 'GET') {
      if (window.__mode === 'empty') return json(404, { message: 'Not Found' });
      return json(200, { encoding: 'base64', content: b64(window.__remote), sha: 'sha-remote-1' });
    }
    return json(201, { content: { sha: 'sha-after-push' } });
  };
  return 1;
})()`);

/* ---------------- 7) 立即备份：确认弹窗 + 真的 PUT 上去 ---------------- */

await installFake('empty');
ok('能点开「立即备份」', await clickRow('立即备份'), '没找到那一行');
await sleep(1000);

const upModal = await ev(`({
  open: !!document.querySelector('.modal-card'),
  title: (document.querySelector('.m-title') || {}).textContent || '',
  first: document.body.textContent.includes('还没有文件，这是第一次'),
  sum: document.body.textContent.includes('本机数据') && document.body.textContent.includes('2 本书')
})`);
ok('弹出上传确认', upModal.open === true);
ok('标题是「上传到云端」', upModal.title.includes('上传到云端'), upModal.title);
ok('云端为空时如实说明是第一次', upModal.first);
ok('确认框带出本机数据摘要（2 本书）', upModal.sum);

await clickFootBtn('上传');
await sleep(1200);

const pushed = await ev(`({
  calls: window.__calls.map(c => c.method + ' ' + (c.url.match(/contents\\/(.*)$/) || [])[1]),
  put: (window.__calls.find(c => c.method === 'PUT') || {}).body || '',
  toast: document.body.textContent.includes('已备份到云端')
})`);
ok('先 GET 探一次再 PUT 写入', pushed.calls.join(' | ') === 'GET somnus-backup.json | PUT somnus-backup.json', pushed.calls.join(' | '));
ok('上传后给了成功提示', pushed.toast);

const putBody = (() => { try { return JSON.parse(pushed.put); } catch { return {}; } })();
const putText = (() => {
  try {
    const bin = atob(putBody.content || '');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return ''; }
})();
ok('上传内容里有本机的书', putText.includes('本机的书'), putText.slice(0, 120));
ok('上传内容里有昵称与简介', putText.includes('本机昵称') && putText.includes('本机简介'));
ok('上传内容里没有 API Key', !putText.includes('sk-local-secret'));
ok('上传内容里没有 API 预设', !putText.includes('sk-preset-secret'));
ok('上传内容里没有头像图片', !putText.includes('AVATAR-SECRET'));
ok('上传内容里没有外观设置', !putText.includes('#123456') && !putText.includes('"appearance"'));
ok('上传内容里没有云端配置', !putText.includes('ghp_fake_token'));

const syncState = await ev(`JSON.parse(localStorage.getItem('somnus_cloud_v1')).lastSha`);
ok('写完后记下了新的 sha', syncState === 'sha-after-push', String(syncState));

/* ---------------- 8) 从云端恢复：整份恢复不能动外观 ---------------- */

await installFake('has-file');
ok('能点开「从云端恢复」', await clickRow('从云端恢复'), '没找到那一行');
await sleep(1000);

const downModal = await ev(`(() => {
  const txt = document.body.textContent;
  return {
    title: (document.querySelector('.m-title') || {}).textContent || '',
    cloud: txt.includes('云端备份') && txt.includes('1 本书'),
    local: txt.includes('本机数据') && txt.includes('2 本书'),
    warn: txt.includes('外观主题、头像、API 与云端设置一概不动')
  };
})()`);
ok('弹出恢复确认', downModal.title.includes('从云端恢复'), downModal.title);
ok('云端与本机数据量分别列出（1 本 / 2 本）', downModal.cloud && downModal.local,
  JSON.stringify(downModal));
ok('写清了外观与头像不会被覆盖', downModal.warn);

await clickFootBtn('整份恢复');
await sleep(900);
const confirmOpen = await ev(`document.body.textContent.includes('确认整份恢复')`);
ok('整份恢复会再要一次确认', confirmOpen === true);
await shot('shot-cloud-restore-confirm.png');

await clickFootBtn('恢复');
await sleep(1400);

const after = await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('somnus_state_v1'));
  return {
    books: s.books.map(b => b.title),
    roles: s.roles.map(r => r.title),
    nick: s.profile.nickname,
    bio: s.profile.bio,
    avatar: s.profile.avatar,
    theme: s.appearance.theme,
    accent: s.appearance.accent,
    apiKey: s.settings.apiKey,
    apiBase: s.settings.apiBase,
    model: s.settings.model,
    presets: s.apiPresets.length,
    composeOpen: s.ui.composeOpen,
    raw: JSON.stringify(s)
  };
})()`);

ok('书换成了云端的', after.books.length === 1 && after.books[0] === '云端的书', after.books.join(','));
ok('角色换成了云端的', after.roles.join(',') === '云端角色', after.roles.join(','));
ok('昵称按云端走', after.nick === '云端昵称', after.nick);
ok('简介按云端走', after.bio === '云端简介', after.bio);
ok('外观主题没被动', after.theme === 'dark', after.theme);
ok('主题色没被动', after.accent === '#123456', after.accent);
ok('头像没被动', after.avatar === 'data:image/jpeg;base64,AVATAR-SECRET', after.avatar);
ok('API Key 没被动', after.apiKey === 'sk-local-secret', after.apiKey);
ok('API 地址没被动', after.apiBase === 'https://local.example/v1', after.apiBase);
ok('模型没被动', after.model === 'local-model', after.model);
ok('API 预设没被动', after.presets === 1, String(after.presets));
ok('界面态没被动', after.composeOpen === true);
ok('云端那份里的 Key 没跟着进来', !after.raw.includes('sk-remote-secret'));
ok('云端那份里的头像没跟着进来', !after.raw.includes('REMOTE-AVATAR'));
ok('恢复后给了提示', (await ev(`document.body.textContent.includes('已恢复云端备份')`)) === true);

const themeApplied = await ev(`document.documentElement.className + '|' + getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
ok('页面主题也没被重下成云端那份', themeApplied.includes('#123456') || !themeApplied.includes('#ff0000'), themeApplied);

await shot('shot-cloud-after-restore.png');

/* ---------------- 收尾 ---------------- */

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
try { ws.close(); } catch { /* 已经断了 */ }

/** 按端口查 PID 再杀。⚠️ 别用 taskkill /IM chrome.exe —— 会把用户自己开着的浏览器一起杀掉 */
function pidsOnPort(port) {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  return [...new Set(out.split('\n')
    .filter((l) => l.includes('LISTENING') && l.includes(':' + port + ' '))
    .map((l) => l.trim().split(/\s+/).pop())
    .filter((p) => /^\d+$/.test(p)))];
}
[8823, 9363].forEach((p) => {
  pidsOnPort(p).forEach((pid) => {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* 已经没了 */ }
  });
});
process.exit(fail ? 1 : 0);
