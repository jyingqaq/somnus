/** 首页条目详情（AI 返回内容） */

import { h } from '../util/dom.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { toast } from '../components/toast.js';
import { showConfirm } from '../components/modal.js';
import { navigate, back, reload } from '../router.js';

export function render({ params }) {
  const item = store.get('creations', params.id);
  const page = h('div', { class: 'page' });
  if (!item) return page;

  const collected = !!(item.bookId && store.get('books', item.bookId));

  const actions = [
    collected
      ? {
        // 已收藏：再点即取消收藏，把书从书架删掉
        icon: 'starFill',
        kind: 'accent',
        onClick: async () => {
          const ok = await showConfirm({
            title: '取消收藏',
            message: item.title,
            confirmLabel: '取消收藏'
          });
          if (!ok) return;
          store.remove('books', item.bookId);
          store.update('creations', item.id, { bookId: '' });
          toast('已移出书架');
          reload();
        }
      }
      : {
        icon: 'star',
        onClick: async () => {
          const ok = await showConfirm({
            title: '加入书架',
            message: item.title,
            confirmLabel: '收藏'
          });
          if (!ok) return;
          // 书名 = 创作标题（首页标题输入框那个），正文进第 1 章，章节名固定「第1章」
          const book = store.addBookFromCreation(item);
          store.update('creations', item.id, { bookId: book.id });
          toast('已加入书架');
          reload();
        }
      },
    {
      icon: 'trash',
      kind: 'danger',
      onClick: async () => {
        const ok = await showConfirm({ title: '删除', message: item.title });
        if (!ok) return;
        if (item.bookId) store.remove('books', item.bookId);
        store.remove('creations', item.id);
        navigate('/home');
      }
    }
  ];

  page.append(
    topbar({ title: item.title, back: true, align: 'center', actions, onBack: () => back('/home') }),
    h('div', { class: 'reader', text: item.content })
  );

  return page;
}
