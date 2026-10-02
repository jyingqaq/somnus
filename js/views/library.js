/** 角色 / 世界书 / 灵感 通用管理页（含文件夹分组） */

import { h, clear } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, showConfirm, showSheet } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { back } from '../router.js';

export function render({ params }) {
  const meta = Object.values(store.COLLECTIONS).find((m) => m.key === params.type);
  const page = h('div', { class: 'page' });
  if (!meta) return page;

  const barSlot = h('div');
  const bodySlot = h('div');
  const fabSlot = h('div');
  let folderId = '';

  const folderOptions = () => [
    { value: '', label: '未分类' },
    ...store.listFolders(meta.key).map((f) => ({ value: f.id, label: f.name }))
  ];

  /* ---------------- 条目 ---------------- */

  async function createItem() {
    const values = await showForm({
      title: `新建${meta.label}`,
      fields: [
        { key: 'title', label: '标题', placeholder: '标题' },
        { key: 'detail', label: '详细内容', type: 'textarea', placeholder: meta.placeholder, rows: 8 },
        // select 的「未分类」是空字符串，属于合法取值，不参与必填校验
        { key: 'folderId', label: '文件夹', type: 'select', value: folderId, options: folderOptions(), required: false }
      ],
      submitLabel: '保存'
    });
    if (!values) return;
    store.add(meta.key, { title: values.title, detail: values.detail, folderId: values.folderId });
    toast('已保存');
    draw();
  }

  async function editItem(item) {
    const values = await showForm({
      title: item.title,
      fields: [
        { key: 'title', label: '标题', value: item.title },
        { key: 'detail', label: '详细内容', type: 'textarea', value: item.detail, rows: 10, minHeight: '200px' },
        { key: 'folderId', label: '文件夹', type: 'select', value: item.folderId || '', options: folderOptions(), required: false }
      ],
      submitLabel: '保存',
      dangerLabel: '删除'
    });
    if (!values) return;
    if (values.__danger) {
      const ok = await showConfirm({ title: '删除', message: item.title });
      if (!ok) return;
      store.remove(meta.key, item.id);
      toast('已删除');
    } else {
      store.update(meta.key, item.id, {
        title: values.title,
        detail: values.detail,
        folderId: values.folderId
      });
      toast('已保存');
    }
    draw();
  }

  /* ---------------- 文件夹 ---------------- */

  async function createFolder() {
    const values = await showForm({
      title: '新建文件夹',
      fields: [{ key: 'name', label: '名称', placeholder: '文件夹名称' }],
      submitLabel: '创建'
    });
    if (!values) return;
    store.addFolder(meta.key, values.name);
    toast('已创建');
    draw();
  }

  function folderMenu(folder) {
    showSheet({
      title: folder.name,
      items: [
        { label: '重命名', icon: 'edit', onClick: () => renameFolder(folder) },
        { label: '删除', icon: 'trash', onClick: () => deleteFolder(folder) }
      ]
    });
  }

  async function renameFolder(folder) {
    const values = await showForm({
      title: '重命名',
      fields: [{ key: 'name', label: '名称', value: folder.name }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.renameFolder(meta.key, folder.id, values.name);
    draw();
  }

  async function deleteFolder(folder) {
    const ok = await showConfirm({ title: '删除文件夹', message: `${folder.name}（其中条目会移到未分类）` });
    if (!ok) return;
    store.removeFolder(meta.key, folder.id);
    toast('已删除');
    draw();
  }

  /* ---------------- 渲染 ---------------- */

  function draw() {
    clear(barSlot);
    clear(bodySlot);
    clear(fabSlot);

    const folders = store.listFolders(meta.key);
    const current = folders.find((f) => f.id === folderId);

    barSlot.appendChild(topbar({
      title: current ? current.name : meta.label,
      back: true,
      align: 'center',
      onBack: () => (current ? (folderId = '', draw()) : back('/me')),
      actions: [{ icon: 'layers', kind: 'accent', onClick: createFolder }]
    }));

    if (current) {
      bodySlot.appendChild(h('div', { class: 'crumb' },
        h('span', { class: 'crumb-back', text: meta.label, onClick: () => { folderId = ''; draw(); } }),
        h('span', { text: '/' }),
        h('b', { text: current.name })
      ));
    }

    const card = h('div', { class: 'card' });
    const list = h('div', { class: 'list' });

    /* 根目录才显示文件夹 */
    if (!current) {
      folders.forEach((f) => {
        const count = store.list(meta.key).filter((it) => it.folderId === f.id).length;
        list.appendChild(h('div', {
          class: 'folder-row',
          onClick: () => { folderId = f.id; draw(); }
        },
          icon('layers', 20, 'ico icon-folder'),
          h('div', { class: 'fo-main' },
            h('div', { class: 'fo-name', text: f.name }),
            h('div', { class: 'fo-count', text: `${count} 项` })
          ),
          h('button', {
            class: 'fo-op',
            onClick: (e) => { e.stopPropagation(); folderMenu(f); }
          }, icon('edit', 18))
        ));
      });
    }

    /* 条目 */
    const items = store.itemsIn(meta.key, current ? current.id : '');
    items.forEach((it) => {
      list.appendChild(h('div', { class: 'row', onClick: () => editItem(it) },
        icon(meta.icon, 20, 'ico row-ico'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: it.title }),
          h('div', { class: 'row-sub', text: (it.detail || '').slice(0, 30) })
        ),
        h('span', { class: 'chev' }, icon('chev', 18))
      ));
    });

    if (!list.childNodes.length) {
      card.appendChild(h('div', { class: 'empty', text: '暂无内容' }));
    } else {
      card.appendChild(list);
    }
    bodySlot.appendChild(card);

    fabSlot.appendChild(h('button', { class: 'fab', onClick: createItem }, icon('plus', 26)));
  }

  page.append(barSlot, bodySlot, fabSlot);
  draw();
  return page;
}
