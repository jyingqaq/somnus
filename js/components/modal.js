/** 弹窗系统：openModal / showForm / showAlert / showConfirm / showSheet */

import { h, clear, onLongPress } from '../util/dom.js';
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
 * @param {string|Node} [opt.title] 传 Node 则原样塞进标题位，调用方可自行改写文字
 * @param {Node} [opt.body]
 * @param {Array} [opt.actions] { label, kind, disabled, hidden, onClick(close) }
 * @param {boolean} [opt.sheet] 底部面板样式
 * @param {boolean} [opt.dismissable] 点击遮罩是否关闭
 * @param {boolean} [opt.closable] 是否显示右上角的 ×（配合 dismissable:false 表示
 *   「只能走底部按钮」，更新说明弹窗就靠它保证「只能点『已阅』」）
 * @param {Function} [opt.onMount] ({ close, card, nodes })
 * @param {Function} [opt.onClose]
 */
export function openModal({ title, body, actions = [], sheet = false, dismissable = true, closable = true, onMount, onClose }) {
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
      typeof title === 'string' ? h('div', { class: 'm-title', text: title }) : title,
      closable ? h('button', { class: 'm-x', onClick: close }, icon('close', 18)) : null
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
        // 先立成属性，之后调用方能按需 .hidden = true/false 来回切
        if (a.hidden) btn.hidden = true;
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

/**
 * 底部选择面板
 *
 * 传了 `onDelete` 就自动带上批量删除：长按任意一项进入多选（这套交互与章节页评论一致 ——
 * 长按进多选、选中数写标题、取消清空、一条不剩自动退出），点选要删的项，底部换成
 * 「取消 / 删除」，确认后回调 onDelete(ids)。面板不重开，本地把这批摘掉再重画。
 *
 * @param {object} o
 * @param {string} [o.title]
 * @param {Array<{id?:string,label:string,sub?:string,icon?:string,right?:boolean,onClick?:Function}>} [o.items]
 *   批量删除要求每项带 id（getElementById 拿不到，只能靠调用方给）
 * @param {Array} [o.actions] 自定义底部按钮；批量模式下由本函数接管，传入的会被忽略
 * @param {string} [o.tip] 底部提示文案，默认「长按可批量删除」（仅批量模式显示）
 * @param {Function} [o.onDelete] (ids) => void 确认后执行真正的删除（写库）；确认框由这里弹
 * @param {string} [o.confirmTitle] 确认框标题，默认「删除」
 */
export function showSheet({ title = '', items = [], actions, tip, onDelete, confirmTitle = '删除' }) {
  const batch = typeof onDelete === 'function';
  const picked = new Set();
  let selecting = false;
  let modal = null;

  const list = h('div', { class: 'list' });
  const tipNode = batch ? h('div', { class: 'sheet-tip', text: tip || '长按可批量删除' }) : null;
  // 非批量时 body 就是 .list 本身，跟以前的结构保持一致
  const body = batch ? h('div', {}, list, tipNode) : list;

  const titleNode = h('div', { class: 'm-title', text: title });

  function rowFor(it) {
    const on = selecting && picked.has(it.id);
    const row = h('div', {
      class: `row${on ? ' picked' : ''}`,
      onClick: () => {
        if (selecting) { togglePick(it.id); return; }
        modal.close();
        if (it.onClick) it.onClick();
      }
    },
      selecting ? h('span', { class: 'pick' }, icon('check', 13)) : null,
      it.icon ? icon(it.icon, 20, 'ico row-ico') : null,
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: it.label }),
        it.sub ? h('div', { class: 'row-sub', text: it.sub }) : null
      ),
      // 多选时右箭头没意义了，让位给左侧的勾选圈
      selecting ? null : h('span', { class: 'chev' }, it.right ? '' : icon('chev', 18))
    );

    if (batch) onLongPress(row, () => { if (!selecting) enterSelect(it.id); });
    return row;
  }

  function syncFoot() {
    const btn = (i) => (modal && modal.nodes[i]) || null;
    const off = btn(0); const cancel = btn(1); const del = btn(2);
    if (off) off.hidden = selecting;
    if (cancel) cancel.hidden = !selecting;
    if (del) { del.hidden = !selecting; del.textContent = `删除${picked.size ? ` ${picked.size}` : ''}`; }
  }

  function draw() {
    clear(list);
    if (!items.length) list.appendChild(h('div', { class: 'empty', text: '暂无内容' }));
    else items.forEach((it) => list.appendChild(rowFor(it)));

    if (!batch) return;
    titleNode.textContent = selecting ? `已选 ${picked.size}` : title;
    if (tipNode) tipNode.hidden = selecting || !items.length;
    syncFoot();
  }

  function enterSelect(id) {
    selecting = true;
    picked.clear();
    picked.add(id);
    draw();
  }

  function togglePick(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    if (!picked.size) selecting = false; // 一条不剩就自动退出多选
    draw();
  }

  function exitSelect() {
    selecting = false;
    picked.clear();
    draw();
  }

  async function deletePicked() {
    if (!picked.size) return;
    const ids = [...picked];
    const ok = await showConfirm({ title: confirmTitle, message: `共 ${ids.length} 个` });
    if (!ok) return;

    await onDelete(ids);

    // onDelete 只管写库，面板还开着；本地也把这批摘掉，免得看着像没删掉
    const gone = new Set(ids);
    items = items.filter((it) => !gone.has(it.id));
    selecting = false;
    picked.clear();
    draw();
  }

  modal = openModal({
    title: title ? titleNode : null,
    body,
    sheet: true,
    actions: batch
      ? [
          { label: '关闭', kind: 'plain', onClick: (close) => close() },
          { label: '取消', kind: 'plain', hidden: true, onClick: () => exitSelect() },
          { label: '删除', kind: 'danger', hidden: true, onClick: () => deletePicked() }
        ]
      : (actions || [{ label: '关闭', kind: 'plain', onClick: (close) => close() }])
  });
  draw();
  return modal;
}
