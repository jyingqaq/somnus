/** 章节详情：阅读 / 修改 / 评论 */

import { h, clear, fmtTime, onLongPress } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { toast } from '../components/toast.js';
import { showConfirm, openModal } from '../components/modal.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { generateComments } from '../services/comment.js';
import { back } from '../router.js';

const MAX_INPUT_H = 110;

export function render({ params }) {
  const page = h('div', { class: 'page' });
  const book = store.get('books', params.id);
  const chapter = store.getChapter(params.id, params.cid);
  if (!book || !chapter) return page;

  const barSlot = h('div');
  const bodySlot = h('div');
  const cmSlot = h('div');
  const area = h('textarea', { class: 'field-area reader-edit', spellcheck: 'false' });

  let editing = false;
  let selecting = false;
  let generating = false;
  let picked = new Set();
  let inView = false;
  let observer = null;

  /* ---------------- 底部发送栏 ---------------- */

  const input = h('textarea', {
    class: 'cbar-input',
    rows: '1',
    placeholder: '写评论…',
    spellcheck: 'false',
    onInput: () => { grow(); sync(); }
  });
  const sendBtn = h('button', { class: 'cbar-send', text: '发送', onClick: submit });
  const bar = h('div', { class: 'cbar' }, input, sendBtn);

  // 元素还没挂到文档上时 scrollHeight 是 0，所以用 40 兜底，保证初始高度正确。
  // 先关掉滚动条再量高度，否则桌面端会被占掉十几像素宽。
  function grow() {
    input.style.overflowY = 'hidden';
    input.style.height = 'auto';
    const full = input.scrollHeight;
    input.style.height = `${Math.max(40, Math.min(full, MAX_INPUT_H))}px`;
    input.style.overflowY = full > MAX_INPUT_H ? 'auto' : 'hidden';
  }

  /** 开头的「@网名 」拆出来当回复对象，剩下的是正文 */
  function parseReply(raw) {
    const m = String(raw).match(/^@(\S+)\s+([\s\S]*)$/);
    if (m) return { replyTo: m[1], text: m[2].trim() };
    return { replyTo: '', text: String(raw).trim() };
  }

  function sync() {
    const { text } = parseReply(input.value);
    sendBtn.disabled = !text || generating;
    // 编辑正文或批量选评论时把底栏收起来，避免挡住操作
    bar.classList.toggle('show', !editing && !selecting && (inView || !!input.value.trim()));
  }

  /** 单击某条评论 = 回复它 */
  function replyTo(name) {
    input.value = `@${name} ${input.value.replace(/^@\S+\s+/, '')}`;
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* 忽略 */ }
    grow();
    sync();
  }

  function submit() {
    const { replyTo: at, text } = parseReply(input.value);
    if (!text || generating) return;
    const nickname = (store.getState().profile.nickname || '').trim();
    store.addComment(params.id, params.cid, { name: nickname || '我', replyTo: at, text });
    input.value = '';
    grow();
    renderComments();
    toast('已发送');
  }

  /* ---------------- 评论列表 ---------------- */

  const myName = () => (store.getState().profile.nickname || '').trim() || '我';

  function togglePick(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    // 一条不剩就自动退出多选
    if (!picked.size) {
      selecting = false;
      picked.clear();
    }
    draw();
    renderComments();
  }

  function enterSelect(id) {
    selecting = true;
    picked.clear();
    picked.add(id);
    draw();
    renderComments();
  }

  async function deletePicked() {
    if (!picked.size) return;
    const ok = await showConfirm({ title: '删除评论', message: `共 ${picked.size} 条` });
    if (!ok) return;
    store.removeComments(params.id, params.cid, [...picked]);
    selecting = false;
    picked.clear();
    toast('已删除');
    draw();
    renderComments();
  }

  /** 解析不出来时把原文摊给用户看，而不是只报一句「失败」 */
  function showRaw(raw) {
    openModal({
      title: '没能识别出评论',
      body: h('div', {},
        h('div', {
          class: 'alert-msg',
          text: '模型这次返回的格式不对，下面是原始内容。可以直接再点一次「获取评论」重试，也可以到「提示词 → 评论」里把格式要求改得更明确。'
        }),
        h('pre', { class: 'prompt-preview', text: raw || '（返回为空）' })
      ),
      actions: [{ label: '关闭', kind: 'primary', onClick: (close) => close() }]
    });
  }

  async function fetchComments() {
    if (generating) return;
    generating = true;
    renderComments();

    const fresh = store.getChapter(params.id, params.cid);
    const freshBook = store.get('books', params.id);

    showLoading('生成评论');
    try {
      const { raw, list } = await generateComments({
        book: freshBook,
        chapter: fresh,
        comments: (fresh && fresh.comments) || []
      });
      if (!list.length) {
        showRaw(raw);
        return;
      }
      store.addComments(params.id, params.cid, list);
      toast(`已生成 ${list.length} 条评论`);
    } catch (e) {
      toast(e.message || '生成失败');
    } finally {
      generating = false;
      hideLoading();
      renderComments();
    }
  }

  function commentRow(c) {
    const mine = c.name === myName();
    const row = h('div', {
      class: `cm-item${picked.has(c.id) ? ' picked' : ''}`,
      'data-cid': c.id,
      onClick: () => {
        if (selecting) togglePick(c.id);
        else replyTo(c.name);
      }
    },
      selecting ? h('span', { class: 'pick' }, icon('check', 13)) : null,
      h('div', { class: 'cm-main' },
        h('div', { class: 'cm-meta' },
          h('b', { class: `cm-name${mine ? ' me' : ''}`, text: `${c.name}：` }),
          c.createdAt ? h('span', { class: 'cm-time', text: fmtTime(c.createdAt) }) : null
        ),
        h('div', { class: 'cm-text' },
          c.replyTo ? h('span', { class: 'cm-at', text: `@${c.replyTo} ` }) : null,
          c.text
        )
      )
    );

    onLongPress(row, () => { if (!selecting) enterSelect(c.id); });
    return row;
  }

  function watch(el) {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => { inView = e.isIntersecting; });
      sync();
    });
    observer.observe(el);
  }

  function renderComments() {
    clear(cmSlot);
    const fresh = store.getChapter(params.id, params.cid);
    const list = (fresh && fresh.comments) || [];

    const getBtn = h('button', {
      class: 'cm-get',
      disabled: generating,
      onClick: fetchComments
    },
      icon('spark', 15),
      h('span', { text: generating ? '生成中' : '获取评论' })
    );

    const section = h('div', { class: 'cm-section' },
      h('div', { class: 'cm-head' },
        h('div', { class: 'cm-title', text: '评论' }),
        getBtn
      ),
      h('div', { class: 'cm-hr' })
    );

    if (list.length) {
      section.appendChild(h('div', { class: 'cm-list' }, list.map(commentRow)));
    } else {
      section.appendChild(h('div', {
        class: 'cm-empty',
        text: generating ? '正在生成评论…' : '还没有评论'
      }));
    }
    section.appendChild(h('div', { class: 'cm-tail' }));

    cmSlot.appendChild(section);
    watch(section);
    sync();
  }

  /* ---------------- 正文 ---------------- */

  function draw() {
    clear(barSlot);
    clear(bodySlot);
    const fresh = store.getChapter(params.id, params.cid);

    if (selecting) {
      barSlot.appendChild(topbar({
        title: `已选 ${picked.size}`,
        back: false,
        align: 'left',
        hero: true,
        actions: [
          { text: '取消', onClick: () => { selecting = false; picked.clear(); draw(); renderComments(); } },
          { icon: 'trash', kind: 'danger', onClick: deletePicked }
        ]
      }));
    } else {
      barSlot.appendChild(topbar({
        title: fresh.title,
        back: true,
        align: 'center',
        onBack: () => back(`/book/${params.id}`),
        actions: [{
          icon: editing ? 'check' : 'edit',
          kind: editing ? 'accent' : '',
          onClick: toggleEdit
        }]
      }));
    }

    if (editing) {
      area.value = fresh.content || '';
      bodySlot.appendChild(area);
    } else {
      bodySlot.appendChild(h('div', { class: 'reader', text: fresh.content }));
    }

    sync();
  }

  function toggleEdit() {
    if (editing) {
      const value = area.value.replace(/\u00a0/g, ' ').trim();
      store.updateChapter(params.id, params.cid, { content: value });
      editing = false;
      toast('已保存');
    } else {
      editing = true;
    }
    draw();
  }

  // 切走时断开观察，避免旧节点一直被订阅
  window.addEventListener('hashchange', () => { if (observer) observer.disconnect(); }, { once: true });

  page.append(barSlot, bodySlot, cmSlot, bar);
  draw();
  renderComments();
  grow();
  // 挂载后再量一次，避免首次量到 0
  requestAnimationFrame(grow);

  return page;
}
