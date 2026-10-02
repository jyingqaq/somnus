/** 线性图标集 */

const ICONS = {
  home: { d: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>' },
  book: { d: '<path d="M5 4.6A1.6 1.6 0 0 1 6.6 3H19v15H6.6A1.6 1.6 0 0 0 5 19.6z"/><path d="M5 19.6A1.6 1.6 0 0 1 6.6 18H19v3H6.6A1.6 1.6 0 0 1 5 19.6z"/>' },
  user: { d: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>' },
  plus: { d: '<path d="M12 5.5v13M5.5 12h13"/>' },
  minus: { d: '<path d="M5.5 12h13"/>' },
  trash: { d: '<path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l1 12a1.2 1.2 0 0 0 1.2 1h6.6a1.2 1.2 0 0 0 1.2-1l1-12"/><path d="M10.4 11v6M13.6 11v6"/>' },
  back: { d: '<path d="M14.5 5.5 8 12l6.5 6.5"/>' },
  star: { d: '<path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9L9.5 9z"/>' },
  starFill: { d: '<path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9L9.5 9z"/>', fill: true },
  edit: { d: '<path d="M4 20h4.2L19.4 8.8a1.5 1.5 0 0 0 0-2.1l-2.1-2.1a1.5 1.5 0 0 0-2.1 0L4 15.8z"/><path d="M14.5 5.5 18.5 9.5"/>' },
  close: { d: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>' },
  save: { d: '<path d="M5 4.5h10.5L19 8v11.5H5z"/><path d="M9 4.5V10h6V4.5"/><path d="M8.5 20v-5.5h7V20"/>' },
  load: { d: '<path d="M12 5a7.5 7.5 0 1 1-7 5"/><path d="M12 8.6V12l2.8 2"/><path d="M5.5 4.5V10h5.5"/>' },
  bulb: { d: '<path d="M9.4 17.5h5.2M10.3 20.5h3.4"/><path d="M12 3.5a5.6 5.6 0 0 0-3.3 10.1v2.4h6.6v-2.4A5.6 5.6 0 0 0 12 3.5z"/>' },
  globe: { d: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.6 2.4 2.6 14 0 16.4-2.6-2.4-2.6-14 0-16.4z"/>' },
  mask: { d: '<path d="M4 5.5h7v6a3.5 3.5 0 0 1-7 0z"/><path d="M13 12.5h7v6a3.5 3.5 0 0 1-7 0z"/><path d="M6.6 9h1.6M15.6 16h1.6"/>' },
  /* 小人：圆脑袋 + 眼睛 + 微笑 + 肩膀 */
  person: { d: '<circle cx="12" cy="7.9" r="4.5"/><circle cx="10.15" cy="7.35" r=".9" fill="currentColor" stroke="none"/><circle cx="13.85" cy="7.35" r=".9" fill="currentColor" stroke="none"/><path d="M10.55 9.65c.42.5.87.75 1.45.75s1.03-.25 1.45-.75"/><path d="M4.6 20.7c0-3.7 3.3-5.9 7.4-5.9s7.4 2.2 7.4 5.9"/>' },
  gear: { d: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3v2.3M12 18.7V21M4.3 7.5l2 1.1M17.7 15.4l2 1.1M4.3 16.5l2-1.1M17.7 8.6l2-1.1"/>' },
  chev: { d: '<path d="M9.5 6 15.5 12l-6 6"/>' },
  spark: { d: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>' },
  image: { d: '<rect x="3.5" y="5" width="17" height="14" rx="2.6"/><circle cx="9" cy="10" r="1.6"/><path d="M4.6 17.6 10 12.6l4 3.5 2.5-2.5 3 3"/>' },
  link: { d: '<path d="M10.2 13.6a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1"/><path d="M13.8 10.4a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1"/>' },
  check: { d: '<path d="M5 12.5 9.5 17 19 7.5"/>' },
  layers: { d: '<path d="M12 3.5 3.5 8.2 12 12.9l8.5-4.7z"/><path d="M3.5 12.6 12 17.3l8.5-4.7"/>' },
  bookmark: { d: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>' },
  chat: { d: '<path d="M7.6 6h8.8a3.2 3.2 0 0 1 3.2 3.2v4.4a3.2 3.2 0 0 1-3.2 3.2h-4.2L7.6 20v-3.2a3.2 3.2 0 0 1-3.2-3.2V9.2A3.2 3.2 0 0 1 7.6 6z"/>' },
  refresh: { d: '<path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4"/><path d="M19.6 4.4v4.7h-4.7"/>' },
  expand: { d: '<path d="M4 9.5V4h5.5"/><path d="M20 14.5V20h-5.5"/><path d="M20 9.5V4h-5.5"/><path d="M4 14.5V20h5.5"/>' },
  shrink: { d: '<path d="M9.5 4v5.5H4"/><path d="M14.5 20v-5.5H20"/><path d="M14.5 4v5.5H20"/><path d="M9.5 20v-5.5H4"/>' }
};

export function svg(name, size = 22, strokeWidth) {
  const item = ICONS[name] || {};
  const sw = strokeWidth || item.sw || 1.7;
  const fill = item.fill ? 'currentColor' : 'none';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${item.d || ''}</svg>`;
}

export function icon(name, size = 22, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = svg(name, size);
  return span;
}
