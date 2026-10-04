/**
 * 主题色一致性静态检查（纯 node，无需浏览器）。
 *
 * 背景：`.fab` 的光晕曾硬编码 `rgba(91, 91, 214, ...)`，换主题色后不跟着变。
 * 这类 bug 断言测不出来、只能靠肉眼发现，所以在这里做一次全量扫描：
 * 样式里凡是「看起来像主题色」的 rgba 都必须走 var(--accent-rgb)。
 *
 * 另外这里守着「默认主题色」这一组值的完整性 —— 默认色从紫改成
 * 「浅色黑 / 深色白」之后，同样的动作要改 4 个地方（theme.js 的 DEFAULT_ACCENT、
 * base.css 的浅色与深色两块兜底、设置页取默认色的方式），
 * 漏改任何一处都是只在特定主题 / JS 未执行时才现形的错色，很难靠肉眼发现。
 */
import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};

const base = await readFile(new URL('../css/base.css', import.meta.url), 'utf8');
const comp = await readFile(new URL('../css/components.css', import.meta.url), 'utf8');
const layout = await readFile(new URL('../css/layout.css', import.meta.url), 'utf8');
const theme = await readFile(new URL('../js/theme.js', import.meta.url), 'utf8');
const all = { 'base.css': base, 'components.css': comp, 'layout.css': layout };

console.log('\n== 默认主题色 ==');
// 默认色是「浅色黑 / 深色白」这一对，改动它必须同时改 4 处，
// 漏掉任何一处都会造成「兜底色和运行时色不是同一个」——只在 JS 没跑起来那一瞬间可见，
// 或者只在深色下可见，肉眼极难发现。
ok('theme.js 浅色默认 #000000', /DEFAULT_ACCENT\s*=\s*\{\s*light:\s*'#000000'/.test(theme));
ok('theme.js 深色默认 #ffffff', /dark:\s*'#ffffff'/.test(theme));
ok('theme.js 通过 defaultAccent() 取默认色（界面别自己写死）',
  /export function defaultAccent\(\)/.test(theme) && /hexToRgb\(custom\) \? custom : defaultAccent\(\)/.test(theme));
ok('base.css 浅色 --accent 兜底 = #000000', /--accent:\s*#000000;/.test(base));
ok('base.css 深色 --accent 兜底 = #ffffff',
  /\[data-theme="dark"\][\s\S]*--accent:\s*#ffffff;/.test(base));
// 深色兜底若不改 --on-accent，白底白字（.fab / .btn.primary / 开关）
ok('base.css 深色 --on-accent 是深色字',
  /\[data-theme="dark"\][\s\S]*--on-accent:\s*#12121a;/.test(base));
ok('设置页颜色选择器读 defaultAccent()，没写死默认色',
  /ap\.accent \|\| defaultAccent\(\)/.test(
    await readFile(new URL('../js/views/settingsTheme.js', import.meta.url), 'utf8')));

console.log('\n== 变量定义 ==');
ok('base.css 定义了 --accent-rgb', /--accent-rgb\s*:/.test(base));
ok('浅色兜底 = 0, 0, 0（等于 #000000）', /--accent-rgb:\s*0,\s*0,\s*0/.test(base));
ok('深色兜底 = 255, 255, 255（等于 #ffffff）', /--accent-rgb:\s*255,\s*255,\s*255/.test(base));
ok('深色兜底写在 [data-theme="dark"] 块里',
  /\[data-theme="dark"\][\s\S]*--accent-rgb:\s*255/.test(base));

console.log('\n== 运行时下发 ==');
ok('theme.js 下发 --accent-rgb', /setProperty\('--accent-rgb'/.test(theme));
ok('下发的是当前解析出的 accent', /setProperty\('--accent-rgb',\s*toRgbTuple\(accent\)\)/.test(theme));
ok('沿用已有的 toRgbTuple（未重复实现取 rgb）', /toRgbTuple/.test(theme));

console.log('\n== 没有残留硬编码主题色 ==');
// 默认色现在是黑 / 白，而黑白在阴影、描边、文字里本来就合法，
// 没法再靠「rgb 等于默认色」来判定写死。所以这里守的是历史遗留：
// 主题色曾经是 #5b5bd6 / #8f8ff7 这一对紫，谁的 rgb 形态又出现在样式里，
// 就说明又有人把颜色写死了。
// 真正的主力防线是 verify-fab-glow.mjs —— 它拿 getComputedStyle 读回的值和
// 当前 --accent-rgb 比对，写死的颜色骗不过它。
let hardcoded = [];
for (const [name, src] of Object.entries(all)) {
  src.split('\n').forEach((line, i) => {
    // rgba(r,g,b) 形式的颜色
    const m = line.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    // 历史主题色 #5b5bd6 / #8f8ff7 的 rgb 形态
    const isLegacyAccent = (r === 91 && g === 91 && b === 214) || (r === 143 && g === 143 && b === 247);
    if (isLegacyAccent) hardcoded.push(`${name}:${i + 1}  ${line.trim()}`);
  });
}
ok('样式表里没有 rgb 形态的历史主题色残留', hardcoded.length === 0, hardcoded.join(' | '));

console.log('\n== .fab 用的是变量 ==');
const fabBlock = comp.match(/\.fab\s*\{[\s\S]*?\n\}/);
ok('能找到 .fab 规则块', !!fabBlock);
ok('光晕走 rgba(var(--accent-rgb), ...)',
  /box-shadow:[^;]*rgba\(var\(--accent-rgb\),\s*[\d.]+\)/.test(fabBlock ? fabBlock[0] : ''),
  fabBlock ? fabBlock[0].match(/box-shadow:[^;]*/)?.[0] : 'no block');
ok('深色下有单独的亮度补偿规则', /\[data-theme="dark"\]\s*\.fab/.test(comp));

console.log('\n== 全站其它 accent 用法仍是变量 ==');
// 之前全量扫过，只有 fab 一处脱队；这里留个反向断言防止新引入
const accentVars = (comp.match(/var\(--accent\)/g) || []).length;
ok('components.css 里 var(--accent) 用得够多（未被硬编码稀释）', accentVars > 20, 'count=' + accentVars);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
