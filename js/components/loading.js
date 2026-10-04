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

/**
 * 按钮内联忙态：等待期间按钮变灰、不可点、文案换成「创作中……」。
 *
 * 用来替代 `showLoading()` 那层全屏遮罩 —— 遮罩会把整个应用按死，
 * 用户只能盯着转圈；换成按钮自己的忙态之后，等待期间照样能去别的页面干别的。
 * 三处 AI 入口都走它：首页「生成剧情」、书籍「续写」、章节「获取评论」。
 *
 * 为什么做成「控制器」而不是一次性的包装：
 * 生成是异步的，用户很可能在等待中离开再**回来**，回来时视图重新渲染、
 * 生成的是一个**新**按钮，而回调闭包里的那个早就被摘掉了 DOM。
 * 所以把「当前该显示忙态的按钮」存在控制器里，每次渲染 `attach()` 重新挂上，
 * `start()` / `done()` 都作用于**最新**那一个 —— 忙态才不会在重渲染后消失。
 * 控制器本身是**模块级单例**，同一时刻只该存在一份对应视图。
 *
 * `attach(btn, labelEl)` 的第二个参数是**文案节点**，缺省就是按钮自己。
 * 按钮里还带图标（「续写」「获取评论」都是 `icon + span`）时必须传：
 * 直接写 `btn.textContent` 会把那个图标一起抹掉。
 */
export function createBusyButton(idleText, busyText = '创作中……') {
  let node = null;
  let label = null;
  let busy = false;
  const paint = () => {
    if (!node) return;
    node.disabled = busy;
    node.classList.toggle('is-busy', busy);
    if (label) label.textContent = busy ? busyText : idleText;
  };
  return {
    /** 每次渲染出新按钮后调用，忙态会立刻补上 */
    attach(btn, labelEl) { node = btn; label = labelEl || btn; paint(); },
    get busy() { return busy; },
    get node() { return node; },
    start() { busy = true; paint(); },
    done() { busy = false; paint(); }
  };
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
