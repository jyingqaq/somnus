/**
 * 底部「有新版本可用」提示条。
 *
 * 只干一件事：把 pwa.js 那边「新壳已装好、正卡在 waiting」的状态画出来，
 * 用户点了才切壳并重开。判定与切壳全在 js/pwa.js 里，这里不自己判。
 *
 * 为什么不复用 toast：toast 是 1.8 秒就走的轻提示，而这条要一直挂着等用户
 * 决定（他可能正写到一半，不想现在重开）。所以是常驻条 + 可关掉。
 *
 * 关掉只是「这一次别再提了」（`dismissed` 是模块内的会话态，不写存档）：
 * 等新壳真的生效（状态回到 false）再出现下一版时会重新提。
 */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { onUpdateChange, applyUpdate } from '../pwa.js';

let bar = null;
let dismissed = false;

function build() {
  const action = h('button', { class: 'btn primary sm', text: '立即更新' });
  action.addEventListener('click', () => {
    // 点了之后别让按钮还能再点一次：切壳 + 重开是不可逆的
    action.disabled = true;
    action.textContent = '更新中…';
    applyUpdate();
  });

  bar = h('div', { class: 'update-bar', hidden: true },
    icon('refresh', 18, 'ico up-ico'),
    h('div', { class: 'up-text', text: '有新版本可用' }),
    action,
    h('button', {
      class: 'up-x',
      title: '稍后再说',
      onClick: () => { dismissed = true; bar.hidden = true; }
    }, icon('close', 16))
  );

  // 挂在 layer-root（toast 也在这儿）：它不在 #view 里，换页时不会被一起重画
  document.getElementById('layer-root').appendChild(bar);
}

/** 挂上提示条；应用启动时调一次即可。 */
export function mountUpdateBar() {
  onUpdateChange((ready) => {
    if (!bar) build();
    // 状态回落 = 这一版已经生效了，把「稍后再说」也一起清掉，
    // 否则下一次更新会继承上一次的静音，用户永远看不到提示。
    if (!ready) dismissed = false;
    bar.hidden = !ready || dismissed;
  });
}
