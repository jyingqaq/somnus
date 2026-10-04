/** 设置 · 更新日志（弹窗只弹一次，这里随时能回看） */

import { h } from '../util/dom.js';
import { topbar } from '../components/topbar.js';
import { back } from '../router.js';
import { updates, updateItem } from '../services/updateNotice.js';

export function render() {
  const page = h('div', { class: 'page' });
  page.appendChild(topbar({
    title: '更新日志',
    back: true,
    align: 'center',
    onBack: () => back('/settings')
  }));

  const list = updates();
  if (!list.length) {
    page.appendChild(h('div', { class: 'empty', text: '还没有更新记录' }));
    return page;
  }

  // 列表与弹窗共用 updateItem()，只有最新那条多一个「最新」小标
  page.appendChild(h('div', { class: 'card' },
    list.map((it, i) => updateItem(it, i === 0 ? '最新' : ''))
  ));
  return page;
}
