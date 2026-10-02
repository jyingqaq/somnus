/** 我的 · 备份：导出 / 导入全部数据 */

import { h, clear, fmtTime } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { listRow } from '../components/controls.js';
import { openModal, showForm, showAlert, showConfirm } from '../components/modal.js';
import { toast } from '../components/toast.js';
import {
  stringifyBackup, backupFileName, parseBackup, summarize, formatSummary,
  byteSize, formatBytes, downloadText, readFileText, MAX_BACKUP_BYTES
} from '../services/backup.js';
import { applyAppearance } from '../theme.js';
import { back } from '../router.js';

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  /* 选文件用一个常驻的隐藏 input，避免每次点击都新建节点 */
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // 清掉，否则连选同一个文件不会再触发 change
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      toast('文件太大了，不像是本应用的备份');
      return;
    }
    try {
      await askImport(await readFileText(file), file.name);
    } catch (e) {
      toast(e.message || '读取文件失败');
    }
  });

  /* ---------------- 导出 ---------------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板');
      return true;
    } catch {
      await showAlert('复制失败', '当前环境不允许访问剪贴板，可以改用「下载文件」。');
      return false;
    }
  }

  function openExport() {
    const state = store.snapshot();
    const text = stringifyBackup(state);
    const size = byteSize(text);

    openModal({
      title: '导出数据',
      body: h('div', {},
        h('div', { class: 'bk-facts' },
          fact('数据量', formatSummary(summarize(state))),
          fact('文件大小', formatBytes(size))
        ),
        h('div', {
          class: 'bk-note',
          text: '备份不包含 API 设置，导入后需要自行重新配置。'
        })
      ),
      actions: [
        { label: '复制内容', onClick: () => copyText(text) },
        {
          label: '下载文件',
          kind: 'primary',
          onClick: (close) => {
            downloadText(backupFileName(), text);
            close();
            toast('已开始下载');
          }
        }
      ]
    });
  }

  /* ---------------- 导入 ---------------- */

  function fact(label, value) {
    return h('div', { class: 'bk-fact' },
      h('b', { text: label }),
      h('span', { text: value })
    );
  }

  /** 校验 → 让用户选覆盖还是合并 → 执行 */
  async function askImport(text, sourceName) {
    let parsed;
    try {
      parsed = parseBackup(text);
    } catch (e) {
      await showAlert('无法导入', e.message);
      return;
    }

    const incoming = summarize(parsed.data);
    const current = summarize(store.getState());
    const sameShape = formatSummary(incoming) === formatSummary(current)
      && incoming.books === current.books && incoming.chapters === current.chapters;

    const body = h('div', {},
      h('div', { class: 'bk-facts' },
        sourceName ? fact('来源', sourceName) : null,
        parsed.exportedAt ? fact('导出时间', fmtTime(parsed.exportedAt)) : null,
        fact('备份内容', formatSummary(incoming)),
        fact('当前数据', formatSummary(current))
      ),
      h('div', { class: 'bk-note', text: '覆盖导入：当前数据全部替换为备份内容，含设置、外观和提示词。' }),
      h('div', { class: 'bk-note', text: '合并导入：只按 id 去重追加书本、创作、角色等内容，设置与外观保持当前不变。' }),
      h('div', { class: 'bk-note', text: 'API 设置不在备份范围内，导入前后都保持当前不变。' }),
      parsed.hadApiKey
        ? h('div', { class: 'bk-note', text: '这份备份是旧版本导出的，里面的 API Key 已被自动忽略。' })
        : null,
      sameShape
        ? h('div', { class: 'bk-note', text: '两边的数据量看起来差不多，如果只是想恢复，选覆盖更干净。' })
        : null
    );

    const choice = await new Promise((resolve) => {
      openModal({
        title: '导入数据',
        body,
        actions: [
          { label: '取消', kind: 'plain', onClick: (close) => { resolve(''); close(); } },
          { label: '合并导入', onClick: (close) => { resolve('merge'); close(); } },
          { label: '覆盖导入', kind: 'primary', onClick: (close) => { resolve('replace'); close(); } }
        ],
        onClose: () => resolve('')
      });
    });
    if (!choice) return;

    if (choice === 'replace') {
      const ok = await showConfirm({
        title: '确认覆盖',
        message: '当前所有数据都会被替换掉，这一步无法撤销。',
        confirmLabel: '确认覆盖'
      });
      if (!ok) return;
      store.replaceState(parsed.data);
      applyAppearance(); // 外观/背景可能整套变了，立即重新下发 CSS 变量
      toast('已恢复备份');
    } else {
      const added = store.mergeContent(parsed.data);
      toast(added ? `已合并 ${added} 项` : '没有需要合并的新内容');
    }

    draw();
  }

  async function importFromPaste() {
    const values = await showForm({
      title: '粘贴导入',
      fields: [{
        key: 'text',
        label: '备份内容',
        type: 'textarea',
        rows: 8,
        placeholder: '把备份文件里的内容整段粘贴到这里'
      }],
      submitLabel: '下一步'
    });
    if (!values) return;
    await askImport(values.text, '');
  }

  /* ---------------- 渲染 ---------------- */

  function draw() {
    clear(slot);
    const state = store.getState();
    const summary = summarize(state);
    const size = byteSize(stringifyBackup(state));

    slot.appendChild(topbar({
      title: '备份',
      back: true,
      align: 'center',
      onBack: () => back('/me')
    }));

    slot.appendChild(h('div', { class: 'section-title', text: '数据概览' }));
    slot.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row', style: { cursor: 'default' } },
        icon('layers', 20, 'ico row-ico'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: formatSummary(summary) }),
          h('div', { class: 'row-sub', text: `共约 ${formatBytes(size)}` })
        )
      )
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '导出' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '导出全部数据',
        sub: '生成一个 .json 备份文件，可下载或复制（不含 API 设置）',
        iconName: 'load',
        onClick: openExport
      })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '导入' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '从文件导入',
        sub: '选择之前导出的 .json 备份',
        iconName: 'upload',
        onClick: () => fileInput.click()
      }),
      listRow({
        label: '粘贴导入',
        sub: '手动粘贴备份内容',
        iconName: 'edit',
        onClick: importFromPaste
      })
    ));

    slot.appendChild(fileInput);
  }

  draw();
  return page;
}
