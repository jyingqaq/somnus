/**
 * 真浏览器验证：首页输入框的「角色 / 世界书 / 灵感」面板要跟着「我的」页的文件夹分组走。
 *
 * 依赖：静态服务 8791（serving 本目录）+ CDP 9341
 *   python -m http.server 8791 --bind 127.0.0.1
 *   chrome --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9341 --user-data-dir=test/.tmp-chrome-folders about:blank
 * 产出：shot-collection-folders.png（根目录：文件夹 + 未分类条目）
 *       shot-collection-inside.png（进了文件夹：面包屑 + 只列该文件夹的条目）
 *
 * 为什么要真浏览器：这次改的正是「面板里能看到什么」，而 DOM 替身用例（collectionPicker.test.mjs）
 * 碰不到 CSS —— 文件夹行能不能塞进底部面板、右侧箭头有没有继承成正文色（比旁边条目行重一档）、
 * 长列表在 76vh 里会不会被裁掉，只有真浏览器说了算。
 *
 * 老规矩：sw.js 对同源资源是 cache-first，**不先清 SW 就会一直跑旧代码**，表现是
 * 「明明改对了验证还是 FAIL」。所以先 unregister + 清 caches，再用源码守卫把
 * 「代码对不对」和「浏览器拿到的是不是新代码」分开断言。
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
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

/* ---------- 源码守卫：首页不该再自己把条目平铺出来 ---------- */
{
  const home = fs.readFileSync(new URL('../js/views/home.js', import.meta.url), 'utf8');
  ok('首页的功能入口改走选取面板', /from '\.\.\/components\/collectionPicker\.js'/.test(home));
  ok('首页不再直接 store.list(meta.key) 平铺条目', !/store\.list\(meta\.key\)/.test(home));

  const picker = fs.readFileSync(new URL('../js/components/collectionPicker.js', import.meta.url), 'utf8');
  ok('选取面板按文件夹分组（先列文件夹，再列未分类条目）', /listFolders\(meta\.key\)/.test(picker) && /itemsIn\(meta\.key/.test(picker));
}

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
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

/** 面板里所有条目行的标题（.row-title）；文件夹行标题走 .fo-name，不混进来 */
const sheetTitles = () => ev(`[...document.querySelectorAll('.modal-root.sheet .row-title')].map(n => n.textContent)`);
const folderNames = () => ev(`[...document.querySelectorAll('.modal-root.sheet .folder-row .fo-name')].map(n => n.textContent)`);
const folderCounts = () => ev(`[...document.querySelectorAll('.modal-root.sheet .folder-row .fo-count')].map(n => n.textContent)`);
const chipTitles = () => ev(`[...document.querySelectorAll('.cbox .chip')].map(c => c.textContent)`);
const sheetOpen = () => ev(`document.querySelectorAll('.modal-root.sheet').length`);
/** 点功能栏里某个图标 */
const clickItem = async (title) => {
  const found = await ev(`(() => {
    const b = [...document.querySelectorAll('.cb-item')].find(x => x.title === ${JSON.stringify(title)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(430);
  return found;
};
const clickInSheet = async (sel) => {
  const r = await ev(`(() => {
    const n = document.querySelector('.modal-root.sheet ' + ${JSON.stringify(sel)});
    if (!n) return false;
    n.click();
    return true;
  })()`);
  await sleep(420);
  return r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: APP });
await sleep(2000);

// 旧壳必须先清掉：SW 对同源资源 cache-first，会一直喂旧代码
await ev(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return 1;
})()`);

// 播种：角色 / 世界书各有文件夹，且都留一条「未分类」；灵感**一个文件夹都没有**（验兜底）
await ev(`localStorage.setItem('somnus_state_v1', JSON.stringify({
  roles: [
    { id: 'r1', title: '艾伦', detail: '主角设定：落魄剑客，左手有旧伤。', folderId: 'fr1' },
    { id: 'r2', title: '莉娜', detail: '未分类的女主，药师。', folderId: '' }
  ],
  worlds: [
    { id: 'w1', title: '极夜城', detail: '北境唯一的城邦。', folderId: 'fw1' },
    { id: 'w2', title: '大陆通史', detail: '未分类的世界背景。', folderId: '' }
  ],
  ideas: [
    { id: 'i1', title: '雨夜重逢', detail: '开场：雨夜重逢。', folderId: '' }
  ],
  folders: {
    roles: [{ id: 'fr1', name: '主角组' }],
    worlds: [{ id: 'fw1', name: '北境地理' }],
    ideas: []
  }
}))`);
await send('Page.navigate', { url: APP });
await sleep(2200);

// 浏览器真的拿到了新代码？
const liveSrc = await ev(`fetch('js/components/collectionPicker.js').then(r => r.text())`);
ok('浏览器加载到的 collectionPicker.js 是新的（SW 没喂旧壳）',
  typeof liveSrc === 'string' && liveSrc.includes('listFolders(meta.key)'));
const liveHome = await ev(`fetch('js/views/home.js').then(r => r.text())`);
ok('浏览器加载到的 home.js 已经改用选取面板', !/store\.list\(meta\.key\)/.test(liveHome || ''));

await ev(`location.hash = '#/home'`);
await sleep(700);

/* ---------- 1. 展开功能栏，点「角色」 ---------- */
ok('能拿到输入框', await ev(`!!document.querySelector('.cbox')`));
if (!(await ev(`!!document.querySelector('.cbox.open')`))) {
  await ev(`document.querySelector('.cb-toggle').click()`);
  await sleep(400);
}
ok('功能栏已展开', await ev(`!!document.querySelector('.cbox.open')`));
ok('找到并点到「角色」', await clickItem('角色'));
ok('弹出的是底部面板', await ev(`document.querySelectorAll('.modal-root.sheet').length === 1`));

/* ---------- 2. 根目录：先文件夹，未分类条目在后，文件夹里的不越级 ---------- */
eq('根目录列出本库的文件夹', await folderNames(), ['主角组']);
eq('文件夹副文案是条目数', await folderCounts(), ['1 项']);
eq('根目录只列未分类的条目', await sheetTitles(), ['莉娜']);
ok('放进文件夹的条目不在根目录出现', !(await sheetTitles()).includes('艾伦'));

// 箭头颜色：新增的 .folder-row .chev 必须和条目行的箭头一样淡，别继承成正文色
const chevColors = await ev(`JSON.stringify({
  folder: getComputedStyle(document.querySelector('.modal-root.sheet .folder-row .chev')).color,
  row: getComputedStyle(document.querySelector('.modal-root.sheet .row .chev')).color
})`);
const cc = JSON.parse(chevColors);
ok('文件夹行的箭头颜色与条目行一致（没继承正文色）', cc.folder === cc.row, chevColors);
ok('箭头色确实是 dim 而不是正文色',
  cc.folder !== (await ev(`getComputedStyle(document.querySelector('.modal-root.sheet .m-title')).color`)), chevColors);

await shot('shot-collection-folders.png');

/* ---------- 3. 点进文件夹：面包屑 + 只列该文件夹的条目 ---------- */
ok('点得到文件夹行', await clickInSheet('.folder-row'));
eq('面包屑显示当前路径', await ev(`document.querySelector('.modal-root.sheet .crumb').textContent`), '角色/主角组');
eq('文件夹里只列自己的条目', await sheetTitles(), ['艾伦']);
eq('进去之后不再有文件夹行', await folderNames(), []);
ok('文件夹外的条目不会跟进来看见', !(await sheetTitles()).includes('莉娜'));
await shot('shot-collection-inside.png');

/* ---------- 4. 面包屑回根目录 ---------- */
ok('点得到面包屑前的类别名', await clickInSheet('.crumb-back'));
eq('回到根目录：条目又只剩未分类的', await sheetTitles(), ['莉娜']);
eq('文件夹行也回来了', await folderNames(), ['主角组']);

/* ---------- 5. 从文件夹里挑一条：面板先关，芯片再插进输入框 ---------- */
const chipsBefore = (await chipTitles()).length;
await clickInSheet('.folder-row');           // 进「主角组」
ok('在文件夹里点得到条目', await clickInSheet('.row'));
eq('挑完之后面板关掉了', await sheetOpen(), 0);
const chips = await chipTitles();
eq('输入框里多了一个芯片', chips.length, chipsBefore + 1);
ok('芯片上写的是文件夹里那条标题', chips[chips.length - 1].includes('艾伦'), JSON.stringify(chips));
ok('挑完面板仍展开（只有左上角 × 能收起）', await ev(`!!document.querySelector('.cbox.open')`));

/* ---------- 6. 世界书 / 灵感各看各的 ---------- */
ok('找到并点到「世界书」', await clickItem('世界书'));
eq('世界书面板列自己的文件夹', await folderNames(), ['北境地理']);
eq('世界书面板的根目录只有自己的未分类条目', await sheetTitles(), ['大陆通史']);
await clickInSheet('.folder-row');
eq('世界书进文件夹只列该文件夹的条目', await sheetTitles(), ['极夜城']);
await ev(`document.querySelector('.modal-root.sheet .m-x').click()`);
await sleep(400);

ok('找到并点到「灵感」', await clickItem('灵感'));
eq('灵感没有文件夹时直接列条目（跟以前一样）', await folderNames(), []);
eq('灵感列的是自己的条目', await sheetTitles(), ['雨夜重逢']);
await ev(`document.querySelector('.modal-root.sheet .m-x').click()`);
await sleep(400);

/* ---------- 7. 管理页（我的 → 角色）看到的是同一份分组 ---------- */
await ev(`location.hash = '#/library/roles'`);
await sleep(800);
eq('管理页根目录的文件夹与面板一致',
  await ev(`[...document.querySelectorAll('.folder-row .fo-name')].map(n => n.textContent)`), ['主角组']);
eq('管理页根目录只列未分类条目',
  await ev(`[...document.querySelectorAll('.card .row-title')].map(n => n.textContent)`), ['莉娜']);
ok('管理页的文件夹行仍带操作钮', await ev(`!!document.querySelector('.folder-row .fo-op')`));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
