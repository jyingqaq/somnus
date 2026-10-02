/**
 * 锚定在按钮下方的下拉菜单。
 *
 * 用 fixed 定位挂在 body 上，而不是塞进按钮的父容器：
 * 顶栏是 sticky + backdrop-filter，会给后代建层叠上下文，absolute 子菜单会被裁掉。
 *
 * items: [{ label, sub?, iconName?, danger?, disabled?, onClick? }]
 *        用 divider: true 的一项插入分隔线。
 */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';

let open = null;

function close() {
  if (!open) return;
  const { panel, cleanup } = open;
  open = null;
  cleanup();
  panel.remove();
}

/**
 * @param {object} o
 * @param {HTMLElement} o.anchor 触发按钮
 * @param {Array} o.items 菜单项
 * @param {'right'|'left'} [o.align] 默认右对齐（顶栏右侧按钮）
 * @param {string} [o.width] 菜单宽度
 */
export function dropdown({ anchor, items, align = 'right', width }) {
  // 同一个按钮再点一次 = 收起
  if (open && open.anchor === anchor) { close(); return null; }
  close();

  const panel = h('div', { class: 'dd-menu', style: width ? { width } : null });

  items.forEach((it) => {
    if (it.divider) {
      panel.appendChild(h('div', { class: 'dd-div' }));
      return;
    }
    const btn = h('button', {
      class: 'dd-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : ''),
      onClick: () => {
        if (it.disabled) return;
        close();
        if (it.onClick) it.onClick();
      }
    },
      it.iconName ? icon(it.iconName, 18, 'ico') : null,
      h('span', { class: 'dd-label' },
        h('span', { class: 'dd-title', text: it.label }),
        it.sub ? h('span', { class: 'dd-sub', text: it.sub }) : null
      )
    );
    panel.appendChild(btn);
  });

  document.body.appendChild(panel);

  // 贴着按钮摆：默认落在下方，空间不够就翻到上方
  const r = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const gap = 6;

  let left = align === 'right' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));

  let top = r.bottom + gap;
  if (top + ph > window.innerHeight - 8 && r.top - gap - ph > 8) {
    top = r.top - gap - ph;
  }

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  if (align === 'right') panel.classList.add('right');
  if (r.top - gap - ph <= 8 && top === r.bottom + gap) panel.classList.add('up');

  // 点外面 / 滚一下 / 按 Esc 都收起
  const onDown = (e) => {
    if (!panel.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  setTimeout(() => {
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
  }, 0);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  open = {
    anchor,
    panel,
    cleanup: () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    }
  };

  return { close, panel };
}

export function closeDropdown() {
  close();
}
