/** 设置入口页：只做分类跳转 */

import { h } from '../util/dom.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { listRow } from '../components/controls.js';
import { back, navigate } from '../router.js';

const THEMES = { system: '跟随系统', light: '浅色', dark: '深色' };

export function render() {
  const page = h('div', { class: 'page' });
  const s = store.getState().settings;
  const ap = store.getState().appearance;
  // 评论走独立接口时，在副标题上标出来，避免忘了自己配过一套
  const commentTag = store.commentApiDiffers() ? ' · 评论独立' : '';

  page.append(
    topbar({ title: '设置', back: true, align: 'center', onBack: () => back('/me') }),
    h('div', { class: 'card' },
      listRow({
        label: 'API',
        iconName: 'link',
        sub: (s.model || '未设置模型') + commentTag,
        onClick: () => navigate('/settings/api')
      })
    ),
    h('div', { class: 'sec-gap' }),
    h('div', { class: 'card' },
      listRow({
        label: '主题',
        iconName: 'spark',
        sub: THEMES[ap.theme || 'system'],
        onClick: () => navigate('/settings/theme')
      })
    )
  );

  return page;
}
