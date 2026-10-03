/**
 * 我的 · 备份 · 云端备份（GitHub，手动上传 / 手动恢复）
 *
 * 只做手动：没有自动同步，也没有后台轮询 ——
 * 自动同步要处理「两台设备同时推」「内容没变也提交」这些并发问题，
 * 而它们和后端的取舍（单文件乐观锁还是每设备一个文件）绑在一起，值得单独一轮再做。
 *
 * 恢复走 store.replaceContent / mergeContent，**不调 applyAppearance()** ——
 * 这正是需求里那句「恢复时不动外观设置」：备份里本来就没有外观，
 * 再加上不重下 CSS 变量，外观就没有任何被改动的路径。
 */

import { h, clear, fmtTime } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { listRow } from '../components/controls.js';
import { openModal, showForm, showAlert, showConfirm } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { back } from '../router.js';
import {
  stringifyBackup, parseBackup, summarize, formatSummary, byteSize, formatBytes
} from '../services/backup.js';
import {
  normalizeConfig, configError, checkRepo, fetchRemote, pushRemote,
  explainThrown, fileUrl, DEFAULT_PATH
} from '../services/cloud.js';
import { loadCloudConfig, saveCloudConfig, clearCloudConfig } from '../services/cloudConfig.js';

/** 变成 { label, kind, value } 的单选弹窗，返回被选项的 value（取消 / 关掉都是空串） */
function askModal({ title, body, actions }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title,
      body,
      actions: actions.map((a) => ({ ...a, onClick: (close) => { done(a.value); close(); } })),
      onClose: () => done('')
    });
  });
}

function fact(label, value) {
  return h('div', { class: 'bk-fact' }, h('b', { text: label }), h('span', { text: value }));
}

/** 云端那份文件读成统计；不是本应用的备份就返回 null */
function readSummary(text) {
  try {
    return summarize(parseBackup(text).data);
  } catch {
    return null;
  }
}

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  /* ---------------- 连接设置 ---------------- */

  async function openConfig() {
    const cur = loadCloudConfig();
    const values = await showForm({
      title: '连接 GitHub',
      fields: [
        {
          key: 'repo',
          label: '仓库',
          value: cur.repo ? `${cur.owner}/${cur.repo}` : '',
          placeholder: '用户名/仓库名',
        },
        { key: 'token', label: '访问令牌', value: cur.token, placeholder: 'github_pat_… 或 ghp_…' },
        { key: 'branch', label: '分支（可留空）', value: cur.branch, placeholder: '留空 = 仓库默认分支', required: false },
        { key: 'path', label: '文件路径', value: cur.path || DEFAULT_PATH, placeholder: DEFAULT_PATH, required: false }
      ],
      submitLabel: '保存并检查'
    });
    if (!values) return;

    // repo 框允许直接粘「用户名/仓库名」，这里交给 normalizeConfig 去拆
    const next = normalizeConfig({ ...cur, ...values, owner: '' });
    const bad = configError(next);
    if (bad) {
      await showAlert('还不能连接', bad);
      return;
    }

    let info;
    try {
      info = await checkRepo(next);
    } catch (e) {
      await showAlert('连接失败', explainThrown(e));
      return;
    }

    // 换了仓库 / 分支 / 路径，上一份文件的 sha 就作废了，别留给下一次写入
    const moved = next.owner !== cur.owner || next.repo !== cur.repo
      || next.branch !== cur.branch || next.path !== cur.path;
    saveCloudConfig(moved ? { ...next, lastSha: '', lastSyncAt: 0 } : next);

    if (info.private) {
      toast('已连接');
    } else {
      await showAlert('这个仓库是公开的', '公开仓库里的稿件，拿到链接的人都能看到。建议去 GitHub 把它改成私有。');
    }
    draw();
  }

  /* ---------------- 上传 ---------------- */

  async function upload() {
    const cfg = loadCloudConfig();
    const text = stringifyBackup(store.getState());

    let remote;
    try {
      remote = await fetchRemote(cfg);
    } catch (e) {
      await showAlert('备份失败', explainThrown(e));
      return;
    }

    const mine = summarize(store.getState());
    const theirs = remote.exists ? readSummary(remote.text) : null;

    const body = h('div', {},
      h('div', { class: 'bk-facts' },
        fact('本机数据', formatSummary(mine)),
        fact('文件大小', formatBytes(byteSize(text))),
        remote.exists
          ? fact('云端数据', theirs ? formatSummary(theirs) : '不是本应用的备份')
          : fact('云端数据', '还没有文件，这是第一次')
      ),
      h('div', { class: 'bk-note', text: '上传会覆盖云端那一个文件，云端旧版本仍留在仓库的提交历史里，翻得回来。' }),
      h('div', { class: 'bk-note', text: '云端只收文字内容：不含外观 / 主题、头像、API 与云端设置。' }),
      remote.exists && !theirs
        ? h('div', { class: 'bk-note', text: '注意：云端那个文件不是本应用的备份，继续会把它覆盖掉。' })
        : null
    );

    const choice = await askModal({
      title: '上传到云端',
      body,
      actions: [
        { label: '取消', kind: 'plain', value: '' },
        { label: '上传', kind: 'primary', value: 'go' }
      ]
    });
    if (!choice) return;

    try {
      const res = await pushRemote(cfg, text, remote.sha);
      saveCloudConfig({ lastSyncAt: Date.now(), lastSha: res.sha });
      toast('已备份到云端');
    } catch (e) {
      await showAlert('备份失败', explainThrown(e));
    }
    draw();
  }

  /* ---------------- 恢复 ---------------- */

  async function download() {
    const cfg = loadCloudConfig();

    let remote;
    try {
      remote = await fetchRemote(cfg);
    } catch (e) {
      await showAlert('恢复失败', explainThrown(e));
      return;
    }
    if (!remote.exists) {
      await showAlert('恢复失败', '云端还没有备份文件，先做一次备份。');
      return;
    }

    let parsed;
    try {
      parsed = parseBackup(remote.text);
    } catch (e) {
      await showAlert('无法恢复', `云端那个文件不像是本应用的备份：${e.message}`);
      return;
    }

    const body = h('div', {},
      h('div', { class: 'bk-facts' },
        fact('云端备份', formatSummary(summarize(parsed.data))),
        parsed.exportedAt ? fact('备份时间', fmtTime(parsed.exportedAt)) : null,
        fact('本机数据', formatSummary(summarize(store.getState())))
      ),
      h('div', { class: 'bk-note', text: '整份恢复：书、创作、角色、提示词等内容以云端为准；本机的外观主题、头像、API 与云端设置一概不动。' }),
      h('div', { class: 'bk-note', text: '合并恢复：只按 id 追加本机没有的书、创作、角色等内容，一份都不覆盖。' }),
      parsed.hadApiKey
        ? h('div', { class: 'bk-note', text: '这份备份是旧版本导出的，里面的 API Key 已被自动忽略。' })
        : null
    );

    const choice = await askModal({
      title: '从云端恢复',
      body,
      actions: [
        { label: '取消', kind: 'plain', value: '' },
        { label: '合并恢复', value: 'merge' },
        { label: '整份恢复', kind: 'primary', value: 'replace' }
      ]
    });
    if (!choice) return;

    if (choice === 'replace') {
      const ok = await showConfirm({
        title: '确认整份恢复',
        message: '本机的书、创作、角色、提示词等内容会被云端那份替换掉，这一步无法撤销。外观和设置不受影响。',
        confirmLabel: '恢复'
      });
      if (!ok) return;
      store.replaceContent(parsed.data);
      toast('已恢复云端备份');
    } else {
      const added = store.mergeContent(parsed.data);
      toast(added ? `已合并 ${added} 项` : '没有需要合并的新内容');
    }
    draw();
  }

  /* ---------------- 其它 ---------------- */

  function openFile() {
    const cfg = loadCloudConfig();
    const win = window.open(fileUrl(cfg), '_blank', 'noopener');
    if (!win) toast('浏览器拦住了新窗口，可以手动打开仓库看历史');
  }

  async function disconnect() {
    const ok = await showConfirm({
      title: '断开云端备份',
      message: '只清掉本机保存的令牌和仓库信息，云端那个文件不动。',
      confirmLabel: '断开'
    });
    if (!ok) return;
    clearCloudConfig();
    toast('已断开');
    draw();
  }

  /* ---------------- 渲染 ---------------- */

  function draw() {
    clear(slot);
    const cfg = loadCloudConfig();

    slot.appendChild(topbar({
      title: '云端备份',
      back: true,
      align: 'center',
      onBack: () => back('/backup')
    }));

    if (!cfg.token || !cfg.owner || !cfg.repo) {
      slot.appendChild(h('div', { class: 'section-title', text: '开始之前' }));
      slot.appendChild(h('div', { class: 'card', style: { padding: '14px 16px' } },
        h('div', { class: 'bk-facts', style: { paddingBottom: '0' } },
          fact('第一步', '在 GitHub 建一个空的私有仓库'),
          fact('第二步', '生成 fine-grained 令牌，只勾这个仓库的 Contents 读写'),
          fact('第三步', '把这些填到下面')
        )
      ));

      slot.appendChild(h('div', { class: 'section-title', text: '连接' }));
      slot.appendChild(h('div', { class: 'card' },
        listRow({
          label: '连接 GitHub',
          sub: '填仓库和访问令牌',
          iconName: 'link',
          onClick: openConfig
        })
      ));

      slot.appendChild(h('div', { class: 'section-title', text: '说明' }));
      slot.appendChild(h('div', { class: 'card', style: { padding: '14px 16px' } },
        h('div', { class: 'bk-note', text: '备份的是文字内容：书、章节、评论、创作、角色、世界书、灵感、输入预设、提示词，以及昵称和简介。' }),
        h('div', { class: 'bk-note', text: '图片和主题不会上传 —— 头像、背景图、字体文件、外观与主题设置、API 配置、云端设置都不在备份范围内。' }),
        h('div', { class: 'bk-note', text: '恢复时这些也一概不动：只会替换上面那批文字内容，本机的外观和设置保持原样。' }),
        h('div', { class: 'bk-note', text: '只支持手动上传和手动恢复，不会在后台自动同步。' })
      ));
      return;
    }

    const state = store.getState();
    const shown = normalizeConfig(cfg);   // 走一道规整，path 没填过时也能显示真正的默认值
    slot.appendChild(h('div', { class: 'section-title', text: '当前连接' }));
    slot.appendChild(h('div', { class: 'card', style: { padding: '14px 16px' } },
      h('div', { class: 'bk-facts', style: { paddingBottom: '0' } },
        fact('仓库', `${shown.owner}/${shown.repo}`),
        fact('文件', shown.path + (shown.branch ? ` · ${shown.branch}` : '')),
        fact('上次同步', cfg.lastSyncAt ? fmtTime(cfg.lastSyncAt) : '还没有'),
        fact('本机数据', formatSummary(summarize(state)))
      )
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '备份与恢复' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '立即备份',
        sub: '把本机的文字内容上传，覆盖云端那一份',
        iconName: 'upload',
        onClick: upload
      }),
      listRow({
        label: '从云端恢复',
        sub: '读回云端备份，可以合并或整份恢复',
        iconName: 'download',
        onClick: download
      })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '连接' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '连接设置',
        sub: '改仓库、令牌或文件路径',
        iconName: 'link',
        onClick: openConfig
      }),
      listRow({
        label: '在 GitHub 上查看',
        sub: '打开备份文件和它的提交历史',
        iconName: 'globe',
        onClick: openFile
      }),
      listRow({
        label: '断开连接',
        sub: '只清本机保存的令牌，云端文件不动',
        iconName: 'close',
        danger: true,
        onClick: disconnect
      })
    ));
  }

  draw();
  return page;
}
