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
        // 预设数量按类分别显示：一眼能看出哪几类存过方案，也提示预设不跨类
        const n = store.listPromptPresets(kind).length;
        const parts = [meta.desc, `${on}/${cfg.blocks.length} 块生效`];
        if (n) parts.push(`${n} 个预设`);
        return listRow({
          label: meta.label,
          sub: parts.join(' · '),
          iconName: ICONS[kind],
          onClick: () => navigate(`/prompt/${kind}`)
        });
      }))
    )
  );

  return page;
}
