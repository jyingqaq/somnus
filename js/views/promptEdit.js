/** 我的 · 提示词 · 块编辑器（长按拖动排序） */

import { h, clear, fmtTime } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, showConfirm, showSheet, openModal } from '../components/modal.js';
import { switchBox, listRow } from '../components/controls.js';
import { sortable } from '../components/sortable.js';
import { toast } from '../components/toast.js';
import { dropdown } from '../components/dropdown.js';
import { KINDS, DATA_BLOCKS, isDataBlock, previewPrompt } from '../services/prompt.js';
import { back } from '../router.js';

export function render({ params }) {
  const kind = KINDS[params.kind] ? params.kind : 'create';
  const meta = KINDS[kind];

  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  const cfg = () => store.promptOf(kind);
  /** 本页预设（只取当前这一类，别的类别的预设这里根本拿不到） */
  const presets = () => store.listPromptPresets(kind);

  /* ---------------- 系统提示词 ---------------- */

  async function editSystem() {
    const values = await showForm({
      title: '系统提示词',
      fields: [{
        key: 'system',
        label: '系统提示词',
        type: 'textarea',
        value: cfg().system || '',
        rows: 9,
        required: false
      }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.setPromptSystem(kind, values.system);
    draw();
  }

  /* ---------------- 块 ---------------- */

  async function addBlock() {
    const values = await showForm({
      title: '添加提示词块',
      fields: [
        { key: 'name', label: '块名称', placeholder: '例如：文风要求' },
        { key: 'text', label: '提示词内容', type: 'textarea', placeholder: '例如：语言克制，多用短句，重视环境描写。', rows: 7 }
      ],
      submitLabel: '添加'
    });
    if (!values) return;
    store.addPromptBlock(kind, { name: values.name, text: values.text });
    toast('已添加');
    draw();
  }

  async function editBlock(block) {
    const values = await showForm({
      title: '编辑提示词块',
      fields: [
        { key: 'name', label: '块名称', value: block.name },
        { key: 'text', label: '提示词内容', type: 'textarea', value: block.text || '', rows: 9 }
      ],
      submitLabel: '保存',
      dangerLabel: '删除'
    });
    if (!values) return;
    if (values.__danger) {
      const ok = await showConfirm({ title: '删除提示词块', message: block.name });
      if (!ok) return;
      store.removePromptBlock(kind, block.id);
      toast('已删除');
    } else {
      store.updatePromptBlock(kind, block.id, { name: values.name, text: values.text });
    }
    draw();
  }

  function preview() {
    const text = previewPrompt(kind);
    openModal({
      title: '预览',
      body: h('pre', { class: 'prompt-preview', text }),
      actions: [
        {
          label: '复制',
          onClick: () => {
            navigator.clipboard?.writeText(text).then(
              () => toast('已复制'),
              () => toast('复制失败')
            );
          }
        },
        { label: '关闭', kind: 'primary', onClick: (close) => close() }
      ]
    });
  }

  /* ---------------- 预设 ---------------- */

  /** 保存：把当前这份提示词存成一个预设，可反复切换 */
  async function savePreset() {
    const values = await showForm({
      title: `保存${meta.label}预设`,
      fields: [{
        key: 'name',
        label: '预设名称',
        placeholder: `例如：${meta.label}·日常 / ${meta.label}·细腻`
      }],
      submitLabel: '保存'
    });
    if (!values) return;

    // 同名要显式确认：预设往往是调了很久的，不该被一次误点冲掉。
    // 确认覆盖就把旧的删掉再存，避免留下两个同名预设。
    const dup = presets().find((p) => p.name === values.name);
    if (dup) {
      const ok = await showConfirm({
        title: '预设已存在',
        message: `这一页已经有「${values.name}」，要用当前提示词覆盖它吗？`,
        confirmLabel: '覆盖'
      });
      if (!ok) return;
      store.removePromptPreset(kind, dup.id);
    }

    store.savePromptPreset(kind, values.name);
    toast('已保存');
    draw();
  }

  /** 载入：从本页预设里挑一个恢复到当前 */
  function loadPreset() {
    const list = presets();
    if (!list.length) {
      // 空的也给个出路，直接把人送到保存那一步
      showSheet({
        title: '载入预设',
        items: [{
          label: '保存一份再载入',
          sub: `当前还没有${meta.label}预设`,
          icon: 'save',
          onClick: savePreset
        }]
      });
      return;
    }

    showSheet({
      title: `载入${meta.label}预设`,
      items: list.map((p) => ({
        label: p.name,
        sub: `${p.blocks.length} 块 · ${fmtTime(p.createdAt)}`,
        onClick: () => applyPreset(p)
      }))
    });
  }

  async function applyPreset(p) {
    // 载入是整份替换，先说清楚会覆盖掉现在手改的东西
    const ok = await showConfirm({
      title: '载入预设',
      message: `当前${meta.label}提示词将被「${p.name}」整份替换，未保存的改动会丢失。`,
      confirmLabel: '载入'
    });
    if (!ok) return;
    store.applyPromptPreset(kind, p.id);
    toast('已载入');
    draw();
  }

  /** 预设管理：重命名 / 删除 */
  function presetMenu(p) {
    showSheet({
      title: p.name,
      items: [
        { label: '载入这个预设', icon: 'load', onClick: () => applyPreset(p) },
        { label: '重命名', icon: 'edit', onClick: () => renamePreset(p) },
        { label: '删除', icon: 'trash', onClick: () => deletePreset(p) }
      ]
    });
  }

  async function renamePreset(p) {
    const values = await showForm({
      title: '重命名预设',
      fields: [{ key: 'name', label: '预设名称', value: p.name }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.renamePromptPreset(kind, p.id, values.name);
    toast('已重命名');
    draw();
  }

  async function deletePreset(p) {
    const ok = await showConfirm({ title: '删除预设', message: p.name });
    if (!ok) return;
    store.removePromptPreset(kind, p.id);
    toast('已删除');
    draw();
  }

  async function resetDefault() {
    const ok = await showConfirm({
      title: '恢复默认',
      message: `${meta.label}提示词将回到初始状态`,
      confirmLabel: '恢复'
    });
    if (!ok) return;
    store.resetPrompt(kind);
    toast('已恢复默认');
    draw();
  }

  /** 右上角「更多」：点开后从上到下 保存 / 载入 / 恢复 */
  function openMenu(anchor) {
    dropdown({
      anchor,
      width: '200px',
      items: [
        { label: '保存', sub: '存为预设', iconName: 'save', onClick: savePreset },
        { label: '载入', sub: presets().length ? `${presets().length} 个预设` : '暂无预设', iconName: 'load', onClick: loadPreset },
        { divider: true },
        { label: '恢复', sub: '回到初始状态', iconName: 'refresh', onClick: resetDefault }
      ]
    });
  }

  /* ---------------- 渲染 ---------------- */

  function blockRow(block) {
    const data = isDataBlock(block.type);
    const src = DATA_BLOCKS[kind].find((b) => b.type === block.type);
    const sub = data
      ? (src ? src.hint : '')
      : (block.text || '').replace(/\s+/g, ' ').slice(0, 28);

    return h('div', {
      class: 'row pblock' + (block.enabled === false ? ' off' : ''),
      'data-sort-id': block.id,
      onClick: () => { if (!data) editBlock(block); }
    },
      icon(data ? 'layers' : 'edit', 19, 'ico row-ico'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' },
          h('span', { text: block.name }),
          h('em', { class: 'pill ' + (data ? 'data' : 'text'), text: data ? '数据' : '自定义' })
        ),
        h('div', { class: 'row-sub', text: sub })
      ),
      switchBox({
        checked: block.enabled !== false,
        onChange: (v) => {
          store.updatePromptBlock(kind, block.id, { enabled: v });
          draw();
        }
      }),
      data ? null : h('button', {
        class: 'row-op',
        onClick: (e) => { e.stopPropagation(); editBlock(block); }
      }, icon('trash', 17))
    );
  }

  function draw() {
    clear(slot);
    const current = cfg();

    slot.appendChild(topbar({
      title: `${meta.label}提示词`,
      back: true,
      align: 'center',
      onBack: () => back('/prompt'),
      actions: [
        { icon: 'spark', onClick: preview },
        { icon: 'more', label: '更多', onClick: (e, btn) => openMenu(btn) }
      ]
    }));

    /* 系统提示词 */
    slot.appendChild(h('div', { class: 'section-title', text: '系统提示词' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: 'system',
        sub: (current.system || '（空）').slice(0, 40),
        iconName: 'layers',
        onClick: editSystem
      })
    ));

    /* 块列表 */
    slot.appendChild(h('div', { class: 'section-title', text: '提示词块 · 长按拖动排序' }));

    const list = h('div', { class: 'list' }, current.blocks.map(blockRow));
    const card = h('div', { class: 'card' }, list);
    slot.appendChild(card);

    sortable(list, {
      onEnd: (ids) => {
        const map = new Map(current.blocks.map((b) => [b.id, b]));
        const ordered = ids.map((id) => map.get(id)).filter(Boolean);
        store.setPromptBlocks(kind, ordered);
      }
    });

    slot.appendChild(h('div', { style: { height: '14px' } }));
    slot.appendChild(h('button', { class: 'btn block', onClick: addBlock },
      icon('plus', 18), h('span', { text: '添加提示词块' })
    ));

    /* 预设：只列当前这一类的，标题里点明是给谁用的 */
    slot.appendChild(h('div', { class: 'section-title', text: `${meta.label}预设` }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({ label: '保存当前为预设', iconName: 'save', onClick: savePreset }),
      presets().map((p) => h('div', {
        class: 'row',
        onClick: () => applyPreset(p)
      },
        icon('bookmark', 20, 'ico row-ico'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: p.name }),
          h('div', { class: 'row-sub', text: `${p.blocks.length} 块 · ${fmtTime(p.createdAt)}` })
        ),
        h('button', {
          class: 'row-op',
          onClick: (e) => { e.stopPropagation(); presetMenu(p); }
        }, icon('edit', 18))
      ))
    ));
  }

  draw();
  return page;
}
