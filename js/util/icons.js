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
  /* 载入 / 导出：箭头落入托盘 */
  load: { d: '<path d="M4.6 13.8v3.9a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3.9"/><path d="M12 3.9v9.6"/><path d="M8.2 9.7 12 13.5l3.8-3.8"/>' },
  /* 上传 / 导入：与 load 镜像，箭头从托盘向上送出 */
  upload: { d: '<path d="M4.6 13.8v3.9a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3.9"/><path d="M12 13.5V3.9"/><path d="M8.2 7.7 12 3.9l3.8 3.8"/>' },
  /* 复制：两张错开的纸 */
  copy: {
    d:
      '<rect x="8.6" y="8.6" width="11" height="11" rx="2.2"/>'
      + '<path d="M15.4 5.7a2.2 2.2 0 0 0-2.2-2.2H6a2.2 2.2 0 0 0-2.2 2.2v7.2a2.2 2.2 0 0 0 2.2 2.2"/>'
  },
  bulb: { d: '<path d="M9.4 17.5h5.2M10.3 20.5h3.4"/><path d="M12 3.5a5.6 5.6 0 0 0-3.3 10.1v2.4h6.6v-2.4A5.6 5.6 0 0 0 12 3.5z"/>' },
  /*
   * 世界书：简笔画地球 —— 外圆 + 赤道 + 一条完整子午线椭圆。
   * 之前是「圆 + 中间竖线 + 上下两道纬线弧」，弧线一多在小尺寸下就糊成一个灯笼，去掉了。
   */
  globe: {
    d:
      '<circle cx="12" cy="12" r="8.5"/>'
      + '<path d="M3.5 12h17"/>'
      + '<ellipse cx="12" cy="12" rx="4.4" ry="8.5"/>'
  },
  mask: { d: '<path d="M4 5.5h7v6a3.5 3.5 0 0 1-7 0z"/><path d="M13 12.5h7v6a3.5 3.5 0 0 1-7 0z"/><path d="M6.6 9h1.6M15.6 16h1.6"/>' },
  /**
   * 角色：两个半身小人，后面那个整体上移右移，只画出露在前面的部分（右半边头 + 右肩），
   * 其余被前面这个挡住。无五官。
   *
   * 两个还原要点（试过好几版才顺眼）：
   * - 后面的头顶要画成**完整的右半圆**（一条 a…0 0 1 弧），不要画成贴着前人头圆的一小段月牙，
   *   否则 22px 下就是两根看不出形状的碎弧。
   * - 后面那个要比前面**高一点**（头高 0.85、肩高 0.5），平齐会读成并排的两个人，
   *   错开才有「在后面」的纵深感。
   */
  person: {
    d:
      // 前面的人：肩 + 头
      '<path d="M16.1 20.9v-1.5a4.3 4.3 0 0 0-4.3-4.3H6.9a4.3 4.3 0 0 0-4.3 4.3v1.5"/>'
      + '<circle cx="9.7" cy="8.1" r="3.85"/>'
      // 后面的人：只画露出来的右肩与右半边头
      + '<path d="M21.4 20.4v-1.4a4.2 4.2 0 0 0-3.1-4.04"/>'
      + '<path d="M15.8 3.4a3.9 3.9 0 0 1 0 7.8"/>'
  },
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
  shrink: { d: '<path d="M9.5 4v5.5H4"/><path d="M14.5 20v-5.5H20"/><path d="M14.5 4v5.5H20"/><path d="M9.5 20v-5.5H4"/>' },
  /* 更多：竖排三点。圆点自带 fill/stroke 覆盖，svg 根上的 none 只是兜底 */
  more: {
    d:
      '<circle cx="12" cy="5.6" r="1.45" fill="currentColor" stroke="none"/>'
      + '<circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none"/>'
      + '<circle cx="12" cy="18.4" r="1.45" fill="currentColor" stroke="none"/>'
  },
  /* 下载 / 安装：与 upload 同构，箭头落向托盘，托盘底部加一道安装基座 */
  download: {
    d:
      '<path d="M4.6 13.8v3.9a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3.9"/>'
      + '<path d="M12 3.9v9.6"/>'
      + '<path d="M8.2 9.7 12 13.5l3.8-3.8"/>'
      + '<path d="M4.2 20.6h15.6"/>'
  }
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
