/** 我的 · 提示词（入口：选择创作 / 续写 / 评论） */

import { h } from '../util/dom.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { listRow } from '../components/controls.js';
import { KINDS } from '../services/prompt.js';
import { back, navigate } from '../router.js';

const ICONS = { create: 'edit', continue: 'layers', comment: 'chat' };

export function render() {
  const page = h('div', { class: 'page' });

  page.append(
    topbar({ title: '提示词', back: true, align: 'center', onBack: () => back('/me') }),
    h('div', { class: 'card' },
      h('div', { class: 'list' }, Object.entries(KINDS).map(([kind, meta]) => {
        const cfg = store.promptOf(kind);
        const on = cfg.blocks.filter((b) => b.enabled !== false).length;
        return listRow({
          label: meta.label,
          sub: `${meta.desc} · ${on}/${cfg.blocks.length} 块生效`,
          iconName: ICONS[kind],
          onClick: () => navigate(`/prompt/${kind}`)
        });
      }))
    )
  );

  return page;
}
