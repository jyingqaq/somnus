/*
 * Service Worker
 *
 * 职责：把整个应用壳预缓存下来，断网也能打开。
 *
 * 两个必须注意的点：
 *
 * 1) AI 接口请求绝不能进缓存。
 *    js/services/ai.js 走的是外部 OpenAI 兼容端点，如果无脑 cache-first，
 *    续写内容会被冻结在上一次的响应上 —— 用户看到的还是旧结果却以为没生效。
 *    所以 fetch 事件里只对**同源**的静态资源走缓存，跨域请求直接透传。
 *
 * 2) 不要缓存非 GET 请求。
 *    POST /chat/completions 被缓存下来是纯粹的 bug 来源。
 *
 * 缓存策略：
 * - 导航请求（打开页面）：network-first，拿到新版就顺手更新缓存；
 *   断网时回落到缓存的 index.html，保证 PWA 冷启动能起来。
 * - 同源静态资源：cache-first，后台顺带更新（stale-while-revalidate）。
 * - 跨域请求：直接放行，不碰缓存。
 */

const VERSION = 'v1';
const CACHE = `somnus-${VERSION}`;
/* 应用壳：与 index.html 实际引用的文件保持一致 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './a783.gif',
  './a783-32.png',
  './a783-icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',

  './css/base.css',
  './css/layout.css',
  './css/components.css',

  './js/app.js',
  './js/router.js',
  './js/routes.js',
  './js/store.js',
  './js/theme.js',
  './js/pwa.js',

  './js/components/composeBox.js',
  './js/components/controls.js',
  './js/components/dropdown.js',
  './js/components/editor.js',
  './js/components/loading.js',
  './js/components/modal.js',
  './js/components/nav.js',
  './js/components/sortable.js',
  './js/components/toast.js',
  './js/components/topbar.js',

  './js/panels/background.js',
  './js/panels/fonts.js',

  './js/services/ai.js',
  './js/services/backup.js',
  './js/services/comment.js',
  './js/services/commentParser.js',
  './js/services/docImport.js',
  './js/services/prompt.js',
  './js/services/promptSchema.js',

  './js/util/color.js',
  './js/util/dom.js',
  './js/util/icons.js',

  './js/views/backup.js',
  './js/views/book.js',
  './js/views/chapter.js',
  './js/views/creation.js',
  './js/views/home.js',
  './js/views/library.js',
  './js/views/profile.js',
  './js/views/prompt.js',
  './js/views/promptEdit.js',
  './js/views/settings.js',
  './js/views/settingsApi.js',
  './js/views/settingsTheme.js',
  './js/views/shelf.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 逐个 add 而不是 addAll：addAll 是全有或全无，
      // 任何一个文件 404 都会让整次安装失败、静默地装不上。
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => {}))
      ))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 跨域（含 AI 接口）：一律放行，不读也不写缓存 */
  if (url.origin !== self.location.origin) return;

  /* 页面导航：network-first，断网回落缓存 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* 同源静态资源：cache-first + 后台更新 */
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
