/**
 * 长按拖动排序（Pointer Events，移动端 / 桌面通用）
 *
 * 交互：按住 320ms 进入拖动（此时会轻微震动），期间上下移动换位；
 * 未到时间就滑动 = 正常滚动，不会误触发。
 *
 * 用法：
 *   sortable(container, { onEnd: (ids) => store.setXxx(ids) })
 *   container 的直接子元素需带 data-sort-id
 */

const HOLD_MS = 320;
const SLOP = 10; // 超过这个位移就认为是滚动，取消长按

export function sortable(container, { onEnd, onStart, handle } = {}) {
  const itemSel = '[data-sort-id]';

  let timer = null;
  let pending = null;
  let drag = null;
  let ph = null;
  let startX = 0;
  let startY = 0;
  let grabTop = 0;

  const isActive = () => !!drag;
  const members = () => [...container.querySelectorAll(itemSel)].filter((el) => el !== drag);

  /* 拖动期间阻断页面滚动：非 passive 的 touchmove 是唯一可靠手段 */
  function onTouchMove(e) {
    if (isActive()) e.preventDefault();
  }
  container.addEventListener('touchmove', onTouchMove, { passive: false });

  function begin(el, y) {
    const r = el.getBoundingClientRect();
    grabTop = y - r.top;

    ph = document.createElement('div');
    ph.className = 'sort-ph';
    ph.style.height = `${r.height}px`;

    el.parentNode.insertBefore(ph, el);
    el.style.width = `${r.width}px`;
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.classList.add('sort-drag');
    document.body.appendChild(el);

    drag = el;
    container.classList.add('sorting');
    document.documentElement.classList.add('sort-lock');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* 忽略 */ } }
    if (onStart) onStart(el);
  }

  /** 拖动结束后浏览器还会补一个 click，会把「点按 = 编辑」误触发，这里吞掉它 */
  function swallowNextClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 500);
  }

  function track(y) {
    drag.style.top = `${y - grabTop}px`;
    const target = members().find((it) => {
      const r = it.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (target) container.insertBefore(ph, target);
    else container.appendChild(ph);
  }

  function finish() {
    if (!drag) return;
    const el = drag;
    const host = ph.parentNode;

    el.classList.remove('sort-drag');
    el.style.width = '';
    el.style.left = '';
    el.style.top = '';
    host.insertBefore(el, ph);
    ph.remove();
    swallowNextClick();

    drag = null;
    ph = null;
    container.classList.remove('sorting');
    document.documentElement.classList.remove('sort-lock');

    if (onEnd) onEnd([...container.querySelectorAll(itemSel)].map((n) => n.dataset.sortId));
  }

  function release() {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!drag) {
      if (pending && (Math.abs(e.clientX - startX) > SLOP || Math.abs(e.clientY - startY) > SLOP)) release();
      return;
    }
    e.preventDefault();
    track(e.clientY);
  }

  function onUp() {
    if (drag) finish();
    release();
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target.closest(itemSel);
    if (!el || !container.contains(el)) return;
    if (handle ? !e.target.closest(handle) : e.target.closest('button, input, textarea, select')) return;

    pending = el;
    startX = e.clientX;
    startY = e.clientY;

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    timer = setTimeout(() => {
      timer = null;
      if (pending) begin(pending, startY);
    }, HOLD_MS);
  }

  container.addEventListener('pointerdown', onDown);

  return {
    destroy() {
      release();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('touchmove', onTouchMove);
    }
  };
}
