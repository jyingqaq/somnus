/** 外观 · 字体设置面板 */

import { h, debounce } from '../util/dom.js';
import * as store from '../store.js';
import { openModal } from '../components/modal.js';
import { slider } from '../components/controls.js';
import { applyAppearance } from '../theme.js';

const FONTS = [
  { key: 'uiFont', label: '界面字体', sizeKey: 'ui', min: 12, max: 20 },
  { key: 'novelFont', label: '小说字体', sizeKey: 'novel', min: 13, max: 24 }
];

export function openFontPanel() {
  const body = h('div');

  /* ---- 字号拉条 ---- */
  const sizes = store.getState().appearance.fontSize || {};
  body.appendChild(h('div', { class: 'form', style: { paddingBottom: '2px' } },
    slider({
      label: '界面字号',
      value: sizes.ui == null ? 15 : sizes.ui,
      min: FONTS[0].min,
      max: FONTS[0].max,
      step: 0.5,
      format: (v) => `${v}px`,
      onInput: (v) => {
        store.patchAppearance({ fontSize: { ui: v } });
        applyAppearance();
      }
    }),
    slider({
      label: '正文字号',
      value: sizes.novel == null ? 16.5 : sizes.novel,
      min: FONTS[1].min,
      max: FONTS[1].max,
      step: 0.5,
      format: (v) => `${v}px`,
      onInput: (v) => {
        store.patchAppearance({ fontSize: { novel: v } });
        applyAppearance();
      }
    })
  ));
  body.appendChild(h('div', { class: 'sec-gap' }));

  const block = (item) => {
    const cfg = store.getState().appearance[item.key] || { url: '', family: '' };

    const urlInput = h('input', {
      class: 'field',
      value: cfg.url || '',
      placeholder: '字体 CSS 或字体文件链接（.css / .woff2 / .ttf）',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false'
    });
    const familyInput = h('input', {
      class: 'field',
      value: cfg.family || '',
      placeholder: '字体名称（.css 链接时必填）',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false'
    });

    const commit = debounce(() => {
      const url = urlInput.value.trim();
      const family = familyInput.value.trim();
      store.patchAppearance({ [item.key]: { url, family } });
      applyAppearance();
    }, 500);

    urlInput.addEventListener('input', commit);
    familyInput.addEventListener('input', commit);

    const isNovel = item.key === 'novelFont';
    const preview = h('div', {
      class: 'reader',
      style: {
        padding: '10px 0 4px',
        fontFamily: cfg.family ? `"${cfg.family}"` : `var(--font-${isNovel ? 'novel' : 'ui'})`,
        fontSize: `calc(${isNovel ? '16.5px * var(--nfs)' : '15px * var(--fs)'})`
      },
      text: '夜色沉沉，钟声自海雾深处传来。'
    });

    return h('div', { class: 'form', style: { padding: '14px 0 6px' } },
      h('div', { class: 'section-title', style: { padding: '0 0 6px' }, text: item.label }),
      h('label', { class: 'form-row' },
        h('span', { class: 'form-label', text: '字体链接' }),
        urlInput
      ),
      h('label', { class: 'form-row' },
        h('span', { class: 'form-label', text: '字体名称' }),
        familyInput
      ),
      preview,
      h('div', {
        class: 'btn sm plain',
        style: { alignSelf: 'flex-start' },
        text: '清除',
        onClick: () => {
          urlInput.value = '';
          familyInput.value = '';
          store.patchAppearance({ [item.key]: { url: '', family: '' } });
          applyAppearance();
        }
      })
    );
  };

  FONTS.forEach((item, i) => {
    if (i) body.appendChild(h('div', { class: 'sec-gap' }));
    body.appendChild(block(item));
  });

  openModal({
    title: '字体',
    body,
    actions: [{ label: '完成', kind: 'primary', onClick: (close) => close() }]
  });
}
