/** 首页 · 生成剧情 */

import { h, clear, fmtTime, debounce } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { createEditor } from '../components/editor.js';
import { createComposeBox } from '../components/composeBox.js';
import { showForm, showSheet, showAlert } from '../components/modal.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { toast } from '../components/toast.js';
import { buildCreatePrompt } from '../services/prompt.js';
import { ask } from '../services/ai.js';
import { navigate } from '../router.js';
import { topbar } from '../components/topbar.js';

export function render() {
  const page = h('div', { class: 'page' });

  const titleInput = h('input', {
    class: 'field',
    placeholder: '标题',
    autocomplete: 'off',
    spellcheck: 'false'
  });
  const editor = createEditor({ placeholder: '详细要求' });

  /* ---------- 草稿：切页返回不丢 ---------- */
  const draft = store.getState().draft || { title: '', html: '' };
  titleInput.value = draft.title || '';
  editor.setHTML(draft.html || '');

  const saveDraft = debounce(() => {
    store.patchDraft({ title: titleInput.value, html: editor.getHTML() });
  }, 400);
  titleInput.addEventListener('input', saveDraft);
  editor.el.addEventListener('input', saveDraft);

  /* ---------- 功能：角色 / 世界书 / 灵感 / 保存 / 载入 ---------- */
  function pickCollection(type) {
    const meta = store.COLLECTIONS[type];
    const items = store.list(meta.key).map((it) => ({
      label: it.title,
      sub: (it.detail || '').slice(0, 24),
      icon: meta.icon,
      onClick: () => editor.insertChip(type, it.title)
    }));
    showSheet({ title: meta.label, items });
  }

  async function savePreset() {
    const values = await showForm({
      title: '保存预设',
      fields: [{ key: 'title', label: '预设标题', placeholder: '标题' }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.add('presets', {
      title: values.title,
      fieldTitle: titleInput.value,
      html: editor.getHTML()
    });
    toast('已保存');
  }

  function loadPreset() {
    const items = store.list('presets').map((p) => ({
      id: p.id,
      label: p.title,
      sub: fmtTime(p.createdAt),
      icon: 'load',
      onClick: () => {
        titleInput.value = p.fieldTitle || '';
        editor.setHTML(p.html || '');
        saveDraft();
      }
    }));
    showSheet({
      title: '载入预设',
      items,
      // 长按进多选、批量删；面板不重开，删完自己刷新
      confirmTitle: '删除预设',
      onDelete: (ids) => {
        store.remove('presets', ids);
        toast(`已删除 ${ids.length} 个预设`);
      }
    });
  }

  const box = createComposeBox({
    editor,
    actions: [
      { key: 'role', label: '角色', icon: 'person', onClick: () => pickCollection('role') },
      { key: 'world', label: '世界书', icon: 'globe', onClick: () => pickCollection('world') },
      { key: 'idea', label: '灵感', icon: 'bulb', onClick: () => pickCollection('idea') },
      { key: 'save', label: '保存', icon: 'save', onClick: savePreset },
      { key: 'load', label: '载入', icon: 'load', onClick: loadPreset }
    ]
  });

  /* ---------- 生成 ---------- */
  const createBtn = h('button', { class: 'btn primary block', text: '生成剧情' });

  async function doCreate() {
    const request = editor.serialize();
    if (!request) { toast('请输入详细要求'); return; }
    const title = (titleInput.value || '').trim() || '未命名';
    const { system, user } = buildCreatePrompt({ title: titleInput.value.trim(), content: request });

    showLoading('创作中');
    try {
      const text = await ask({ system, user });
      const item = store.add('creations', { title, request, content: text });
      titleInput.value = '';
      editor.clear();
      store.patchDraft({ title: '', html: '' });
      renderList();
      showAlert('创作完成', item.title, '查看').then((ok) => {
        if (ok) navigate(`/creation/${item.id}`);
      });
    } catch (e) {
      toast(e.message || '创作失败');
    } finally {
      hideLoading();
    }
  }
  createBtn.addEventListener('click', doCreate);

  /* ---------- 创作条目 ---------- */
  const listCard = h('div', { class: 'card' });
  function renderList() {
    clear(listCard);
    const items = store.list('creations');
    if (!items.length) return;
    listCard.appendChild(h('div', { class: 'list' }, items.map((it) => h('div', {
      class: 'row',
      onClick: () => navigate(`/creation/${it.id}`)
    },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: it.title }),
        h('div', { class: 'row-sub', text: fmtTime(it.createdAt) })
      ),
      it.bookId ? icon('bookmark', 18, 'ico row-ico') : null,
      h('span', { class: 'chev' }, icon('chev', 18))
    ))));
  }
  renderList();

  page.append(
    topbar({ title: '创作', align: 'left', hero: true }),
    titleInput,
    h('div', { style: { height: '10px' } }),
    box.el,
    h('div', { style: { height: '16px' } }),
    createBtn,
    h('div', { style: { height: '16px' } }),
    listCard
  );

  return page;
}
