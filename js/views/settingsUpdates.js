/**
 * 设置 · 更新
 *
 * 这里是应用里**唯一**的更新入口（打开应用不再自动弹说明、底部也不再挂提示条）。
 * 一进来就自动查一次 —— 「点进这个页面」本身就是用户的获取意图，不必再让他点第二次；
 * 想重查还有页面上的「获取更新」按钮。
 *
 * 查到新版本时先把**这次改了什么**列出来，再由用户点「立即更新」 —— 不偷着换壳、
 * 更不偷着刷新（这是写作应用，正在写的字不能被冲掉）。
 */

import { h, clear } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { topbar } from '../components/topbar.js';
import { back } from '../router.js';
import { createBusyButton } from '../components/loading.js';
import { getState } from '../store.js';
import { applyUpdate, checkForUpdates } from '../pwa.js';
import {
  updates, updateItem, pendingUpdates, markUpdatesSeen,
  fetchRemoteUpdates, newerUpdates
} from '../services/updateNotice.js';

/**
 * 「获取更新」的忙态控制器。做成模块级单例的理由同首页那颗「生成剧情」：
 * 检查是异步的，用户可能在等待中离开再回来 —— 回来时按钮是重新渲染的新节点，
 * `attach()` 得把它接过来，忙态才不会丢（细节见 components/loading.js）。
 */
const busy = createBusyButton('获取更新', '检查中…');

/** 当前挂载的那份页面的收尾引用（同首页的 mounted）：回来的是新节点，得对着当前这份画 */
let mounted = null;

export function render() {
  const page = h('div', { class: 'page' });
  page.appendChild(topbar({
    title: '更新',
    back: true,
    align: 'center',
    onBack: () => back('/settings')
  }));

  const list = updates();
  // 「哪些还没看过」要在渲染前算：渲染完就记档，否则每次进来都标一遍
  const unseen = new Set(pendingUpdates(list, getState().ui.lastSeenUpdate).map((it) => it.id));

  page.appendChild(checkCard());
  if (list.length) {
    page.appendChild(h('div', { class: 'sec-gap' }));
    page.appendChild(h('div', { class: 'card' },
      // 「最新」只给第一条；其余的没看过就标「新」
      list.map((it, i) => updateItem(it, i === 0 ? '最新' : (unseen.has(it.id) ? '新' : '')))
    ));
  } else {
    page.appendChild(h('div', { class: 'empty', text: '还没有更新记录' }));
  }

  // 记档要在渲染之后：标「新」用的是渲染前算出来的那份
  if (list.length) markUpdatesSeen(list[0].id);
  return page;
}

/** 顶部那张「有没有新版本」的卡 */
function checkCard() {
  const state = h('div', { class: 'up-state', text: '看看有没有新版本' });
  const extra = h('div', { class: 'up-extra' });

  const label = h('span', { class: 'up-get-label', text: '获取更新' });
  const btn = h('button', { class: 'btn primary up-get' },
    icon('refresh', 18),
    label
  );
  btn.addEventListener('click', () => run());

  const mine = { state, extra };
  mounted = mine;
  // 第二参是**文案节点**：忙态只换文字，别把左边那颗刷新图标一起抹掉
  busy.attach(btn, label);
  // 进页面就查一次（异步，页面先画出来再说）
  setTimeout(() => { if (mounted === mine) run(); }, 0);

  // state 在上，查到的新内容在中间，按钮垫底 —— 有新版时会多出一颗
  // 「立即更新」压在「获取更新」上方，那颗才是当前该按的
  return h('div', { class: 'card up-card' }, h('div', { class: 'up-body' }, state, extra, btn));

  async function run() {
    if (busy.busy) return;
    busy.start();
    clear(extra);
    state.textContent = '正在检查…';

    /*
     * 两件事各管一头，缺一不可：
     *  - checkForUpdates() 问 Service Worker 有没有新壳（这才是「能不能真的换上去」的判据）
     *  - fetchRemoteUpdates() 拉线上的更新日志，好把「这次改了什么」列给用户
     * 拉不到日志并不代表没有新版本（作者可能忘了写），所以两条路互不牵连。
     */
    let fresh = [];
    try {
      fresh = newerUpdates(await fetchRemoteUpdates());
    } catch {
      fresh = [];
    }
    const status = await checkForUpdates();

    busy.done();
    // 等待期间用户可能已经离开再回来，那就画到当前那份上，别去碰已经摘掉的 DOM
    if (mounted !== mine) return;
    paint(status, fresh);
  }

  function paint(status, fresh) {
    clear(extra);

    /*
     * 只有「真查出点东西」才把「立即更新」摆出来。两条路任一成立都算：
     *  - status === 'new'：Service Worker 那边有新壳，这才是能真换上去的判据
     *  - fresh 非空：线上更新日志里有本机还没有的条目
     * 分开判是因为两者都可能单独成立（作者忘了写日志 / 日志写了但壳没抓到）。
     */
    const offerUpdate = status === 'new' || fresh.length > 0;
    // 有新版时把「立即更新」推到主位，「获取更新」降成次要 —— 两颗黑的堆一起太吵
    btn.classList.toggle('primary', !offerUpdate);

    if (status === 'unsupported') {
      state.textContent = '这个环境没法检查更新（要用 http 打开才能用）';
      return;
    }
    if (status === 'failed') {
      state.textContent = '没连上，稍后再试';
      return;
    }
    if (!offerUpdate) {
      state.textContent = '已经是最新版本';
      return;
    }

    state.textContent = '发现新版本';
    if (fresh.length) {
      extra.append(
        h('div', { class: 'up-lead', text: '这次改了什么：' }),
        h('div', { class: 'up-new' }, fresh.map((it) => updateItem(it)))
      );
    }

    const go = h('button', { class: 'btn primary up-go', text: '立即更新' });
    go.addEventListener('click', () => {
      // 点完别让按钮还能再点一次：切壳 + 重开是不可逆的
      go.disabled = true;
      go.textContent = '更新中…';
      applyUpdate();
    });
    extra.append(
      go,
      h('div', { class: 'up-hint', text: '更新后应用会自动重新打开一次。正在写的内容请先保存。' })
    );
  }
}
