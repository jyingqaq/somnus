/** 角色 / 世界书 / 灵感 通用管理页（含文件夹分组） */

import { h, clear } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, showConfirm, showSheet } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { DOC_ACCEPT, readDocFiles, joinDocs, formatCount } from '../services/docImport.js';
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

  /* ---------------- 导入文档 ---------------- */

  /**
   * 「从文档导入」按钮：读 txt / md / docx，把文字塞进同一表单的「详细内容」。
   * 标题故意不填 —— 那是用户自己的命名，猜错了反而要删。
   * @param {{inputs:object, setValue:Function}} ctx showForm 的 custom 字段上下文
   */
  function importButton({ inputs, setValue }) {
    const area = inputs.detail;
    const fileInput = h('input', { type: 'file', accept: DOC_ACCEPT, multiple: true, style: { display: 'none' } });

    const status = h('div', { class: 'imp-status' });
    const btn = h('button', { class: 'imp-btn', type: 'button', onClick: () => fileInput.click() },
      icon('load', 18),
      h('span', { text: '从文档导入' })
    );

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = ''; // 清掉，否则连选同一个文件不会再触发 change
      if (!files.length) return;

      btn.disabled = true;
      status.textContent = '正在读取…';

      const { items, errors } = await readDocFiles(files);

      if (items.length) {
        // 已有内容就往后接，别把用户刚敲的字冲掉
        const old = (area.value || '').trim();
        const next = [old, joinDocs(items)].filter(Boolean).join('\n\n');
        setValue('detail', next);
        status.textContent = `已导入 ${items.length} 个文件 · ${formatCount(next.length)}，标题请自己填写`;
      }

      // 成功的报个数，失败的把原因说清楚；只 toast 一次，别把同一个错误弹两遍
      if (errors.length) {
        const why = errors.length > 2 ? `${errors.slice(0, 2).join('；')} 等 ${errors.length} 个文件` : errors.join('；');
        status.textContent = items.length ? `${status.textContent}｜${errors.length} 个文件没导入成功` : why;
        toast(why);
      } else if (items.length) {
        toast(`已导入 ${formatCount(items.reduce((n, it) => n + it.text.length, 0))}`);
      }

      btn.disabled = false;
    });

    return h('div', { class: 'imp' },
      h('span', { class: 'form-label', text: '或从文档导入' }),
      btn,
      h('div', { class: 'imp-hint', text: '支持 txt / md / docx 等，可多选；文字会填进上面的「详细内容」，标题仍需自己填写' }),
      status,
      fileInput
    );
  }

  /* ---------------- 条目 ---------------- */

  async function createItem() {
    const values = await showForm({
      title: `新建${meta.label}`,
      fields: [
        { key: 'title', label: '标题', placeholder: '标题' },
        { key: 'detail', label: '详细内容', type: 'textarea', placeholder: meta.placeholder, rows: 8 },
        // select 的「未分类」是空字符串，属于合法取值，不参与必填校验
        { key: 'folderId', label: '文件夹', type: 'select', value: folderId, options: folderOptions(), required: false },
        { type: 'custom', render: importButton }
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
