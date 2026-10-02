/** 底部三个 Tab */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { navigate, onChange, SECTIONS } from '../router.js';

const TABS = [
  { path: '/home', section: 'home', label: '首页', icon: 'home' },
  { path: '/shelf', section: 'shelf', label: '书架', icon: 'book' },
  { path: '/me', section: 'me', label: '我的', icon: 'user' }
];

export function mountNav(el = document.getElementById('tabbar')) {
  const nodes = TABS.map((t) => {
    const node = h('button', { class: 'tab', onClick: () => navigate(t.path) },
      icon(t.icon, 23),
      h('span', { text: t.label })
    );
    el.appendChild(node);
    return node;
  });

  const sync = (path) => {
    const seg = (path || '').split('/').filter(Boolean)[0] || 'home';
    const section = SECTIONS[seg] || 'home';
    TABS.forEach((t, i) => nodes[i].classList.toggle('active', t.section === section));
  };

  onChange(sync);
  sync(location.hash.slice(1) || '/home');
}
