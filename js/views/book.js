/** 书籍详细：标题 / 简介 / 目录 / 续写 */

import { h, clear, debounce } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, showConfirm } from '../components/modal.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { toast } from '../components/toast.js';
import { buildContinuePrompt } from '../services/prompt.js';
import { ask } from '../services/ai.js';
import { navigate, back } from '../router.js';

export function render({ params }) {
  const page = h('div', { class: 'page' });
  const book = store.get('books', params.id);
  if (!book) return page;

  const barSlot = h('div', { class: 'bar-slot' });
  const bodySlot = h('div');
  let selecting = false;
  const picked = new Set();

  /* ---------- 简介（自动保存） ---------- */
  const intro = h('textarea', {
    class: 'field-area book-intro',
    placeholder: '简介',
    spellcheck: 'false'
  });
  intro.value = book.intro || '';
  const saveIntro = debounce(() => {
    store.update('books', book.id, { intro: intro.value });
  }, 500);
  intro.addEventListener('input', saveIntro);
  intro.addEventListener('blur', () => store.update('books', book.id, { intro: intro.value }));

  /* ---------- 续写 ---------- */
  async function continueWrite() {
    const current = store.get('books', book.id);
    const nextNo = (current.chapters || []).length + 1;
    const values = await showForm({
      title: '续写',
      fields: [
        { key: 'chapterTitle', label: '章节标题', value: store.chapterTitle(nextNo), required: false },
        { key: 'direction', label: '剧情走向', type: 'textarea', placeholder: '剧情走向', rows: 5 }
      ],
      submitLabel: '开始创作'
    });
    if (!values) return;

    const { system, user } = buildContinuePrompt({
      book: current,
      direction: values.direction
    });

    showLoading('创作中');
    try {
      const text = await ask({ system, user });
      store.addChapter(book.id, {
        title: values.chapterTitle || store.chapterTitle(nextNo),
        content: text
      });
      toast('已新增章节');
      draw();
    } catch (e) {
      toast(e.message || '创作失败');
    } finally {
      hideLoading();
    }
  }

  /* ---------- 顶部与正文 ---------- */
  function draw() {
    clear(barSlot);
    clear(bodySlot);
    const fresh = store.get('books', book.id);
    const chapters = fresh.chapters || [];

    if (selecting) {
      barSlot.appendChild(topbar({
        title: `已选 ${picked.size}`,
        back: false,
        align: 'left',
        hero: true,
        onBack: () => back('/shelf'),
        actions: [
          { text: '取消', onClick: () => { selecting = false; picked.clear(); draw(); } },
          {
            icon: 'trash',
            kind: 'danger',
            onClick: async () => {
              if (!picked.size) return;
              const ok = await showConfirm({ title: '删除章节', message: `共 ${picked.size} 章` });
              if (!ok) return;
              store.removeChapters(book.id, [...picked]);
              toast('已删除');
              selecting = false;
              picked.clear();
              draw();
            }
          }
        ]
      }));
    } else {
      barSlot.appendChild(topbar({
        title: '书籍详细',
        back: true,
        align: 'center',
        onBack: () => back('/shelf'),
        actions: chapters.length ? [{ icon: 'trash', onClick: () => { selecting = true; draw(); } }] : []
      }));
    }

    /* 书名 */
    bodySlot.appendChild(h('div', {
      class: 'book-title',
      text: fresh.title || '未命名',
      onClick: async () => {
        const values = await showForm({
          title: '书名',
          fields: [{ key: 'title', label: '书名', value: fresh.title || '' }],
          submitLabel: '保存'
        });
        if (!values) return;
        store.update('books', book.id, { title: values.title });
        draw();
      }
    }));

    /* 简介 */
    bodySlot.appendChild(intro);
    bodySlot.appendChild(h('div', { style: { height: '18px' } }));

    /* 目录 */
    const card = h('div', { class: 'card' });
    if (!chapters.length) {
      card.appendChild(h('div', { class: 'empty', text: '暂无章节' }));
    } else {
      const list = h('div', { class: 'list' }, chapters.map((c, i) => h('div', {
        class: 'row' + (picked.has(c.id) ? ' picked' : ''),
        onClick: () => {
          if (selecting) {
            if (picked.has(c.id)) picked.delete(c.id);
            else picked.add(c.id);
            draw();
          } else {
            navigate(`/book/${book.id}/chapter/${c.id}`);
          }
        }
      },
        selecting ? h('span', { class: 'pick' }, icon('check', 13)) : h('span', {
          class: 'ico row-ico',
          style: { width: '22px', fontSize: '13px', color: 'var(--dim)' },
          text: String(i + 1)
        }),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: c.title }),
          h('div', { class: 'row-sub', text: (c.content || '').slice(0, 40) })
        ),
        selecting ? null : h('span', { class: 'chev' }, icon('chev', 18))
      )));
      card.appendChild(list);
    }
    bodySlot.appendChild(card);
    bodySlot.appendChild(h('div', { style: { height: '18px' } }));

    /* 续写 */
    if (!selecting) {
      bodySlot.appendChild(h('button', {
        class: 'btn primary block',
        onClick: continueWrite
      }, icon('spark', 19), h('span', { text: '续写' })));
    }
  }

  page.append(barSlot, bodySlot);
  draw();
  return page;
}
