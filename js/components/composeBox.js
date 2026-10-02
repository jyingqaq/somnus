/**
 * 输入框外壳：
 * - 左上角加号，点击后变 ×，右侧依次展开功能图标；再点收回
 * - 右上角全屏键，点击把整个输入框搬到全屏层；全屏时同一位置变成退出全屏
 */

import { h } from '../util/dom.js';
import { icon, svg } from '../util/icons.js';

/**
 * @param {object} o
 * @param {object} o.editor createEditor() 的返回值
 * @param {Array<{key:string,label:string,icon:string,onClick:Function}>} o.actions
 */
export function createComposeBox({ editor, actions = [] }) {
  let open = false;
  let fullscreen = false;
  let host = null;   // 原父节点
  let anchor = null; // 原位置的下一个兄弟节点

  /* ---- 左上角：加号 / 关闭 ---- */
  const toggleIco = h('span', { class: 'ico', html: svg('plus', 20) });
  const toggle = h('button', {
    class: 'cb-btn cb-toggle',
    onClick: () => setOpen(!open)
  }, toggleIco);

  /* ---- 展开的功能图标 ---- */
  const items = h('div', { class: 'cb-items' },
    actions.map((a) => h('button', {
      class: 'cb-btn cb-item',
      title: a.label,
      onClick: () => { setOpen(false); a.onClick(); }
    },
      icon(a.icon, 17, 'ico'),
      h('span', { class: 'cb-label', text: a.label })
    ))
  );

  /* ---- 右上角：全屏 / 退出全屏 ---- */
  const fullIco = h('span', { class: 'ico', html: svg('expand', 18) });
  const full = h('button', { class: 'cb-btn cb-full', onClick: () => setFullscreen(!fullscreen) }, fullIco);

  const tools = h('div', { class: 'cb-tools' }, toggle, items, h('div', { class: 'cb-gap' }), full);
  const el = h('div', { class: 'cbox' }, tools, editor.el);

  const layer = h('div', { class: 'fs-layer' });

  function setOpen(v) {
    open = v;
    el.classList.toggle('open', open);
    toggleIco.innerHTML = svg(open ? 'close' : 'plus', 20);
  }

  function setFullscreen(v) {
    if (v === fullscreen) return;
    fullscreen = v;
    if (v) {
      // 记住原位（父节点 + 下一个兄弟），退出时插回原处，否则会被追加到页面末尾
      host = el.parentNode;
      anchor = el.nextSibling;
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
      setOpen(false);
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
