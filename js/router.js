/** 极简 hash 路由 */

import { applySection } from './theme.js';
import { closeAllModals } from './components/modal.js';

const routes = [];
const subs = new Set();
let viewEl = null;
let currentPath = '';

/** 路径首段 -> 顶栏/底栏/背景所属区块 */
export const SECTIONS = {
  home: 'home', creation: 'home',
  shelf: 'shelf', book: 'shelf',
  me: 'me', library: 'me', settings: 'me', prompt: 'me'
};

export function define(path, view) {
  routes.push({
    parts: path.replace(/^\/|\/$/g, '').split('/').filter(Boolean),
    view
  });
}

export function navigate(path) {
  const hash = '#' + path;
  if (location.hash === hash) resolve();
  else location.hash = hash;
}

export function back(fallback = '/home') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

export function getPath() {
  return currentPath;
}

/** 重新渲染当前路由 */
export function reload() {
  return resolve();
}

export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function parse() {
  const raw = location.hash.slice(1) || '/home';
  const [path, qs] = raw.split('?');
  return {
    parts: path.split('/').filter(Boolean),
    query: Object.fromEntries(new URLSearchParams(qs || '')),
    path
  };
}

function match(parts) {
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i += 1) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
      else if (p !== parts[i]) { ok = false; break; }
    }
    if (ok) return { view: r.view, params };
  }
  return null;
}

async function resolve() {
  const { parts, query, path } = parse();
  currentPath = path;
  closeAllModals();
  applySection(SECTIONS[parts[0]] || 'home');
  subs.forEach((fn) => fn(path));

  const hit = match(parts);
  if (!hit) { navigate('/home'); return; }

  const node = await hit.view.render({ params: hit.params, query, path });
  viewEl.replaceChildren(node || document.createComment('empty'));
  window.scrollTo(0, 0);
}

export function start(el) {
  viewEl = el || document.getElementById('view');
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = '#/home';
  resolve();
}
