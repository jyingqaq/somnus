/**
 * 我的 · 备份：导出 / 恢复文字内容
 *
 * 备份范围和恢复语义都定义在 services/backup.js + store.replaceContent 里，
 * 这里只负责选文件、确认、显示统计。本地恢复和云端恢复走的是同一对函数，
 * 所以两边行为不会有差别。
 */

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
import { back, navigate } from '../router.js';

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
          text: '备份只收文字内容：不含外观 / 主题、头像、API 设置和云端备份设置。'
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
      h('div', { class: 'bk-note', text: '整份恢复：书、创作、角色、提示词等内容以备份为准，本机的外观、头像、API 和云端设置一概不动。' }),
      h('div', { class: 'bk-note', text: '合并恢复：只按 id 去重追加书本、创作、角色等内容，一份都不覆盖。' }),
      h('div', { class: 'bk-note', text: '备份里没有外观和设置这一类东西，所以导入前后它们都保持当前不变。' }),
      parsed.hadApiKey
        ? h('div', { class: 'bk-note', text: '这份备份是旧版本导出的，里面的 API Key 已被自动忽略。' })
        : null,
      sameShape
        ? h('div', { class: 'bk-note', text: '两边的数据量看起来差不多，如果只是想恢复，选覆盖更干净。' })
        : null
    );

    const choice = await new Promise((resolve) => {
      openModal({
        title: '恢复数据',
        body,
        actions: [
          { label: '取消', kind: 'plain', onClick: (close) => { resolve(''); close(); } },
          { label: '合并恢复', onClick: (close) => { resolve('merge'); close(); } },
          { label: '整份恢复', kind: 'primary', onClick: (close) => { resolve('replace'); close(); } }
        ],
        onClose: () => resolve('')
      });
    });
    if (!choice) return;

    if (choice === 'replace') {
      const ok = await showConfirm({
        title: '确认整份恢复',
        message: '本机的书、创作、角色、提示词等内容都会被备份里那份替换掉，这一步无法撤销。外观和设置不受影响。',
        confirmLabel: '整份恢复'
      });
      if (!ok) return;
      store.replaceContent(parsed.data);
      toast('已恢复备份');
    } else {
      const added = store.mergeContent(parsed.data);
      toast(added ? `已合并 ${added} 项` : '没有需要合并的新内容');
    }

    draw();
  }

  async function importFromPaste() {
    const values = await showForm({
      title: '粘贴恢复',
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
        sub: '生成一个 .json 备份文件，可下载或复制（只含文字内容）',
        iconName: 'load',
        onClick: openExport
      })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '恢复' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '从文件恢复',
        sub: '选择之前导出的 .json 备份',
        iconName: 'upload',
        onClick: () => fileInput.click()
      }),
      listRow({
        label: '粘贴内容恢复',
        sub: '手动粘贴备份内容',
        iconName: 'edit',
        onClick: importFromPaste
      })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '云端' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '云端备份',
        sub: '传到自己的 GitHub 仓库，换设备时再拉回来',
        iconName: 'globe',
        onClick: () => navigate('/backup/cloud')
      })
    ));

    slot.appendChild(fileInput);
  }

  draw();
  return page;
}
