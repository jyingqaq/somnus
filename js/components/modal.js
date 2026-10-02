/** 弹窗系统：openModal / showForm / showAlert / showConfirm / showSheet */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';

const root = () => document.getElementById('modal-root');
const active = new Set();

export function closeTopModal() {
  const arr = [...active];
  if (arr.length) arr[arr.length - 1]();
}

export function closeAllModals() {
  [...active].forEach((fn) => fn());
}

/**
 * @param {object} opt
 * @param {string} [opt.title]
 * @param {Node} [opt.body]
 * @param {Array} [opt.actions] { label, kind, disabled, onClick(close) }
 * @param {boolean} [opt.sheet] 底部面板样式
 * @param {boolean} [opt.dismissable] 点击遮罩是否关闭
 * @param {Function} [opt.onMount] ({ close, card, nodes })
 * @param {Function} [opt.onClose]
 */
export function openModal({ title, body, actions = [], sheet = false, dismissable = true, onMount, onClose }) {
  const wrap = h('div', { class: 'modal-root' + (sheet ? ' sheet' : '') });
  const backdrop = h('div', { class: 'modal-backdrop' });
  const card = h('div', { class: 'modal-card' });
  const nodes = {};

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    active.delete(close);
    wrap.remove();
    if (onClose) onClose();
  };

  if (title) {
    card.appendChild(h('div', { class: 'modal-head' },
      h('div', { class: 'm-title', text: title }),
      h('button', { class: 'm-x', onClick: close }, icon('close', 18))
    ));
  }
  if (body) card.appendChild(h('div', { class: 'modal-body' }, body));

  if (actions.length) {
    card.appendChild(h('div', { class: 'modal-foot' },
      actions.map((a, i) => {
        const btn = h('button', {
          class: 'btn ' + (a.kind || 'plain'),
          text: a.label,
          onClick: () => (a.onClick ? a.onClick(close) : close())
        });
        if (a.disabled) btn.disabled = true;
        nodes[i] = btn;
        return btn;
      })
    ));
  }

  if (dismissable) backdrop.addEventListener('click', close);
  const wrapLayer = h('div', {
    class: 'modal-wrap',
    onClick: sheet ? (e) => { if (e.target === e.currentTarget) close(); } : null
  }, card);

  wrap.append(backdrop, wrapLayer);
  root().appendChild(wrap);
  active.add(close);
  if (onMount) onMount({ close, card, nodes });
  return { close, card, nodes };
}

/**
 * 表单弹窗，字段默认必填（required:false 可跳过），未填时提交按钮禁用
 *
 * 字段类型：text（默认）/ textarea / select / custom。
 * custom 不产生输入框，而是把 { type:'custom', render(ctx) } 交给调用方自己拼 DOM，
 * ctx 提供 inputs（按 key 取别的输入框）、setValue（回填并触发校验）、validate。
 * 「从文档导入」就是靠它把文件内容写进同一个表单里的「详细内容」。
 */
export function showForm({ title, fields = [], submitLabel = '保存', cancelLabel = '取消', onSubmit, dangerLabel }) {
  return new Promise((resolve) => {
    const inputs = {};
    // select 永远有值（空字符串也可能是合法选项），默认不参与必填校验
    // custom 没有输入框，天然不参与
    const requiredKeys = fields
      .filter((f) => (f.type === 'select' ? f.required === true : (f.type === 'custom' ? false : f.required !== false)))
      .map((f) => f.key);

    // custom 字段先占位，等所有输入框建好再回头填内容，
    // 这样 render(ctx) 里拿到的 inputs 才是完整的。
    const pending = [];

    const body = h('div', { class: 'form' }, fields.map((f) => {
      if (f.type === 'custom') {
        const slot = h('div', { class: 'form-row' });
        pending.push({ slot, f });
        return slot;
      }

      const row = h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: f.label }));
      let input;
      if (f.type === 'textarea') {
        input = h('textarea', { class: 'field-area', placeholder: f.placeholder || '', rows: f.rows || 6 });
      } else if (f.type === 'select') {
        input = h('select', { class: 'field-select' },
          (f.options || []).map((o) => h('option', { value: o.value, text: o.label }))
        );
      } else {
        input = h('input', {
          class: 'field',
          type: f.type || 'text',
          placeholder: f.placeholder || '',
          autocomplete: 'off',
          autocapitalize: 'off',
          spellcheck: 'false'
        });
      }
      if (f.value != null) input.value = f.value;
      inputs[f.key] = input;
      row.appendChild(input);
      return row;
    }));

    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const read = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, (el.value || '').trim()]));

    /** 回填某个字段并立刻重算必填状态（给 custom 字段用） */
    function setValue(key, value) {
      const el = inputs[key];
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      validate();
    }

    const actions = [];
    if (dangerLabel) {
      actions.push({ label: dangerLabel, kind: 'danger', onClick: (close) => { done({ __danger: true }); close(); } });
    }
    actions.push({
      label: submitLabel,
      kind: 'primary',
      onClick: (close) => {
        const values = read();
        if (!requiredKeys.every((k) => values[k])) return;
        done(values);
        close();
        if (onSubmit) onSubmit(values);
      }
    });
    actions.push({ label: cancelLabel, kind: 'plain', onClick: (close) => { done(null); close(); } });

    const modal = openModal({ title, body, actions, onClose: () => done(null) });

    const submitBtn = actions.find((a) => a.kind === 'primary');
    const submitNode = modal.nodes[actions.indexOf(submitBtn)];

    // 用函数声明而不是 const 箭头：custom 字段的 render 会在 microtask 里跑，
    // 那时若已走到 setValue → validate，提前声明的函数不会踩 TDZ。
    function validate() {
      submitNode.disabled = !requiredKeys.every((k) => (inputs[k] && inputs[k].value || '').trim());
    }
    Object.values(inputs).forEach((el) => el.addEventListener('input', validate));
    validate();

    // inputs 与 validate 都就位了，现在才去填 custom 字段
    pending.forEach(({ slot, f }) => {
      const node = f.render && f.render({ inputs, setValue, validate });
      if (node) slot.appendChild(node);
    });

    const first = inputs[fields[0] && fields[0].key];
    if (first && first.focus) setTimeout(() => { try { first.focus(); } catch {} }, 140);
  });
}

export function showAlert(title, message, actionLabel = '好') {
  return new Promise((resolve) => {
    openModal({
      title,
      body: message ? h('div', { class: 'alert-msg', text: message }) : null,
      actions: [{ label: actionLabel, kind: 'primary', onClick: (close) => { resolve(true); close(); } }],
      onClose: () => resolve(false)
    });
  });
}

export function showConfirm({ title, message, confirmLabel = '删除', cancelLabel = '取消' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: message ? h('div', { class: 'alert-msg', text: message }) : null,
      actions: [
        { label: cancelLabel, kind: 'plain', onClick: (close) => { resolve(false); close(); } },
        { label: confirmLabel, kind: 'danger', onClick: (close) => { resolve(true); close(); } }
      ],
      onClose: () => resolve(false)
    });
  });
}

/** 底部选择面板 */
export function showSheet({ title, items = [], actions }) {
  const body = h('div', { class: 'list' });
  if (!items.length) body.appendChild(h('div', { class: 'empty', text: '暂无内容' }));

  let modal;
  items.forEach((it) => {
    body.appendChild(h('div', {
      class: 'row',
      onClick: () => { modal.close(); if (it.onClick) it.onClick(); }
    },
      it.icon ? icon(it.icon, 20, 'ico row-ico') : null,
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: it.label }),
        it.sub ? h('div', { class: 'row-sub', text: it.sub }) : null
      ),
      h('span', { class: 'chev' }, it.right ? '' : icon('chev', 18))
    ));
  });

  modal = openModal({
    title,
    body,
    sheet: true,
    actions: actions || [{ label: '关闭', kind: 'plain', onClick: (close) => close() }]
  });
  return modal;
}
