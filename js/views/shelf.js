/** 书架 · 书籍列表 */

import { h, fmtTime, clear } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showConfirm } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';

export function render() {
  const page = h('div', { class: 'page' });
  const barSlot = h('div');
  const listSlot = h('div');
  let selecting = false;
  const picked = new Set();

  function exitSelect() {
    selecting = false;
    picked.clear();
    draw();
  }

  function draw() {
    clear(barSlot);
    clear(listSlot);

    const books = store.list('books');

    /* --- 顶栏 --- */
    if (selecting) {
      barSlot.appendChild(topbar({
        title: `已选 ${picked.size}`,
        align: 'left',
        hero: true,
        actions: [
          { text: '取消', onClick: exitSelect },
          {
            icon: 'trash',
            kind: 'danger',
            onClick: async () => {
              if (!picked.size) return;
              const ok = await showConfirm({ title: '删除书籍', message: `共 ${picked.size} 本` });
              if (!ok) return;
              store.remove('books', [...picked]);
              toast('已删除');
              exitSelect();
            }
          }
        ]
      }));
    } else {
      barSlot.appendChild(topbar({
        title: '我的书架',
        align: 'left',
        hero: true,
        actions: books.length ? [{
          icon: 'trash',
          onClick: () => { selecting = true; draw(); }
        }] : []
      }));
    }

    /* --- 列表 --- */
    if (!books.length) {
      listSlot.appendChild(h('div', { class: 'empty', text: '书架还是空的' }));
      return;
    }

    const card = h('div', { class: 'card' });
    const list = h('div', { class: 'list' });

    books.forEach((book) => {
      const row = h('div', {
        class: 'row' + (picked.has(book.id) ? ' picked' : ''),
        onClick: () => {
          if (selecting) {
            if (picked.has(book.id)) picked.delete(book.id);
            else picked.add(book.id);
            draw();
          } else {
            navigate(`/book/${book.id}`);
          }
        }
      },
        selecting ? h('span', { class: 'pick' }, icon('check', 13)) : null,
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: book.title || '未命名' }),
          h('div', { class: 'row-sub', text: `${book.chapters.length} 章 · ${fmtTime(book.createdAt)}` })
        ),
        selecting ? null : h('span', { class: 'chev' }, icon('chev', 18))
      );
      list.appendChild(row);
    });

    card.appendChild(list);
    listSlot.appendChild(card);
  }

  page.append(barSlot, listSlot);
  draw();
  return page;
}
