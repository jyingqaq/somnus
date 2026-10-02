/** 顶栏构造器（左 / 中 / 右三栏，居中模式下左右等宽，标题真正居中） */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { back } from '../router.js';

/**
 * @param {object} o
 * @param {string} [o.title]
 * @param {boolean} [o.back] 显示返回键
 * @param {'center'|'left'} [o.align]
 * @param {boolean} [o.hero] 大标题（仅 left 模式有意义）
 * @param {Array<{icon?:string,text?:string,kind?:string,onClick:Function}>} [o.actions]
 * @param {Function} [o.onBack]
 */
export function topbar({ title = '', back: showBack = false, align = 'left', hero = false, actions = [], onBack }) {
  const bar = h('div', { class: `topbar ${align === 'center' ? 'center' : 'left'}` });
  const left = h('div', { class: 'tb-side tb-left' });
  const right = h('div', { class: 'tb-side tb-right' });

  if (showBack) {
    left.appendChild(h('button', {
      class: 'tb-btn',
      onClick: () => (onBack ? onBack() : back('/home'))
    }, icon('back', 22)));
  }

  actions.forEach((a) => {
    const btn = h('button', {
      class: `tb-btn ${a.kind || ''} ${a.text ? 'text' : ''}`.trim(),
      // 把事件透出去：要挂下拉菜单的按钮靠 e.currentTarget 定位自己
      onClick: (e) => a.onClick(e, btn),
      title: a.label || ''
    }, a.text ? a.text : icon(a.icon, 21));
    right.appendChild(btn);
  });

  bar.append(
    left,
    h('div', { class: `tb-title${hero ? ' hero' : ''}`, text: title }),
    right
  );

  return bar;
}
