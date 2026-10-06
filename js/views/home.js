/** 首页 · 生成剧情 */

import { h, clear, fmtTime, debounce } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { createEditor } from '../components/editor.js';
import { createComposeBox } from '../components/composeBox.js';
import { showForm, showSheet, showAlert } from '../components/modal.js';
import { createBusyButton } from '../components/loading.js';
import { pickCollection } from '../components/collectionPicker.js';
import { toast } from '../components/toast.js';
import { buildCreatePrompt } from '../services/prompt.js';
import { ask } from '../services/ai.js';
import { requireApi } from '../components/apiGate.js';
import { navigate } from '../router.js';
import { topbar } from '../components/topbar.js';

/**
 * 「生成剧情」的忙态控制器：等待期间按钮自己变成不可点的「创作中……」，
 * 不再盖全屏遮罩 —— 用户可以去别的页面干别的，不必盯着转圈。
 * 做成模块级单例是为了「离开首页再回来」：那时按钮是重新渲染出来的新节点，
 * attach() 会把它接过来，忙态才不会丢（细节见 components/loading.js）。
 */
const createBusy = createBusyButton('生成剧情');

/**
 * 当前挂载的那份首页的「收尾入口」。
 * 生成是异步的，用户可能在等待期间离开再回来 —— 那时输入框已经是新渲染的一份了，
 * 收尾（清空输入、刷新列表）必须对着**现在这份**做，闭包里那份已经不在 DOM 上。
 */
let mounted = null;

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
  /*
   * 挑角色 / 世界书 / 灵感的面板走 components/collectionPicker.js ——
   * 它和「我的」页里的管理页共用同一套文件夹分组（根目录先文件夹，进去只列该文件夹的条目），
   * 不能再在这里 store.list() 全量平铺。
   */
  const pick = (type) => pickCollection({
    type,
    onPick: (it) => editor.insertChip(type, it.title)
  });

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
      { key: 'role', label: '角色', icon: 'person', onClick: () => pick('role') },
      { key: 'world', label: '世界书', icon: 'globe', onClick: () => pick('world') },
      { key: 'idea', label: '灵感', icon: 'bulb', onClick: () => pick('idea') },
      { key: 'save', label: '保存', icon: 'save', onClick: savePreset },
      { key: 'load', label: '载入', icon: 'load', onClick: loadPreset }
    ]
  });

  /* ---------- 生成 ---------- */
  const createBtn = h('button', { class: 'btn primary block', text: '生成剧情' });

  async function doCreate() {
    // 忙态里按钮本来就是 disabled，这里挡的是其它触发路径（回车、脚本等）
    if (createBusy.busy) return;
    const request = editor.serialize();
    if (!request) { toast('请输入详细要求'); return; }
    const titleRaw = titleInput.value.trim();
    // 必须在 start() 之前：没配好就直接说清楚，否则用户会先被晾在「创作中」
    if (!requireApi()) return;
    const snapshot = `${titleRaw}\u0000${request}`;
    const title = titleRaw || '未命名';
    const { system, user } = buildCreatePrompt({ title: titleRaw, content: request });

    createBusy.start();
    try {
      const text = await ask({ system, user });
      const item = store.add('creations', { title, request, content: text });
      // 收尾对着**当前挂载**的那份做：等待期间用户可能离开首页又回来，
      // 也可能回来后就着手写新的要求了 —— 那样就不能把他刚写的字清掉。
      // 所以只在「现在这份里还是当初提交的那一份要求」时才清空。
      if (mounted && mounted.snapshot() === snapshot) {
        mounted.reset();
        store.patchDraft({ title: '', html: '' });
      }
      if (mounted) mounted.renderList();
      showAlert('创作完成', item.title, '查看').then((ok) => {
        if (ok) navigate(`/creation/${item.id}`);
      });
    } catch (e) {
      toast(e.message || '创作失败');
    } finally {
      createBusy.done();
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
      // 书签图标表示「已收藏到书架」。判据必须和详情页那颗星标同源（store.isCollected：
      // bookId 指向的书真的还在），别在这儿另写一套 `it.bookId ? …` ——
      // 两处各判各的，早晚会在某个边界上打架（书架删书、老存档、恢复备份……）。
      // 悬空的指针本身也已经在 store 侧清掉（removeBooks / migrate），这里是同一件事的第二道。
      store.isCollected(it) ? icon('bookmark', 18, 'ico row-ico') : null,
      h('span', { class: 'chev' }, icon('chev', 18))
    ))));
  }
  renderList();

  // 把这份实例交给收尾用；忙态也在这里补上（离开首页再回来时按钮会是忙的）
  mounted = {
    snapshot: () => `${titleInput.value.trim()}\u0000${editor.serialize()}`,
    reset: () => { titleInput.value = ''; editor.clear(); },
    renderList
  };
  createBusy.attach(createBtn);

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
