/** 全屏加载遮罩 */

let node = null;

export function showLoading(text = '加载中') {
  if (node) return;
  node = document.createElement('div');
  node.className = 'loading';
  node.innerHTML = `<div class="spin"></div><div class="txt"></div>`;
  node.querySelector('.txt').textContent = text;
  document.getElementById('layer-root').appendChild(node);
}

export function setLoadingText(text) {
  if (node) node.querySelector('.txt').textContent = text;
}

export function hideLoading() {
  if (!node) return;
  node.remove();
  node = null;
}

/** 按钮内联 loading（保留宽度） */
export async function withBusy(btn, text, task) {
  const raw = btn.innerHTML;
  btn.disabled = true;
  if (text) btn.textContent = text;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.innerHTML = raw;
  }
}
