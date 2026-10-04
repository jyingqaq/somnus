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

/*
 * 改这里来让已装机的用户拿到新资源： activate 时会清掉所有旧版缓存。
 *
 * v3：加号光晕改成跟随主题色（涉及 css/components.css + js/theme.js）。
 * 老客户端里这两份旧资源是配套缓存的，光晕会一直锁死在紫色；
 * cache-first 对同源资源不主动换 URL，只能靠换缓存名强制丢弃整份旧壳。
 *
 * v4：收藏到书架的命名规则改了（js/store.js + js/views/creation.js + js/views/book.js）——
 * 首页标题当书名、正文进「第1章」。仅靠后台更新收敛太慢：cache-first 会一直拿旧
 * creation.js 渲染，用户点收藏看到的还是「书名 = 第一章名」的旧行为，所以换缓存名。
 *
 * v5：图标挪进 icons/（index.html + manifest.webmanifest + 本项目 SHELL 三处路径一起改）；
 * 同轮还改了章节页的改名入口（js/components/topbar.js + js/views/chapter.js + components.css）。
 * 路径变了，旧壳里那 7 条根目录图标缓存已经没人引用，换缓存名顺手清掉。
 *
 * v6：首页输入框的加号展开后，点功能图标不再自动收起（js/components/composeBox.js）——
 * 只有再点那个 × 才收回，方便连续挑角色 / 世界书 / 灵感。同理只能换缓存名，
 * 否则已装机用户手里的旧 composeBox.js 还是「点一下就收」的老行为。
 *
 * v7：备份改成了「只收文字内容」，恢复时不再动外观与设置
 * （js/services/backup.js + store.replaceContent + js/views/backup.js），
 * 并新增云端备份页（js/services/cloud*.js + js/views/backupCloud.js）。
 * 换缓存名的理由是恢复语义变了：旧壳里的备份页会在恢复后调 applyAppearance() 重下外观，
 * 而新备份里根本没有外观可恢复 —— 两份混用会出现「恢复一次，外观被清成默认」。
 *
 * v11：没配 API 时不再先进「创作中」（新增 js/components/apiGate.js，
 * 首页生成 / 续写 / 拉评论三处都在 showLoading 之前先拦一次）。
 * 换缓存名的理由同 v6：已装机用户手里那份旧 views/home.js 点下去还是会转一圈再报 401。
 */
const VERSION = 'v12';
const CACHE = `somnus-${VERSION}`;
/* 应用壳：与 index.html 实际引用的文件保持一致 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/a783.gif',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',

  './css/base.css',
  './css/layout.css',
  './css/components.css',

  './js/app.js',
  './js/router.js',
  './js/routes.js',
  './js/store.js',
  './js/theme.js',
  './js/pwa.js',

  './js/components/apiGate.js',
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
  './js/services/cloud.js',
  './js/services/cloudConfig.js',
  './js/services/comment.js',
  './js/services/commentParser.js',
  './js/services/docImport.js',
  './js/services/prompt.js',
  './js/services/promptSchema.js',

  './js/util/color.js',
  './js/util/dom.js',
  './js/util/icons.js',

  './js/views/backup.js',
  './js/views/backupCloud.js',
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

  /* 同源静态资源：cache-first + 后台更新。
     后台那一次必须绕开 HTTP 缓存（no-cache = 强制向服务器验证），
     否则浏览器启发式缓存里的旧响应会被原样写回 SW 缓存 ——
     看起来是 cache-first + revalidate，实际永远收敛不到新版本，
     改完样式用户刷新多少次看到的都还是旧的。 */
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req, { cache: 'no-cache' })
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
