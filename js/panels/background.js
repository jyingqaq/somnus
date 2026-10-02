/** 外观 · 背景设置面板 */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { openModal } from '../components/modal.js';
import { slider, chooseImage } from '../components/controls.js';
import { applyAppearance } from '../theme.js';

const SECTIONS = [
  { key: 'home', label: '首页' },
  { key: 'shelf', label: '书架' },
  { key: 'me', label: '我的' }
];

export function openBackgroundPanel() {
  const body = h('div');

  const patch = (key, cfg) => {
    store.patchAppearance({ backgrounds: { [key]: cfg } });
    applyAppearance();
    draw();
  };

  const imageBlock = (key, label) => {
    const cfg = store.getState().appearance.backgrounds[key] || { src: '', opacity: 0.35 };
    const thumb = h('div', { class: 'bg-thumb' });
    if (cfg.src) thumb.style.backgroundImage = `url("${cfg.src.replace(/"/g, '\\"')}")`;

    return h('div', { class: 'bg-item' },
      h('div', { class: 'bg-head' },
        thumb,
        h('div', { class: 'bg-name', text: label }),
        h('button', {
          class: 'btn sm',
          onClick: () => chooseImage((src) => patch(key, { ...cfg, src }))
        }, icon('image', 17), h('span', { text: '设置' }))
      ),
      slider({
        label: '透明度',
        value: cfg.opacity,
        onInput: (v) => {
          cfg.opacity = v;
          store.patchAppearance({ backgrounds: { [key]: { ...cfg, opacity: v } } });
          applyAppearance();
        }
      })
    );
  };

  function draw() {
    body.replaceChildren();

    const all = store.getState().appearance.backgrounds;

    /* 统一设置 */
    body.appendChild(h('div', { class: 'form', style: { paddingBottom: '4px' } },
      h('div', { class: 'section-title', style: { padding: '2px 0 6px' }, text: '全部页面' }),
      h('button', {
        class: 'btn block',
        onClick: () => chooseImage((src) => {
          SECTIONS.forEach((s) => {
            const cur = all[s.key] || { opacity: 0.35 };
            all[s.key] = { ...cur, src };
          });
          store.patchAppearance({ backgrounds: all });
          applyAppearance();
          draw();
        })
      }, icon('layers', 18), h('span', { text: '统一背景图' })),
      slider({
        label: '透明度',
        value: all.home.opacity,
        onInput: (v) => {
          SECTIONS.forEach((s) => { all[s.key] = { ...all[s.key], opacity: v }; });
          store.patchAppearance({ backgrounds: all });
          applyAppearance();
        }
      })
    ));

    /* 分页面设置 */
    body.appendChild(h('div', { class: 'section-title', text: '分页面' }));
    const card = h('div', { class: 'card' });
    SECTIONS.forEach((s) => card.appendChild(imageBlock(s.key, s.label)));
    body.appendChild(card);
  }

  openModal({
    title: '背景',
    body,
    actions: [{ label: '完成', kind: 'primary', onClick: (close) => close() }]
  });

  draw();
}
