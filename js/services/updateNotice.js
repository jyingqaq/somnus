/**
 * 更新说明：数据源 + 「获取更新」时用得上的判定。
 *
 * ── 应用**不会**自动弹更新说明 ──────────────────────────────
 * 打开时什么都不弹，底部也不挂提示条。用户想看得自己走「设置 → 获取更新」，
 * 在那里点一下，才会：查有没有新版本 → 列出这次改了什么 → 由他决定更不更。
 * （以前那套「打开就弹一次 + 底部挂条」的自动提示撤掉了，太不可控。）
 *
 * ── 这个文件提供三件事 ──────────────────────────────────
 *   1. 读本地这份更新日志（js/changelog.js）：updates / latestUpdate / updateItem …
 *   2. 拉线上的最新日志、算出「比本地新的条目」：fetchRemoteUpdates / newerUpdates
 *   3. 「哪些条目用户还没看过」的记档：pendingUpdates / markUpdatesSeen ——
 *      更新页据此把没看过的标一个「新」字
 *
 * 第 2 条为什么非得真去线上拉：本机跑的这份 js/changelog.js 是**旧壳**里的，
 * 线上新版本的条目它根本不知道 —— 不拉一次，「这次改了什么」就无从谈起。
 *
 * 数据源是 js/changelog.js 的 CHANGELOG —— 它跟代码一起发布（同在一个 sw.js 的
 * SHELL 里预缓存），所以每个装了应用的人都能收到；写进 state 就没这个效果了。
 */

import { h } from '../util/dom.js';
import { CHANGELOG } from '../changelog.js';
import { patchUi } from '../store.js';

/** 只留能用的条目（缺 id / 缺 items 的直接丢） */
function normalize(list) {
  return Array.isArray(list) ? list.filter((it) => it && it.id && it.items) : [];
}

/** 全部更新，新的在前 */
export function updates() {
  return normalize(CHANGELOG);
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
 * 一条更新的正文。更新页的历史列表与「这次的新内容」共用同一份结构，
 * 免得两边各写一遍、改类名时漏一处。
 * @param {object} it 更新条目
 * @param {string} [tag] 可选的小标签（「最新」/「新」）
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
 * 从线上拉一份最新的更新日志。
 *
 * URL 后面那串时间戳不是装饰：同源资源在 sw.js 里是 cache-first，不带 query
 * 的话读到的永远是**旧壳里那一份**，等于白拉。（sw.js 里对带查询串的请求
 * 直接透传，既不读也不写缓存，所以也不会把缓存搅乱。）
 *
 * 离线、或是 file:// 直接打开时这里会抛 —— 调用方自己兜。
 */
export async function fetchRemoteUpdates() {
  const url = new URL('../changelog.js', import.meta.url);
  url.searchParams.set('t', String(Date.now()));
  const mod = await import(url.href);
  return normalize(mod.CHANGELOG);
}

/**
 * 线上比本地多出来的条目 —— 就是「这次更新要告诉用户的内容」。
 *
 * 判据是 id：changelog 只往**最前面**加，所以本地没有的 id 就是新增的。
 * 线上反而更旧（本地是自己改过的开发版）时自然返回空数组。
 */
export function newerUpdates(remote, local = updates()) {
  const known = new Set(local.map((it) => it.id));
  return normalize(remote).filter((it) => !known.has(it.id));
}
