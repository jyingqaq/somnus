/**
 * 更新提示：打开应用时若有「还没看过」的更新，弹一次说明。
 *
 * 数据源是 js/changelog.js 的 CHANGELOG —— 它跟代码一起发布（同在一个 sw.js 的
 * SHELL 里预缓存），所以每个装了应用的人都能收到；写进 state 就没这个效果了。
 *
 * 「看到哪一条了」记在 state.ui.lastSeenUpdate：属于界面态，
 * 不进备份、也不跟着云端走 —— 换台设备本来就该重新看一次新版本说明。
 */

import { h } from '../util/dom.js';
import { CHANGELOG } from '../changelog.js';
import { getState, patchUi } from '../store.js';
import { openModal } from '../components/modal.js';

/** 全部更新，新的在前 */
export function updates() {
  return Array.isArray(CHANGELOG) ? CHANGELOG.filter((it) => it && it.id && it.items) : [];
}

/** 最新一条（没有就是 null） */
export function latestUpdate() {
  return updates()[0] || null;
}

/** 某一条的「日期 · 标题」，给设置页当副标题用 */
export function updateSummary(it) {
  if (!it) return '暂无更新记录';
  return [it.date, it.title].filter(Boolean).join(' · ');
}

/**
 * 还没看过的更新。
 *
 * 三条规则，顺序不能反：
 * 1. 看过的那条还在列表里 → 排在它**前面**的都是新的（列表新的在前）。
 * 2. 看过的那条正是最新那条 → 没有新东西。
 * 3. 从没看过（lastSeen 为空，第一次打开），或者那条已经不在列表里了
 *    （条目被删改过）→ **只认最新那一条**。
 *
 * 第 3 条是这里最要紧的一条：绝不能回退成「全部」，
 * 否则第一次打开的用户会被积攒的十几版更新糊一脸。
 *
 * @param {Array} [list] 更新列表，默认取 CHANGELOG
 * @param {string} [lastSeen] 上次已阅的那条 id
 */
export function pendingUpdates(list = updates(), lastSeen = '') {
  if (!list.length) return [];
  const at = lastSeen ? list.findIndex((it) => it.id === lastSeen) : -1;
  if (at === 0) return [];
  return at > 0 ? list.slice(0, at) : [list[0]];
}

/** 记下「已经看到哪一条」，传最新那条的 id */
export function markUpdatesSeen(id) {
  patchUi({ lastSeenUpdate: id || '' });
}

/**
 * 一条更新的正文。弹窗和「更新日志」页共用同一份结构，
 * 免得两边各写一遍、改类名时漏一处。
 * @param {object} it 更新条目
 * @param {string} [tag] 可选的小标签（日志页用来标「最新」）
 */
export function updateItem(it, tag) {
  return h('div', { class: 'un-item' },
    h('div', { class: 'un-meta' },
      tag ? h('span', { class: 'un-tag', text: tag }) : null,
      h('span', { class: 'un-title', text: it.title || '' }),
      it.date ? h('span', { class: 'un-date', text: it.date }) : null
    ),
    h('ul', { class: 'un-list' }, (it.items || []).map((t) => h('li', { text: t })))
  );
}

/**
 * 有没看过的更新就弹窗，返回是否弹了（给调用方和测试一个明确的信号）。
 *
 * 弹窗刻意**只留「已阅」一条出路**（点遮罩不关、右上角也没有 ×）：
 * 需求就是「每次更新只弹一次」，随手点掉、下次又弹反而更烦人。
 */
export function showUpdateNoticeIfAny() {
  const list = updates();
  const pending = pendingUpdates(list, getState().ui.lastSeenUpdate);
  if (!pending.length) return false;

  openModal({
    title: '更新说明',
    body: h('div', {}, pending.map((it) => updateItem(it))),
    dismissable: false,
    closable: false,
    actions: [{
      label: '已阅',
      kind: 'primary',
      onClick: (close) => { markUpdatesSeen(list[0].id); close(); }
    }]
  });
  return true;
}
