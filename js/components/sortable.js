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

  /* 拖动期间阻断页面滚动 —— 手机上唯一可靠的手段，三个要点缺一不可：
     1) 必须挂 window，不能挂 container。begin() 会把被拖的行挪进 document.body，
        那时它已经不是 container 的后代，挂 container 的 touchmove 再也收不到事件；
        收不到 → 没人 preventDefault → 浏览器把「移动」当滚动接管，发 pointercancel，
        行当场弹回原位（就是「长按后一移就动不了、复原了」）。
     2) 必须真的 preventDefault 掉**第一下** touchmove。`touch-action` 是手势开始时
        （pointerdown 那一刻）一次性判定的，进入拖动后才给元素补 `touch-action:none`
        对当前这根手指不生效；只有取消掉首个可取消的 touchmove，
        浏览器才会放弃接管手势、不再发 pointercancel。
     3) 非 passive 才有权 preventDefault，别省。

     顺带一个实测结论，省得以后又去加「等待期也拦一下」的保险：
     Chrome 在位移没过它自己的手势门限之前**根本不派发 touchmove**（实测 5px / 9px
     的移动一次都没有，40px 才有），而那个门限不比这里的 SLOP 小。所以「还没到长按时长
     就被浏览器判成滚动」这条路不存在，HOLD_MS 期间不需要额外拦截。 */
  function onTouchMove(e) {
    if (isActive() && e.cancelable) e.preventDefault();
  }
  window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });

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
  container.classList.add('sortable');

  return {
    destroy() {
      release();
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('touchmove', onTouchMove, true);
      container.classList.remove('sortable');
    }
  };
}
