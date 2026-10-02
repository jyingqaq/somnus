/**
 * 富文本输入框：支持把「角色 / 世界书 / 灵感」以标题芯片的形式插入。
 * 界面只显示标题，序列化时替换为完整详细内容。
 */

import { h } from '../util/dom.js';
import { getState, COLLECTIONS } from '../store.js';

let savedRange = null;

export function createEditor({ placeholder = '', minHeight } = {}) {
  const box = h('div', {
    class: 'editor',
    contenteditable: 'true',
    spellcheck: 'false',
    'data-placeholder': placeholder
  });
  if (minHeight) box.style.minHeight = minHeight;

  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && box.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  document.addEventListener('selectionchange', remember);

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!document.execCommand('insertLineBreak')) {
        document.execCommand('insertHTML', false, '<br>');
      }
    }
  });

  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // 输入中若出现空文本节点则清理，保证 :empty 占位符可用
  box.addEventListener('input', () => {});

  function chipNode(type, title) {
    return h('span', {
      class: 'chip',
      contenteditable: 'false',
      'data-chip': type,
      'data-title': title
    },
      h('span', { class: 'dot' }),
      h('span', { text: title })
    );
  }

  function restoreCaret() {
    box.focus();
    if (!savedRange) return false;
    if (!box.contains(savedRange.startContainer)) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  function insertChip(type, title) {
    const node = chipNode(type, title);
    const space = document.createTextNode(' ');
    restoreCaret();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !box.contains(sel.anchorNode)) {
      box.append(node, space);
    } else {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(space);
      range.insertNode(node);
      range.setStartAfter(space);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    remember();
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 遍历子节点，芯片替换为详细内容 */
  function serialize() {
    let out = '';
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) { out += child.textContent; continue; }
        if (child.nodeType !== 1) continue;
        if (child.dataset && child.dataset.chip) {
          const meta = COLLECTIONS[child.dataset.chip];
          const title = child.dataset.title;
          const item = meta
            ? (getState()[meta.key] || []).find((it) => it.title === title)
            : null;
          out += item ? item.detail : title;
          continue;
        }
        const tag = child.tagName;
        if (tag === 'BR') { out += '\n'; continue; }
        if (tag === 'DIV' || tag === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(child);
          continue;
        }
        walk(child);
      }
    };
    walk(box);
    return out.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  return {
    el: box,
    insertChip,
    serialize,
    getHTML: () => box.innerHTML,
    setHTML: (html) => { box.innerHTML = html || ''; },
    clear: () => { box.innerHTML = ''; },
    isEmpty: () => !serialize(),
    focus: () => box.focus()
  };
}

export const TYPE_LABEL = { role: '角色', world: '世界书', idea: '灵感' };
