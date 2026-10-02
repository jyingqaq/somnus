/** 颜色工具 */

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

export function rgbToHex({ r, g, b }) {
  const p = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}

/** 线性混色，t=0 返回 a，t=1 返回 b */
export function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k
  });
}

/** 相对亮度 0~1 */
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 1;
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function isLight(hex) {
  return luminance(hex) > 0.55;
}

/** 在给定底色上取可读文字色 */
export function readableOn(hex) {
  return isLight(hex) ? '#12121a' : '#ffffff';
}

export function toRgbTuple(hex) {
  const c = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  return `${c.r}, ${c.g}, ${c.b}`;
}
