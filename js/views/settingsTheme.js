/** 设置 · 主题 / 主题色 / 背景 / 字体 / 上下栏透明度 */

import { h } from '../util/dom.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showSheet } from '../components/modal.js';
import { slider, colorRow, listRow } from '../components/controls.js';
import { back } from '../router.js';
import { applyAppearance, defaultAccent } from '../theme.js';
import { openBackgroundPanel } from '../panels/background.js';
import { openFontPanel } from '../panels/fonts.js';

const THEMES = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
];

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  function draw() {
    slot.replaceChildren();
    const ap = store.getState().appearance;
    const theme = THEMES.find((t) => t.value === (ap.theme || 'system'));

    slot.appendChild(topbar({
      title: '主题',
      back: true,
      align: 'center',
      onBack: () => back('/settings')
    }));

    slot.appendChild(h('div', { class: 'card' },
      listRow({
        label: '暗色模式',
        iconName: 'spark',
        value: theme ? theme.label : '跟随系统',
        onClick: () => showSheet({
          title: '暗色模式',
          items: THEMES.map((t) => ({
            label: t.label,
            onClick: () => {
              store.patchAppearance({ theme: t.value });
              applyAppearance();
              draw();
            }
          }))
        })
      }),
      colorRow({
        label: '主题色',
        // 没自定义时展示当前主题的默认色（浅色黑 / 深色白），别写死
        value: ap.accent || defaultAccent(),
        onInput: (v) => {
          store.patchAppearance({ accent: v });
          applyAppearance();
        },
        onReset: () => {
          store.patchAppearance({ accent: '' });
          applyAppearance();
          draw();
        }
      })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '页面' }));
    slot.appendChild(h('div', { class: 'card' },
      listRow({ label: '背景', iconName: 'image', onClick: openBackgroundPanel }),
      listRow({ label: '字体', iconName: 'edit', onClick: openFontPanel })
    ));

    slot.appendChild(h('div', { class: 'section-title', text: '透明度' }));
    slot.appendChild(h('div', { class: 'card' },
      slider({
        label: '顶栏',
        value: ap.barOpacity.top,
        onInput: (v) => {
          store.patchAppearance({ barOpacity: { top: v } });
          applyAppearance();
        }
      }),
      slider({
        label: '底栏',
        value: ap.barOpacity.bottom,
        onInput: (v) => {
          store.patchAppearance({ barOpacity: { bottom: v } });
          applyAppearance();
        }
      }),
      slider({
        label: '卡片与弹窗',
        value: ap.surfaceOpacity == null ? 1 : ap.surfaceOpacity,
        min: 0.15,
        onInput: (v) => {
          store.patchAppearance({ surfaceOpacity: v });
          applyAppearance();
        }
      })
    ));
  }

  draw();
  return page;
}
