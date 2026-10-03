/**
 * 外观应用：主题 / 主题色 / 背景图 / 顶底栏透明度 / 自定义字体
 * 所有外观都通过 CSS 变量下发，样式层不需要感知业务逻辑。
 */

import { getState } from './store.js';
import { mix, readableOn, toRgbTuple, hexToRgb } from './util/color.js';

const BASE_BG = { light: '#f3f3f6', dark: '#0e0e11' };
const DEFAULT_ACCENT = { light: '#5b5bd6', dark: '#8f8ff7' };

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const fontCache = new Map();

function isDark() {
  const pref = getState().appearance.theme || 'system';
  return pref === 'dark' || (pref === 'system' && mq.matches);
}

/* ---------------- 主题 + 主题色 ---------------- */

function applyColor() {
  const root = document.documentElement;
  const dark = isDark();
  const bg = BASE_BG[dark ? 'dark' : 'light'];
  const custom = getState().appearance.accent;
  const accent = hexToRgb(custom) ? custom : DEFAULT_ACCENT[dark ? 'dark' : 'light'];

  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--bg-rgb', toRgbTuple(bg));
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-strong', mix(accent, dark ? '#ffffff' : '#000000', 0.16));
  root.style.setProperty('--accent-weak', mix(accent, bg, dark ? 0.78 : 0.88));
  root.style.setProperty('--on-accent', readableOn(accent));
  // 需要 alpha 的地方（如加号按钮的光晕）靠这个三元组拼 rgba，
  // 否则样式里写死颜色会不跟着自定义主题色走。
  root.style.setProperty('--accent-rgb', toRgbTuple(accent));

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
}

/* ---------------- 背景图 ---------------- */

function applyBackgrounds() {
  const { backgrounds } = getState().appearance;
  document.querySelectorAll('#backdrop .bg').forEach((el) => {
    const cfg = backgrounds[el.dataset.section] || {};
    const src = (cfg.src || '').trim();
    el.style.backgroundImage = src ? `url("${src.replace(/"/g, '\\"')}")` : 'none';
    el.style.opacity = src ? String(cfg.opacity == null ? 0.35 : cfg.opacity) : '0';
  });
}

/* ---------------- 上下栏透明度 ---------------- */

function applyBarOpacity() {
  const { barOpacity } = getState().appearance;
  const root = document.documentElement;
  const t = barOpacity && barOpacity.top != null ? barOpacity.top : 0.75;
  const b = barOpacity && barOpacity.bottom != null ? barOpacity.bottom : 0.9;
  root.style.setProperty('--bar-top', String(t));
  root.style.setProperty('--bar-bottom', String(b));
  root.classList.toggle('bars-solid', t >= 0.999 && b >= 0.999);
}

/* ---------------- 卡片/弹窗透明度 ---------------- */

function applySurfaceOpacity() {
  const v = getState().appearance.surfaceOpacity;
  const a = v == null ? 1 : Number(v);
  const root = document.documentElement;
  root.style.setProperty('--surface-a', String(a));
  root.classList.toggle('frosted', a < 0.985);
}

/* ---------------- 字号 ---------------- */

const BASE_FS = { ui: 15, novel: 16.5 };

function applyFontSizes() {
  const cfg = getState().appearance.fontSize || {};
  const ui = Number(cfg.ui) > 0 ? Number(cfg.ui) : BASE_FS.ui;
  const novel = Number(cfg.novel) > 0 ? Number(cfg.novel) : BASE_FS.novel;
  const root = document.documentElement;
  root.style.setProperty('--fs', String(ui / BASE_FS.ui));
  root.style.setProperty('--nfs', String(novel / BASE_FS.novel));
}

/* ---------------- 自定义字体 ---------------- */

function clearFont(key) {
  document.getElementById(`custom-font-${key}-link`)?.remove();
  document.getElementById(`custom-font-${key}-style`)?.remove();
  document.documentElement.style.removeProperty(key === 'ui' ? '--font-ui' : '--font-novel');
}

function familyFromUrl(url) {
  const base = String(url).split('?')[0].split('#')[0].split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '') || 'custom-font';
}

async function applyFont(cfg, key) {
  clearFont(key);
  const url = (cfg && cfg.url ? cfg.url : '').trim();
  if (!url) return;

  let family = (cfg.family || '').trim() || familyFromUrl(url);
  const cacheKey = `${key}::${url}::${family}`;

  // 直链字体文件走 FontFace；其余（.css 样式表、字体站点的 CSS 链接）走 <link>
  const isFontFile = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url);

  try {
    if (!isFontFile) {
      const existing = document.getElementById(`custom-font-${key}-link`);
      if (!existing || existing.getAttribute('href') !== url) {
        existing?.remove();
        const link = document.createElement('link');
        link.id = `custom-font-${key}-link`;
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
      }
    } else if (!fontCache.has(cacheKey)) {
      const face = new FontFace(family, `url("${url.replace(/"/g, '\\"')}")`);
      await face.load();
      document.fonts.add(face);
      fontCache.set(cacheKey, true);
    }
    const varName = key === 'ui' ? '--font-ui' : '--font-novel';
    document.documentElement.style.setProperty(varName, `"${family}"`);
  } catch (e) {
    console.warn('[font] 加载失败', url, e);
    clearFont(key);
  }
}

function applyFonts() {
  const { uiFont, novelFont } = getState().appearance;
  applyFont(uiFont, 'ui');
  applyFont(novelFont, 'novel');
}

/* ---------------- 对外 ---------------- */

export function applyAppearance() {
  applyColor();
  applyBackgrounds();
  applyBarOpacity();
  applySurfaceOpacity();
  applyFontSizes();
  applyFonts();
}

/** 切换 section 时高亮对应背景层 */
export function applySection(section) {
  document.documentElement.dataset.section = section || 'home';
}

export function initTheme() {
  applyAppearance();
  const rerun = () => { if ((getState().appearance.theme || 'system') === 'system') applyColor(); };
  if (mq.addEventListener) mq.addEventListener('change', rerun);
  else mq.addListener(rerun);
}

export { applyAppearance as applyTheme, applyColor };
