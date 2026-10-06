/*
 * 「主动获取更新」的接线守卫（纯 node，读源码 + 文件，不起浏览器）。
 *
 * 为什么用读源码的方式守：这套链路的每一环都**断了也不报错** ——
 * 少发一次 postMessage、少一个 controllerchange 钩子、SHELL 漏一个文件、
 * 设置页那个入口被改回「自动弹」，页面照常能跑，只是用户又拿不到新版、
 * 或者又被自动弹窗糊一脸。这种静默失效只能靠断言钉住。
 * 真正的行为（点一下真的换壳并重开、真的列出新版本内容）由
 * verify-pwa-update.mjs 在真浏览器里跑。
 *
 * 这里的每一条都对应一个具体后果，写在中文名里。
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

const [sw, pwa, app, notice, settings, page, css, baseCss] = await Promise.all([
  file('sw.js'),
  file('js/pwa.js'),
  file('js/app.js'),
  file('js/services/updateNotice.js'),
  file('js/views/settings.js'),
  file('js/views/settingsUpdates.js'),
  file('css/components.css'),
  file('css/base.css')
]);

const { CHANGELOG } = await import('../js/changelog.js');

/* ---------- SHELL 与磁盘双向核对 ---------- */

async function walk(dir) {
  const out = [];
  for (const e of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await walk(`${dir}/${e.name}`)));
    else out.push(`${dir}/${e.name}`);
  }
  return out;
}

const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const diskJs = await walk('js');
const onDisk = [...diskJs, ...(await walk('css')), ...(await walk('icons')),
  'index.html', 'manifest.webmanifest'];

const notInShell = onDisk.filter((f) => !shell.includes(f));
const notOnDisk = shell.filter((f) => !onDisk.includes(f));

/* ---------- 断言表 ---------- */

const CHECKS = [
  /* 撤掉的老东西：一样都不许留在盘上或代码里 */
  ['updateBar.js 已经删掉（自动提示条整个撤了）',
    !onDisk.includes('js/components/updateBar.js')],
  ['底部的 .update-bar 样式也删了（两个 css 都不许留残影）',
    !/\.update-bar/.test(css) && !/\.update-bar/.test(baseCss)],
  ['app.js 不再挂提示条', !/mountUpdateBar|updateBar/.test(app)],
  ['app.js 不再自动弹更新说明', !/showUpdateNoticeIfAny/.test(app)],
  ['updateNotice.js 不再导出自动弹窗',
    !/export function showUpdateNoticeIfAny/.test(notice) && !/openModal/.test(notice)],
  ['pwa.js 不再自己盯 visibilitychange 偷偷查（改成用户点按钮才查）',
    !/visibilitychange/.test(pwa) && !/CHECK_GAP/.test(pwa)],

  /* sw.js */
  ['SHELL 与磁盘双向一致：磁盘上每个文件都在清单里',
    notInShell.length === 0, notInShell.join(',')],
  ['SHELL 与磁盘双向一致：清单里每个文件都真实存在',
    notOnDisk.length === 0, notOnDisk.join(',')],
  ['sw.js 仍把 skip-waiting 接到 skipWaiting（「立即更新」的落点就在这里）',
    /event\.data === 'skip-waiting'[\s\S]{0,40}skipWaiting\(\)/.test(sw)],
  ['带查询串的同源请求不进缓存（不然每点一次「获取更新」就白堆一份 changelog）',
    /if \(url\.search\) return;/.test(sw)],

  /* pwa.js：把 waiting 那份推到 activate */
  ['pwa.js 真的会发出 skip-waiting（全链路最关键的一条）',
    /postMessage\('skip-waiting'\)/.test(pwa)],
  ['发出 skip-waiting 前先挂了 controllerchange',
    /controllerchange'[\s\S]{0,80}postMessage\('skip-waiting'\)/.test(pwa)],
  ['重开只做一次（reloading 守卫），不会 controllerchange 打转',
    /if \(reloading\) return;[\s\S]{0,60}reloading = true;[\s\S]{0,40}location\.reload\(\)/.test(pwa)],
  ['没 waiting 时也能重开兜底（applyUpdate 直接 reloadOnce）',
    /if \(!waiting\) \{[\s\S]{0,40}reloadOnce\(\)/.test(pwa)],

  /* pwa.js：主动检查这条路 */
  ['pwa.js 导出 checkForUpdates（设置页那个按钮要靠它）',
    /export async function checkForUpdates/.test(pwa)],
  ['检查是真的去要 sw.js（reg.update()），不是读现成状态',
    /await reg\.update\(\)/.test(pwa)],
  ['检查会等新壳落到 waiting（刚 update() 完它多半还在 installing）',
    /if \(reg\.waiting\) return true;[\s\S]{0,80}reg\.installing/.test(pwa)],
  ['没有 Service Worker 的环境给的是 unsupported，不是崩掉',
    /'serviceWorker' in navigator\)\) return 'unsupported'/.test(pwa)],
  ['拿不到注册时也返回 unsupported（用户可能一进设置就点）',
    /if \(!reg\) return 'unsupported';/.test(pwa)],
  ['register 之后只记下 registration，不再订阅任何「有新版本」事件',
    /register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)[\s\S]{0,400}then\(\(reg\) => \{ registration = reg; \}\)/.test(pwa)],

  /* 入口：设置页 → 更新页 */
  ['设置页的入口叫「获取更新」（不再是「更新日志」）',
    /label: '获取更新'/.test(settings) && !/label: '更新日志'/.test(settings)],
  ['设置页入口指向 /settings/updates', /navigate\('\/settings\/updates'\)/.test(settings)],
  ['更新页用的是 checkForUpdates / applyUpdate',
    /import \{ applyUpdate, checkForUpdates \} from '\.\.\/pwa\.js'/.test(page)],
  ['更新页有「获取更新」按钮，且是**用户点**才查（render 里不直接 await）',
    /获取更新/.test(page) && /addEventListener\('click', \(\) => run\(\)\)/.test(page)],
  ['更新页会拉线上 changelog 算出「这次改了什么」',
    /newerUpdates\(await fetchRemoteUpdates\(\)\)/.test(page)],
  ['更新页有「立即更新」，且点完先禁用（切壳 + 重开不可逆）',
    /go\.disabled = true;[\s\S]{0,60}applyUpdate\(\)/.test(page)],
  ['更新页把没看过的条目标成「新」，并在渲染时记档',
    /unseen\.has\(it\.id\) \? '新'/.test(page) && /markUpdatesSeen\(list\[0\]\.id\)/.test(page)],

  /* 样式 */
  ['CSS 补了更新页那几张卡（.up-state / .up-extra）',
    /\.up-state \{/.test(css) && /\.up-extra:not\(:empty\)/.test(css)],

  /* 更新日志 */
  ['CHANGELOG 的 id 全局唯一',
    new Set(CHANGELOG.map((it) => it.id)).size === CHANGELOG.length],
  ['最新一条更新日志的 id 在 sw.js 里出现过（跟 VERSION 走的约定）',
    CHANGELOG.length > 0 && sw.includes(CHANGELOG[0].id),
    CHANGELOG[0] && CHANGELOG[0].id],
  ['每条更新都得有 date / title / items',
    CHANGELOG.every((it) => it.date && it.title && Array.isArray(it.items) && it.items.length)]
];

let passed = 0;
for (const [name, ok, detail] of CHECKS) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  —— ${detail}` : ''}`);
  if (ok) passed += 1;
}
console.log(`\n===== ${passed} passed, ${CHECKS.length - passed} failed =====`);
process.exit(passed === CHECKS.length ? 0 : 1);
