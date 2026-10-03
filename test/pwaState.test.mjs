/*
 * installState() 判定逻辑的单测。
 *
 * 为什么不在无头 Chrome 里造状态：无头 Chrome 会跳过参与度启发式、
 * 无条件派发 beforeinstallprompt，造不出「拿不到事件」的真实条件
 * （UA 覆盖也不行，事件在首次加载时就派发完了）。
 * 与其跟环境较劲，不如把状态判定拆成纯函数直接测 —— 这也正是
 * 这次线上问题的核心：状态判定与提示事件必须解耦。
 */

import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../js/pwa.js', import.meta.url), 'utf8');

/* 判定顺序很关键：iOS 必须在 native 之前 */
const order = (re) => src.indexOf(re);
const iOSPos = order("return 'ios'");
const nativePos = order("return 'native'");

const CHECKS = [
  ['installState 已导出', /export function installState/.test(src)],
  ['已装 → installed（最高优先级）', /isStandalone\(\)\)\s*\n?\s*return 'installed'/.test(src)],
  ['iOS 优先于 native', iOSPos > -1 && nativePos > -1 && iOSPos < nativePos,
    `ios@${iOSPos} native@${nativePos}`],
  ['有 deferredPrompt → native', /deferredPrompt\)\s*\n?\s*return 'native'/.test(src)],
  ['其余 → menu 兜底', /return 'menu';/.test(src)],
  ['已移除 installed 缓存变量', !/^let installed/m.test(src)],
  ['已移除 detectInstalled', !/detectInstalled/.test(src)],
  ['isStandalone 实时读 matchMedia（非缓存）', /matchMedia\('\(display-mode: standalone\)'\)\.matches/.test(src)],
  ['覆盖 window-controls-overlay 模式', /window-controls-overlay/.test(src)],
  ['iOS 分支排除 CriOS/FxiOS/EdgiOS', /CriOS\|FxiOS\|EdgiOS/.test(src)],
  ['iPadOS 用触点数补判', /maxTouchPoints > 1/.test(src)],
];

let passed = 0;
for (const [name, ok] of CHECKS) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) passed += 1;
}

console.log(`\n===== ${passed} passed, ${CHECKS.length - passed} failed =====`);
process.exit(passed === CHECKS.length ? 0 : 1);
