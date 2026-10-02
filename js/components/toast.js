/** 轻提示 */

let root;

export function toast(message, duration = 1800) {
  if (!root) {
    root = document.createElement('div');
    root.className = 'toast-root';
    document.getElementById('layer-root').appendChild(root);
  }
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
