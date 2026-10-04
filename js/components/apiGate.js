/**
 * 「接口还没配好」的统一拦截。
 *
 * 起因：首页点「生成剧情」时 `showLoading('创作中')` 挂在发请求之前，
 * 而默认的 apiBase 本来就带着值（https://api.openai.com/v1），
 * 所以一个什么都没填的用户也会真的发一个注定 401 的请求：
 * 先看到满屏「创作中」转一圈，再收到一条看不懂的「请求失败 401 …」。
 *
 * 于是凡「点一下就要调用 AI」的入口，都在进等待态之前先问一句 requireApi()：
 * 没配好就直接给个带「去设置」的弹窗，连网络请求都不发。
 * 判定规则不写在这里，在 services/ai.js 的 apiProblem()，别在视图里另定一套。
 */

import { h } from '../util/dom.js';
import { openModal } from './modal.js';
import { navigate } from '../router.js';
import { apiProblem } from '../services/ai.js';

/**
 * 弹「还没有可用的接口」：不只是报错，还给一条直达设置的路。
 * @param {string} problem apiProblem() 返回的那句话
 * @param {string} [message] 想覆盖默认正文时传（评论接口有自己的说法）
 */
export function showNoApi(problem, message) {
  openModal({
    title: '还没有可用的接口',
    body: h('div', { class: 'alert-msg' },
      message || `${problem}。创作需要 API 地址和 Key，到「设置 → API」填好就能用了。`),
    actions: [
      { label: '取消', kind: 'plain', onClick: (close) => close() },
      { label: '去设置', kind: 'primary', onClick: (close) => { close(); navigate('/settings/api'); } }
    ]
  });
}

/**
 * 配好了返回 true；没配好弹窗并返回 false，调用方直接 return。
 * **必须在进入等待态之前调用**（首页/书籍是 `createBusy.start()`，
 * 章节是 `commentBusy.start()`），否则又变成「先卡在『创作中……』再报错」。
 * @param {string} [scope] 传 'comment' 判评论专用接口
 */
export function requireApi(scope, { message } = {}) {
  const problem = apiProblem(scope);
  if (!problem) return true;
  showNoApi(problem, message);
  return false;
}
