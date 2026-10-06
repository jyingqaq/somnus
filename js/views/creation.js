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

  // 判据收在 store.isCollected（bookId 指向的书真的还在才算已收藏），
  // 与首页列表的书签图标同源 —— 各写一份的话，书架里删过书之后两边就会打架。
  const collected = store.isCollected(item);

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
            confirmLabel: '取消收藏',
            // 别用默认的「取消」：跟「取消收藏」并排，一眼扫过去分不清哪颗才是真动作
            cancelLabel: '再想想'
          });
          if (!ok) return;
          // 删书 + 清指针是一件事，走 store 的同一条收尾，不在这里手工拆两步
          store.uncollectCreation(item);
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
          store.collectCreation(item);
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
        store.removeBooks(item.bookId);
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
