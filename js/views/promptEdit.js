/** 我的 · 提示词 · 块编辑器（长按拖动排序） */

import { h, clear } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, showConfirm, openModal } from '../components/modal.js';
import { switchBox, listRow } from '../components/controls.js';
import { sortable } from '../components/sortable.js';
import { toast } from '../components/toast.js';
import { KINDS, DATA_BLOCKS, isDataBlock, previewPrompt } from '../services/prompt.js';
import { back } from '../router.js';

export function render({ params }) {
  const kind = KINDS[params.kind] ? params.kind : 'create';
  const meta = KINDS[kind];

  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  const cfg = () => store.promptOf(kind);

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
        { icon: 'refresh', onClick: resetDefault }
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
  }

  draw();
  return page;
}
