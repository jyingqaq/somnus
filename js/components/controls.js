/** 通用表单控件（滑块 / 颜色 / 列表行） */

import { h, fileToDataUrl } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { showForm, showSheet } from './modal.js';

/**
 * 滑块
 * @param {{label:string, value:number, min?:number, max?:number, step?:number, format?:Function, onInput:Function}} o
 */
export function slider(o) {
  const min = o.min == null ? 0 : o.min;
  const max = o.max == null ? 1 : o.max;
  const step = o.step == null ? 0.01 : o.step;
  const fmt = o.format || ((v) => Math.round(v * 100) + '%');

  const value = h('span', { class: 'sl-val', text: fmt(o.value) });
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(o.value)
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = fmt(v);
    o.onInput(v);
  });

  return h('div', { class: 'slider-row' },
    h('span', { class: 'sl-label', text: o.label }),
    input,
    value
  );
}

/** 颜色选择行 */
export function colorRow({ label, value, onInput, onReset }) {
  const picker = h('input', { type: 'color', value: value || '#5b5bd6' });
  picker.addEventListener('input', () => onInput(picker.value));

  const reset = h('button', { class: 'btn sm plain', text: '默认', onClick: () => onReset && onReset() });

  return h('div', { class: 'color-row' },
    h('span', { class: 'cr-label', text: label }),
    reset,
    picker
  );
}

/**
 * 让用户选一张图：本地上传 或 链接
 * @param {(src:string)=>void} onPick
 */
export function chooseImage(onPick) {
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  document.body.appendChild(fileInput);

  const cleanup = () => fileInput.remove();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    cleanup();
    if (!file) return;
    try {
      onPick(await fileToDataUrl(file, { max: 1600, quality: 0.82 }));
    } catch {
      /* 忽略读取失败 */
    }
  });

  showSheet({
    title: '选择图片来源',
    items: [
      { label: '本地图片', icon: 'image', onClick: () => fileInput.click() },
      {
        label: '图片链接',
        icon: 'link',
        onClick: async () => {
          const v = await showForm({
            title: '图片链接',
            fields: [{ key: 'url', label: '图片链接', placeholder: 'https://...' }],
            submitLabel: '确定'
          });
          if (v) onPick(v.url);
        }
      },
      {
        label: '清除背景',
        icon: 'close',
        onClick: () => onPick('')
      }
    ]
  });
}

/** 可点击的列表行 */
export function listRow({ label, sub, iconName, value, onClick, danger }) {
  return h('div', {
    class: 'row',
    style: danger ? { color: 'var(--danger)' } : null,
    onClick
  },
    iconName ? icon(iconName, 20, 'ico row-ico') : null,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', text: label, style: danger ? { color: 'inherit' } : null }),
      sub ? h('div', { class: 'row-sub', text: sub }) : null
    ),
    value ? h('span', { class: 'row-sub', style: { margin: '0', flex: 'none' }, text: value }) : null,
    h('span', { class: 'chev' }, icon('chev', 18))
  );
}

/** 开关 */
export function switchBox({ checked = false, onChange }) {
  const el = h('button', {
    type: 'button',
    class: 'switch' + (checked ? ' on' : ''),
    onClick: (e) => {
      e.stopPropagation();
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      if (onChange) onChange(next);
    }
  }, h('span', { class: 'knob' }));
  return el;
}

/** 带操作按钮的输入行 */
export function fieldWithButton({ label, value, placeholder, onChange, buttonLabel, buttonIcon, onButton, type = 'text' }) {
  const input = h('input', {
    class: 'field',
    type,
    value: value || '',
    placeholder: placeholder || '',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false'
  });
  input.addEventListener('change', () => onChange(input.value.trim()));

  return h('label', { class: 'form-row', style: { padding: '11px 14px' } },
    h('span', { class: 'form-label', text: label }),
    h('div', { class: 'field-with-btn' },
      input,
      h('button', { class: 'btn sm', onClick: onButton },
        buttonIcon ? icon(buttonIcon, 17) : null,
        buttonLabel ? h('span', { text: buttonLabel }) : null
      )
    )
  );
}
