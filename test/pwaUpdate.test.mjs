/*
 * 「提示式更新」的接线守卫（纯 node，读源码 + 文件，不起浏览器）。
 *
 * 为什么用读源码的方式守：这套链路的每一环都**断了也不报错** ——
 * 少发一次 postMessage、少一个 controllerchange 钩子、SHELL 漏一个文件，
 * 页面照常能跑，只是又回到「更新时有时无」。这种静默失效只能靠断言钉住。
 * 真正的行为（点一下真的换壳并重开）由 verify-pwa-update.mjs 在真浏览器里跑。
 *
 * 这里的每一条都对应一个具体后果，写在中文名里。
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

const [sw, pwa, bar, app, css, manifest] = await Promise.all([
  file('sw.js'),
  file('js/pwa.js'),
  file('js/components/updateBar.js'),
  file('js/app.js'),
  file('css/components.css'),
  file('manifest.webmanifest')
]);

const { CHANGELOG } = await import('../js/changelog.js');

/* ---------- SHELL 与磁盘双向核对 ---------- */

const root = fileURLToPath(new URL('..', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const e of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await walk(`${dir}/${e.name}`)));
    else out.push(`${dir}/${e.name}`);
  }
  return out;
}

const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const onDisk = [...(await walk('js')), ...(await walk('css')), ...(await walk('icons')),
  'index.html', 'manifest.webmanifest'];

const notInShell = onDisk.filter((f) => !shell.includes(f));
const notOnDisk = shell.filter((f) => !onDisk.includes(f));

/* ---------- 断言表 ---------- */

const CHECKS = [
  /* sw.js */
  ['SHELL 收了 updateBar.js（否则离线时提示条加载不出来）',
    shell.includes('js/components/updateBar.js')],
  ['SHELL 与磁盘双向一致：磁盘上每个文件都在清单里',
    notInShell.length === 0, notInShell.join(',')],
  ['SHELL 与磁盘双向一致：清单里每个文件都真实存在',
    notOnDisk.length === 0, notOnDisk.join(',')],
  ['sw.js 仍把 skip-waiting 接到 skipWaiting（提示条的落点就在这里）',
    /event\.data === 'skip-waiting'[\s\S]{0,40}skipWaiting\(\)/.test(sw)],

  /* pwa.js：把 waiting 那份推到 activate */
  ['pwa.js 真的会发出 skip-waiting（全链路最关键的一条）',
    /postMessage\('skip-waiting'\)/.test(pwa)],
  ['发出 skip-waiting 前先挂了 controllerchange', 
    /controllerchange'[\s\S]{0,80}postMessage\('skip-waiting'\)/.test(pwa)],
  ['重开只做一次（reloading 守卫），不会 controllerchange 打转',
    /if \(reloading\) return;[\s\S]{0,60}reloading = true;[\s\S]{0,40}location\.reload\(\)/.test(pwa)],
  ['没 waiting 时也能重开兜底（applyUpdate 直接 reloadOnce）',
    /if \(!waiting\) \{[\s\S]{0,40}reloadOnce\(\)/.test(pwa)],

  /* pwa.js：什么时候才提示 */
  ['新壳 installed 且页面被旧壳控制着才提示（首次安装不提示）',
    /worker\.state === 'installed' && navigator\.serviceWorker\.controller/.test(pwa)],
  ['首次注册补一眼 reg.installing（updatefound 在 register 解析前就发过了）',
    /trackIncoming\(reg\.installing\)/.test(pwa)],
  ['打开时就检查已有的 waiting（上次没更新就退出的场景）',
    /reg\.waiting && navigator\.serviceWorker\.controller\) setUpdateReady\(true\)/.test(pwa)],
  ['壳被外部换掉时把提示收回去',
    /controllerchange'[\s\S]{0,80}if \(!reloading\) setUpdateReady\(false\)/.test(pwa)],

  /* pwa.js：从后台切回来补查 */
  ['从后台切回来会主动 update()（复用同一文档时不会有导航）',
    /visibilitychange[\s\S]{0,80}checkForUpdate/.test(pwa)
      && /registration\.update\(\)/.test(pwa)],
  ['补查有 5 分钟节流，不会来回切页就狂打 sw.js',
    /CHECK_GAP = 5 \* 60 \* 1000/.test(pwa) && /now - lastCheckAt < CHECK_GAP/.test(pwa)],
  ['register 之后接上 watchRegistration（否则上面这套全都不生效）',
    /register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)[\s\S]{0,400}watchRegistration\(reg\)/.test(pwa)],
  ['onUpdateChange / applyUpdate 都已导出（提示条要用）',
    /export function onUpdateChange/.test(pwa) && /export function applyUpdate/.test(pwa)],

  /* updateBar.js */
  ['提示条不自己判状态，判定全取 pwa.js',
    /import \{ onUpdateChange, applyUpdate \} from '\.\.\/pwa\.js'/.test(bar)],
  ['「立即更新」点完先禁用，避免切壳期间被连点',
    /action\.disabled = true;[\s\S]{0,60}applyUpdate\(\)/.test(bar)],
  ['× 只是本次会话静音，状态回落后要清掉（否则下一版永远不提示）',
    /if \(!ready\) dismissed = false;/.test(bar)],
  ['提示条挂在 layer-root（不在 #view 里，换页不会被重画）',
    /getElementById\('layer-root'\)\.appendChild\(bar\)/.test(bar)],
  ['app.js 挂上了提示条',
    /mountUpdateBar\(\)/.test(app)],

  /* 样式：本项目栽过的 hidden 坑 */
  ['CSS 补了 .update-bar[hidden]（hidden 压不过作者样式的 display）',
    /\.update-bar\[hidden\] \{ display: none; \}/.test(css)],

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
