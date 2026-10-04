/**
 * 「角色 / 世界书 / 灵感」的文件夹行与条目行。
 *
 * 管理页（views/library.js）和首页输入框的选取面板（components/collectionPicker.js）
 * 渲染的是同一套结构，所以行做成公用件 —— 两边各写一份的话，改类名时漏一处就是
 * 「看着还在、样式全丢」的静默 bug（.folder-row / .fo-name / .fo-count 这些类名
 * 全在 css/components.css 的「文件夹」一节里）。
 */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';

/**
 * 文件夹行：文件夹图标 + 名称 + 条目数
 * @param {object} o
 * @param {string} o.name
 * @param {number} o.count 其中条目数（显示成「N 项」）
 * @param {Function} o.onClick 点整行
 * @param {Function} [o.onMenu] 给了才显示右侧那个操作钮（管理页用它重命名 / 删除）
 * @param {boolean} [o.openable] 右侧显示箭头，表示「点进去」（选取面板用）
 */
export function folderRow({ name, count, onClick, onMenu, openable = false }) {
  return h('div', { class: 'folder-row', onClick },
    icon('layers', 20, 'ico icon-folder'),
    h('div', { class: 'fo-main' },
      h('div', { class: 'fo-name', text: name }),
      h('div', { class: 'fo-count', text: `${count} 项` })
    ),
    onMenu
      ? h('button', {
        class: 'fo-op',
        onClick: (e) => { e.stopPropagation(); onMenu(); }
      }, icon('edit', 18))
      : (openable ? h('span', { class: 'chev' }, icon('chev', 18)) : null)
  );
}

/** 条目行：图标 + 标题 + 摘要 + 箭头 */
export function itemRow({ iconName, title, sub, onClick }) {
  return h('div', { class: 'row', onClick },
    icon(iconName, 20, 'ico row-ico'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', text: title }),
      h('div', { class: 'row-sub', text: sub || '' })
    ),
    h('span', { class: 'chev' }, icon('chev', 18))
  );
}
