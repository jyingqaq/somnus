/**
 * PWA 接入：注册 Service Worker + 管理「安装到桌面」入口。
 *
 * 注册失败一律静默 —— 这个应用在没有 SW 的环境下（比如 file:// 直接打开）
 * 完全可用，不该因为装不上 SW 就白屏或报错。
 */

import { toast } from './components/toast.js';

/* beforeinstallprompt 只能触发一次，事件对象必须先存住，等用户点按钮时再用 */
let deferredPrompt = null;

const listeners = new Set();

/**
 * 订阅安装状态变化，返回取消订阅函数 */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(installState()));
}

/**
 * 当前处于哪种安装状态。
 *
 * 这个判断刻意**不依赖 beforeinstallprompt**：Chrome 要等用户点过一次、
 * 停留满 30 秒才派发该事件，而菜单里的「安装应用」早就可用了。
 * 若把入口显示与否绑在那个事件上，新用户打开网页会看到「没有安装按钮，
 * 但浏览器菜单里却能装」的自相矛盾现象。
 *
 * @returns {'installed'|'native'|'ios'|'menu'}
 *   installed —— 已装成独立应用，不必再提示
 *   ios       —— iOS 手动「添加到主屏幕」
 *   native    —— 浏览器已给出安装能力，可直接弹原生对话框
 *   menu      —— 条件未满足（多半是参与度不足），引导走浏览器菜单
 */
export function installState() {
  if (isStandalone()) return 'installed';
  // iOS 必须排在 native 前面：部分 iOS 浏览器（Chrome/Firefox for iOS）
  // 会派发这个事件，但系统并不提供原生安装框，点了装不上。
  if (isIosSafari()) return 'ios';
  if (deferredPrompt) return 'native';
  return 'menu';
}

/** 是否已装成独立应用 */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;
}

/** @deprecated 保留兼容，等价于 installState() === 'native' */
export function canInstall() {
  return installState() === 'native';
}

/**
 * 弹出浏览器原生安装对话框。
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  // 一个 prompt 事件只能用一次，无论结果如何都要清掉
  deferredPrompt = null;
  emit();

  return outcome === 'accepted' ? 'accepted' : 'dismissed';
}

/**
 * iOS Safari：没有 beforeinstallprompt，只能引导用户手动「添加到主屏幕」。
 * @returns {boolean} 命中 iOS Safari
 */
export function isIosSafari() {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ 默认报 Mac，用触点数补判
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // iOS 上的 Chrome / Firefox / Edge 同样没有这个事件，别误导成 Safari 路径
  const isIosChrome = /CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && !isIosChrome;
}

/* ==================== 新版本提示 ==================== */
/*
 * 更新是**提示式**的：新壳下载好之后不偷偷接手、更不偷偷刷新，只在底部挂一条
 * 「有新版本可用」，用户点「立即更新」才切过去并重开一次。
 *
 * 为什么非做不可：sw.js 对同源资源是 cache-first，而「丢掉整份旧壳」绑在
 * 新 SW 的 activate 上，activate 又必须等**所有窗口都关光**。装到桌面的应用
 * 恰恰很少被真正关掉（挂后台、从图标点回来是复用同一个文档），于是新壳能蹲在
 * waiting 里好几天 —— 用户那边就成了「更新有时拿得到、有时拿不到」。
 * 这条提示就是给 waiting 那份新壳开的一扇门。
 */

const updateListeners = new Set();
let registration = null;
let updateReady = false;  // 新壳已装好、正卡在 waiting
let reloading = false;    // 只自动重开一次，避免 controllerchange 打转

/** 订阅「有新版本待启用」，返回取消订阅函数。订阅时会立刻回调一次当前状态。 */
export function onUpdateChange(fn) {
  updateListeners.add(fn);
  fn(updateReady);
  return () => updateListeners.delete(fn);
}

/** 是否有新壳在 waiting（给测试和调试用） */
export function hasUpdateReady() {
  return updateReady;
}

function setUpdateReady(v) {
  if (updateReady === v) return;
  updateReady = v;
  updateListeners.forEach((fn) => fn(v));
}

/**
 * 用户点了「立即更新」：让 waiting 的那份接手，接手完自动重开一次。
 *
 * 没 waiting 的时候（比如用户手快、新壳刚被别的路径启用）直接重开一次兜底 ——
 * 刷新本身就会走一遍 network-first 的导航，拿到的是线上最新的 index.html。
 */
export function applyUpdate() {
  const waiting = registration && registration.waiting;
  if (!waiting) {
    reloadOnce();
    return;
  }
  // 钩子只挂这一次：controllerchange 也会被别的原因触发（用户自己把窗口
  // 全关掉再打开），那种情况下不该替用户刷页。
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
  waiting.postMessage('skip-waiting');
}

function reloadOnce() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

/** 每 CHECK_GAP 才真查一次，免得来回切页时把 sw.js 打得太勤 */
const CHECK_GAP = 5 * 60 * 1000;
let lastCheckAt = 0;

function checkForUpdate() {
  if (document.visibilityState !== 'visible' || !registration) return;
  const now = Date.now();
  if (now - lastCheckAt < CHECK_GAP) return;
  lastCheckAt = now;
  registration.update().catch(() => {});
}

/**
 * 盯住一个正在装的新壳。
 *
 * 只在「installed 且页面已经被**旧**壳控制着」时才提示 —— 这才是「新壳装好了
 * 却卡在 waiting」。第一次安装时 controller 是空的（装完直接 activate），
 * 不能提示，否则全新用户一进来就看到「有新版本」。
 */
function trackIncoming(worker) {
  if (!worker) return;

  const check = () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      setUpdateReady(true);
    }
  };

  worker.addEventListener('statechange', check);
  // 监听挂上之前它可能已经走到 installed 了（见下面那个补一次的调用）
  check();
}

function watchRegistration(reg) {
  // 打开时就已经蹲着一个 waiting 的：上次没更新就退出了，或者系统压根没关过这个应用
  if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);

  /*
   * 壳被换掉了（最典型的路径是用户自己把应用全关掉再打开，waiting 那份顺势 activate）
   * → 提示条该收了，别让用户点一个已经生效的按钮。
   * 我们主动切壳那次不用管：紧接着就 location.reload() 了。
   */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) setUpdateReady(false);
  });

  reg.addEventListener('updatefound', () => trackIncoming(reg.installing));

  /*
   * 补一眼：**首次注册**时 updatefound 是在 register() 解析之前就派发的
   * （注册与安装是同一个动作，等我们拿到 registration 时事件早发过了），
   * 那个事件必然收不到 —— 所以这里主动看有没有正在装的新壳。
   * 首次安装走到 installed 时 controller 还是空的，所以不会因此误报。
   */
  trackIncoming(reg.installing);
}

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    // 拦掉 Chrome 自带的小横幅，改由应用内入口引导
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
    toast('已添加到桌面');
  });

  // 用户从浏览器标签切到已安装的独立应用时，同步一次显示模式
  const mq = window.matchMedia('(display-mode: standalone)');
  const onModeChange = () => emit();
  if (mq.addEventListener) mq.addEventListener('change', onModeChange);
  else if (mq.addListener) mq.addListener(onModeChange);

  /*
   * 从后台切回来时补一次检查。
   *
   * 浏览器只在**导航**时顺带做一次 SW 更新检查，而装到桌面的 PWA 从图标点回来
   * 往往是复用同一个文档（安卓按 home 只是挂后台、iOS 是挂起），根本没有导航 ——
   * 于是新版发出去好几天，用户那边一次都没查过，表现就是「更新时有时无」。
   * 手动 update() 不受浏览器「24 小时最多查一次」那套自动节流限制，所以自己查。
   */
  document.addEventListener('visibilitychange', checkForUpdate);

  window.addEventListener('load', () => {
    // updateViaCache: 'none' —— 做更新检查时别用 HTTP 缓存里的 sw.js。
    // 否则发了新版本（sw.js 里 VERSION 换名）也可能被浏览器压着不生效，
    // 用户就一直停在旧的壳和旧的样式表上。
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        lastCheckAt = Date.now(); // 刚注册过就算查过一次，别紧接着又来一次
        watchRegistration(reg);
      })
      .catch(() => {
        // file:// 下必然失败，属于预期情况，不打扰用户
      });
  });
}

