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

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // file:// 下必然失败，属于预期情况，不打扰用户
    });
  });
}
