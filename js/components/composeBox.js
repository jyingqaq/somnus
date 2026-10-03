/**
 * 输入框外壳：
 * - 左上角加号，点击后变 ×，右侧依次展开功能图标
 * - 功能图标点完**不**收起面板，只有再点左上角 × 才收回（方便连续挑角色 / 世界书）
 * - 右上角全屏键，点击把整个输入框搬到全屏层；全屏时同一位置变成退出全屏
 */

import { h } from '../util/dom.js';
import { icon, svg } from '../util/icons.js';
import * as store from '../store.js';

/**
 * @param {object} o
 * @param {object} o.editor createEditor() 的返回值
 * @param {Array<{key:string,label:string,icon:string,onClick:Function}>} o.actions
 */
export function createComposeBox({ editor, actions = [] }) {
  // 展开状态跟着用户走：没点过就保持上次的样子，切页回来也不丢
  let open = store.getState().ui.composeOpen === true;
  let openBeforeFullscreen = open;
  let fullscreen = false;
  let host = null;   // 原父节点
  let anchor = null; // 原位置的下一个兄弟节点

  /* ---- 左上角：加号 / 关闭 ---- */
  const toggleIco = h('span', { class: 'ico', html: svg('plus', 20) });
  const toggle = h('button', {
    class: 'cb-btn cb-toggle',
    onClick: () => setOpen(!open)
  }, toggleIco);

  /* ---- 展开的功能图标（只留图标，文字挂在 title 里便于桌面端悬停查看） ---- */
  const items = h('div', { class: 'cb-items' },
    actions.map((a) => h('button', {
      class: 'cb-btn cb-item',
      title: a.label,
      'aria-label': a.label,
      // 点功能图标不收起面板：只有再点加号（×）才收回
      // 这样连续挑角色 / 世界书 / 灵感时不用反复展开
      onClick: () => a.onClick()
    }, icon(a.icon, 18, 'ico')))
  );

  /* ---- 右上角：全屏 / 退出全屏 ---- */
  const fullIco = h('span', { class: 'ico', html: svg('expand', 18) });
  const full = h('button', { class: 'cb-btn cb-full', onClick: () => setFullscreen(!fullscreen) }, fullIco);

  const tools = h('div', { class: 'cb-tools' }, toggle, items, h('div', { class: 'cb-gap' }), full);
  const el = h('div', { class: 'cbox' }, tools, editor.el);

  paintOpen();

  const layer = h('div', { class: 'fs-layer' });

  /** 只改样式，不写库 */
  function paintOpen() {
    el.classList.toggle('open', open);
    toggleIco.innerHTML = svg(open ? 'close' : 'plus', 20);
  }

  function setOpen(v) {
    open = v;
    paintOpen();
    store.patchUi({ composeOpen: open });
  }

  function setFullscreen(v) {
    if (v === fullscreen) return;
    fullscreen = v;
    if (v) {
      // 记住原位（父节点 + 下一个兄弟），退出时插回原处，否则会被追加到页面末尾
      host = el.parentNode;
      anchor = el.nextSibling;
      // 顺带记下功能栏状态：用户没点过加号键，退出全屏时就不该被收起来
      openBeforeFullscreen = open;
      layer.appendChild(el);
      document.body.appendChild(layer);
      el.classList.add('fullscreen');
      fullIco.innerHTML = svg('shrink', 18);
    } else {
      if (host) {
        if (anchor && anchor.parentNode === host) host.insertBefore(el, anchor);
        else host.appendChild(el);
      }
      layer.remove();
      el.classList.remove('fullscreen');
      fullIco.innerHTML = svg('expand', 18);
      setOpen(openBeforeFullscreen);
    }
    editor.focus();
  }

  // 离开当前页面时自动退出全屏，避免输入框残留在 body 上
  window.addEventListener('hashchange', () => setFullscreen(false));

  return {
    el,
    setOpen,
    setFullscreen,
    get fullscreen() { return fullscreen; }
  };
}
