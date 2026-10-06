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
 *
 * v13：首页输入框挑角色 / 世界书 / 灵感时也走文件夹分组了
 * （新增 js/components/collectionPicker.js + collectionList.js，
 * 选取面板与管理页共用同一套行结构）。换缓存名的理由同 v6：
 * 旧壳里的 home.js 点「角色」还是把全部条目平铺出来，看不到文件夹。
 *
 * v14：新增「更新提示」——打开应用时若有没看过的更新会弹一次说明，点「已阅」不再出现
 * （新增 js/changelog.js + js/services/updateNotice.js + js/views/settingsUpdates.js，
 * 改动 js/app.js · js/components/modal.js · js/views/settings.js · css/components.css）。
 * 换缓存名同 v6：这份更新日志本身就要靠新壳发到用户手里，而且旧壳里的 modal.js
 * 没有 closable 选项 —— 混用会出现「× 还在、点掉不算已阅、下次又弹」。
 *
 * v17：「收藏」的判据与收尾收进了 store（js/store.js 新增 collectedBook / isCollected /
 * collectCreation / uncollectCreation / removeBooks，并改动 js/views/{home,creation,shelf}.js）。
 * 以前书架里删掉书之后 creations[].bookId 会变成悬空指针，首页那条创作仍然挂着
 * 「已收藏」的书签图标、点进详情却是空星标。换缓存名的理由同 v6：旧壳里的 home.js
 * 只看 bookId 有没有值，这一轮不换壳，用户看到的还是那个自相矛盾的图标。
 *
 * v18：删创作不再连带删书架（js/views/creation.js，另见 js/store.js 里 removeBooks
 * 的注释）。以前在创作详情里点删除会 store.removeBooks(item.bookId)，书架里收藏的那本
 * 跟着一起没 —— 用户就不敢删首页的条目，列表越堆越长。现在只删创作，书留在书架里。
 * 换缓存名的理由同 v6：旧壳里的 creation.js 删一下还是「一删俱删」，不换壳就白改。
 *
 * v19：装了桌面的用户老是拿不到新版 —— 改成「提示式更新」
 * （新增 js/components/updateBar.js，改动 js/pwa.js · js/app.js · css/components.css）。
 * 根因不在检查上：浏览器**能**发现新 sw.js 并把它装好，但新壳会一直卡在 waiting，
 * 因为「丢掉整份旧壳」绑在 activate 上，而 activate 必须等所有窗口关光 ——
 * 装到桌面的应用恰恰很少被真正关掉（挂后台、从图标点回来复用同一个文档，
 * 连导航都没有，所以连检查都不发生）。下面的 message 监听其实早就留好了
 * skip-waiting，只是全项目没人发过这条消息，这次才接上：pwa.js 现在会盯
 * waiting（updatefound/statechange + 从后台切回来时主动 update()），底部提示条
 * 让用户点一下才切壳并重开。
 * 换缓存名的理由同 v6：旧壳里的 pwa.js 只 register、不看 waiting，
 * 已装机的用户还是只能靠「把所有窗口关光」碰运气。
 *
 * v21：自动提示全部撤掉，更新改成用户主动获取
 * （删掉 js/components/updateBar.js；js/pwa.js 去掉 updateReady 状态与
 * visibilitychange 自动检查、改成导出 checkForUpdates()；删掉 updateNotice.js
 * 里的自动弹窗、新增 fetchRemoteUpdates()/newerUpdates()；
 * js/views/settingsUpdates.js 重写成「获取更新」页；js/app.js · js/views/settings.js
 * · css/components.css 跟着改）。
 *
 * 那两处自动出现的 UI（打开就弹的「更新说明」弹窗、底部常驻的「有新版本可用」条）
 * 不可控 —— 挡内容、抢 #modal-root、正在写的时候冒出来 —— 用户要求撤掉。
 * 现在唯一入口是「设置 → 获取更新」：点一下才查有没有新壳，先把这次改了什么列出来
 * （线上的 changelog 要现拉，本机跑的这份是旧壳里的、不知道新条目），再由用户
 * 点「立即更新」切壳重开。pwa.js 里 checkForUpdates() 仍然走同一套
 * skip-waiting 通路，只是发起者从「自动」换成了「用户点按钮」。
 *
 * 还有一处顺带改的：**带查询串的同源请求不再进缓存**（见下面 fetch 里那句）——
 * 拉线上 changelog 时 URL 上挂了个时间戳防 cache-first，不拦一下的话
 * 每点一次「获取更新」就往缓存里塞一份，白堆。
 *
 * 换缓存名的理由同 v6：旧壳里那份 js/app.js 还会挂底部提示条、
 * 旧壳里的 js/pwa.js 也没有 checkForUpdates —— 不换壳，
 * 「设置 → 获取更新」这个按钮点下去查不到任何东西。
 */
const VERSION = 'v21';
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
  './js/changelog.js',
  './js/router.js',
  './js/routes.js',
  './js/store.js',
  './js/theme.js',
  './js/pwa.js',

  './js/components/apiGate.js',
  './js/components/collectionList.js',
  './js/components/collectionPicker.js',
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
  './js/services/updateNotice.js',

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
  './js/views/settingsUpdates.js',
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

  /*
   * 带查询串的同源请求：同样放行。
   *
   * 唯一会这么发的是「获取更新」时拉线上更新日志（js/services/updateNotice.js
   * 给 ../changelog.js 挂了个时间戳，用来绕开下面这套 cache-first）。
   * 若还走缓存逻辑，每点一次「获取更新」就会往缓存里塞一份新的 changelog，
   * 而这些 URL 再也不会被访问第二次 —— 纯白堆。
   */
  if (url.search) return;

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
