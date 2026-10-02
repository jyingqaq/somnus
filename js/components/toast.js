/** 轻提示 */

let root;

/**
 * @param {string} message
 * @param {number} duration
 */
export function toast(message, duration = 1800) {
  if (!root) {
    root = document.createElement('div');
    root.className = 'toast-root';
    document.getElementById('layer-root').appendChild(root);
  }
  // 弹窗打开时 toast 默认的位置（底部）正好压在弹窗的按钮上（保存/取消），
  // 挡住用户刚点的那个按钮。弹窗期间改从顶部出现。
  root.classList.toggle('top', !!document.querySelector('#modal-root .modal-root'));

  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, duration);
  return node;
}
