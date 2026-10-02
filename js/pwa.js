/**
 * PWA 接入：注册 Service Worker + 管理「安装到桌面」入口。
 *
 * 注册失败一律静默 —— 这个应用在没有 SW 的环境下（比如 file:// 直接打开）
 * 完全可用，不该因为装不上 SW 就白屏或报错。
 */

import { toast } from './components/toast.js';

/* beforeinstallprompt 只能触发一次，事件对象必须先存住，等用户点按钮时再用 */
let deferredPrompt = null;

/** 已装成独立应用（standalone）或 iOS 已加到主屏时，不再显示安装入口 */
let installed = false;

const listeners = new Set();

/** @returns {boolean} 当前是否可以弹出安装对话框 */
export function canInstall() {
  // 每次都重新读一次 display-mode，不能只信 initPwa 时缓存的快照：
  // 用户装完应用后切回同一个浏览器标签页，模块状态不会重置，
  // 缓存的 installed 仍是 false，入口会一直赖着不走。
  detectInstalled();
  return !!deferredPrompt && !installed;
}

/** 订阅安装状态变化，返回取消订阅函数 */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(canInstall()));
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
 * iOS Safari 没有 beforeinstallprompt，只能引导用户手动「添加到主屏幕」。
 * @returns {boolean} 命中 iOS 且尚未安装
 */
export function isIosStandalone() {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ 默认报 Mac，用触点数补判
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isChrome = /CriOS|FxiOS|EdgiOS/.test(ua);
  if (!isIos || isChrome) return false;

  // 已加到主屏就别再教用户加一次了
  if (window.navigator.standalone
    || window.matchMedia('(display-mode: standalone)').matches) return false;

  return true;
}

function detectInstalled() {
  installed = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  detectInstalled();

  window.addEventListener('beforeinstallprompt', (e) => {
    // 拦掉 Chrome 自带的小横幅，改由应用内入口引导
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    emit();
    toast('已添加到桌面');
  });

  // 用户从浏览器标签切到已安装的独立应用时，同步一次显示模式
  const mq = window.matchMedia('(display-mode: standalone)');
  const onModeChange = () => {
    detectInstalled();
    emit();
  };
  if (mq.addEventListener) mq.addEventListener('change', onModeChange);
  else if (mq.addListener) mq.addListener(onModeChange);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // file:// 下必然失败，属于预期情况，不打扰用户
    });
  });
}
