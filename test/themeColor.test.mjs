/**
 * 主题色一致性静态检查（纯 node，无需浏览器）。
 *
 * 背景：`.fab` 的光晕曾硬编码 `rgba(91, 91, 214, ...)`，换主题色后不跟着变。
 * 这类 bug 断言测不出来、只能靠肉眼发现，所以在这里做一次全量扫描：
 * 样式里凡是「看起来像主题色」的 rgba 都必须走 var(--accent-rgb)。
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

console.log('\n== 变量定义 ==');
ok('base.css 定义了 --accent-rgb', /--accent-rgb\s*:/.test(base));
ok('浅色兜底 = 91, 91, 214（等于 #5b5bd6）', /--accent-rgb:\s*91,\s*91,\s*214/.test(base));
ok('深色兜底 = 143, 143, 247（等于 #8f8ff7）', /--accent-rgb:\s*143,\s*143,\s*247/.test(base));
ok('深色兜底写在 [data-theme="dark"] 块里',
  /\[data-theme="dark"\][\s\S]*--accent-rgb:\s*143/.test(base));

console.log('\n== 运行时下发 ==');
ok('theme.js 下发 --accent-rgb', /setProperty\('--accent-rgb'/.test(theme));
ok('下发的是当前解析出的 accent', /setProperty\('--accent-rgb',\s*toRgbTuple\(accent\)\)/.test(theme));
ok('沿用已有的 toRgbTuple（未重复实现取 rgb）', /toRgbTuple/.test(theme));

console.log('\n== 没有残留硬编码主题色 ==');
// 已知合法的字面量：颜色选择器 / 设置页的默认值
const ALLOWED = [
  { file: 'js', needle: /['"]#5b5bd6['"]/ }   // controls.js + settingsTheme.js 的兜底
];
let hardcoded = [];
for (const [name, src] of Object.entries(all)) {
  src.split('\n').forEach((line, i) => {
    // rgba(r,g,b) 形式的颜色，且 r=g=b 那种「灰」不管，只抓紫色系
    const m = line.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    // #5b5bd6 / #8f8ff7 的 rgb 形态
    const isAccentLike = (r === 91 && g === 91 && b === 214) || (r === 143 && g === 143 && b === 247);
    if (isAccentLike) hardcoded.push(`${name}:${i + 1}  ${line.trim()}`);
  });
}
ok('样式表里没有 rgba 形态的硬编码主题色', hardcoded.length === 0, hardcoded.join(' | '));

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
