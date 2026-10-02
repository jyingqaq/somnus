/** 极简 DOM 构造工具 */

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value === true ? '' : value);
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * 长按触发（Pointer Events）
 * 按住 hold 毫秒且位移不超过 slop 才触发；触发后会吞掉随后那一下 click，
 * 避免「长按进入选择模式」的同时又触发了「单击回复」。
 */
export function onLongPress(el, fn, { hold = 420, slop = 10 } = {}) {
  let timer = null;
  let sx = 0;
  let sy = 0;

  const unbind = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', unbind, true);
    window.removeEventListener('pointercancel', unbind, true);
  };

  function onMove(e) {
    if (Math.abs(e.clientX - sx) > slop || Math.abs(e.clientY - sy) > slop) unbind();
  }

  function swallowClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, textarea, select')) return;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      swallowClick();
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* 忽略 */ } }
      fn(e);
    }, hold);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', unbind, true);
    window.addEventListener('pointercancel', unbind, true);
  });

  return unbind;
}

/** 防抖 */
export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** 时间戳转相对/绝对时间 */
export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 图片压缩成 dataURL，最长边不超过 max */
export function fileToDataUrl(file, { max = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hh = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hh;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 图片压缩成正方形 dataURL（头像用） */
export function fileToAvatar(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
