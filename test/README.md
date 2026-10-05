# 测试

纯函数测试，不依赖浏览器、不依赖构建。直接用 node 跑。

```bash
# 1) 生成 docx 样例（只需一次，产物已随仓库提供）
C:/Users/玥/.workbuddy/binaries/python/versions/3.13.12/python.exe make-sample-docx.py

# 2) 跑用例
node docImport.test.mjs
node commentApi.test.mjs
node apiGate.test.mjs
node settingsApi.render.test.mjs
node backup.test.mjs
node cloudBackup.test.mjs
node promptPreset.test.mjs
node promptEdit.render.test.mjs
node themeColor.test.mjs
node sheetBatch.test.mjs
node collectionPicker.test.mjs
node creationBook.test.mjs
node chapterRename.test.mjs
node updateNotice.test.mjs
node startCmd.test.mjs
```

**`startCmd.test.mjs`** 是**两个批处理脚本共用的**格式守卫（`start.cmd` 和 `push.cmd`）：
编码必须是 **GBK(cp936)**、行尾必须是 CRLF、不能有 BOM，另外校验 `goto`/`call` 的标签都有定义、
`echo` 行里没有裸的 `<` `>` `|` `&`、各自的关键结构没被删。
`node startCmd.test.mjs --fix` 能自动修编码和行尾。**改了任何一个 .cmd 都要跑一次。**

为什么是 GBK 而不是 UTF-8：**cmd.exe 按「当前代码页」逐字节读批处理文件**。
`chcp 65001` + UTF-8 文件时，多字节中文会让读取错位，把行首的 `rem` / `echo` 前缀吞掉，
注释和长提示的碎片就被当成命令执行。同一份脚本实测：
`UTF-8 + chcp 65001` → 9 处 `'xxx' is not recognized`；`GBK + chcp 936` → **0 处**。
「双击后满屏红字」就是这么来的。守卫还额外强制一条：注释必须是纯 ASCII ——
双保险，即使将来换回 UTF-8，注释也不会成为错位的起点。

**`docImport.test.mjs`** 覆盖 `js/services/docImport.js` 的全部对外接口：编码探测（UTF-8 / GB18030 / BOM）、
文本清洗、格式白名单与拦截、docx 解包抽文、多文件合并与错误兜底、体积上限。

`测试角色设定.docx` 是脚本生成的最小 docx（含中文段落、标点、XML 实体、制表符、
空段落），用来验证 zip 解压 + `word/document.xml` 抽文这条链路真的通，
而不是只测纯正则。

**`commentApi.test.mjs`** 覆盖评论专用接口的配置解析（`store.resolveCommentApi` /
`commentApiDiffers`）：关闭时整体跟随主配置、开启后逐项回落、温度 `0` 不被当成空值、
主配置改动不污染已填的评论配置、旧存档缺 `commentApi` 字段时能补全。

这两个用例直接 `import` 真实的 `store.js`，所以文件开头塞了 `localStorage` 替身；
测旧存档时用 `import('../js/store.js?legacy=1')` 换 query 强制模块重新执行，走真实 `load()`。

**`apiGate.test.mjs`** 守两条线：「没配 API 就别进创作中」+「生成中按钮自己变忙态」。

起因：首页点「生成剧情」时 `showLoading('创作中')` 挂在发请求之前，而**默认的 apiBase 本来就带着值**
（`https://api.openai.com/v1`），所以一个什么都没填的用户也会真的发一个注定 401 的请求 ——
先转一圈「创作中」，再收到一条看不懂的「请求失败 401 …」。
判定规则收在 `services/ai.js` 的 `apiProblem()`（**地址和 Key 都得有**），
拦截在 `components/apiGate.js` 的 `requireApi()`；首页生成 / 续写 / 拉评论三处
都必须**在进入等待态之前**调它（首页现在是「先 `requireApi()`，再 `createBusy.start()`」）。

这条路径的等待态后来从「全屏遮罩」改成了**按钮自己的忙态**（见下面「生成中不再盖全屏」一节），
所以用例里原先盯 `.loading` 的断言改成了盯按钮：文案是不是「创作中……」、`disabled` 是不是 true。

四条断言都验过「有没有牙」（都是把实现改坏跑出来的）：

- **`chat()` 没配好时一个请求都不发**（哪怕调用方忘了先判）。把 `ai.js` 里那段兜底删掉，
  这条立刻红 —— 实测 FAIL「没有发出任何请求」。
- **点下去的那一刻界面上没有 `.loading`**。这条必须**同步**读：忙态是在第一个 `await`
  之前切的，等 `await sleep(0)` 之后它已经收干净，「闪一下又收掉」根本抓不住。
  把 `home.js` 里的 `if (!requireApi()) return;` 删掉，实测这条报 `got 1 want 0`。
- **没配好时按钮不许卡在「创作中……」**。这是同一个顺序的守卫：`createBusy.start()`
  要是写在 `requireApi()` 前面，用户会先看到「创作中……」，然后**永远停在那儿**
  —— 这条短路路径没有 `finally` 去还原。
- **切走再回来，忙态得跟过去**：把 `render()` 里的 `createBusy.attach(createBtn)` 删掉，
  实测 7 条红。**用户等待期间新写的字不能被回包冲掉**：把 `mounted.snapshot() === snapshot`
  改成无条件清空，实测 2 条红。

DOM 替身按 `creationBook.test.mjs` 那份抄，但多补了两处，少一处会当场炸：

- **`innerHTML` 要真的解析出子节点**。`loading.js` 是先把
  `<div class="spin"></div><div class="txt"></div>` 塞进 `innerHTML`、再 `querySelector('.txt')`
  写文字的；只存字符串的话 `node.querySelector` 直接报 not a function。
  替身里放了个只认标签和属性的极简解析（原串仍留给 `innerHTML` 读回）。
- **`querySelector` 至少得认 `.class`**（loading 就是这么找文字节点的）。
- **纯文本只落在 `childNodes`** 这条老坑照旧：`El.textContent` 挑的是 `children` 那条路，
  有子元素时返回拼接、没有子元素时返回 `_text` —— 所以断言弹窗正文里有没有某句话，
  得用自己写的 `textOf()` 递归读 `childNodes`。

## 生成中不再盖全屏遮罩（按钮内联忙态）

用户提的：点「生成剧情」后不该弹全屏等待界面，应该让**按钮自己**变成不可点的「创作中……」，
这样等待期间他还能去别的页面干别的，而不是盯着转圈发呆。后来三处 AI 入口都统一成这个做法：

| 入口 | 忙态文案 | 位置 |
|---|---|---|
| 首页「生成剧情」 | 创作中…… | `views/home.js`（`.btn.primary`） |
| 书籍「续写」 | 创作中…… | `views/book.js`（书页底部那颗 `.btn.primary`） |
| 章节「获取评论」 | 生成中 | `views/chapter.js`（`.cm-get`，文案本来就有，缺的只是别再盖遮罩） |

公用件与样式：

| 位置 | 做了什么 |
|---|---|
| `components/loading.js` | 新增 `createBusyButton(idleText, busyText)`，返回 `{ attach, start, done, busy, node }` |
| `views/home.js` · `book.js` · `chapter.js` | 不再用 `showLoading` / `hideLoading`，改用忙态控制器；模块级单例 + `mounted` 收尾引用 |
| `css/components.css` | `.btn.is-busy`（转圈 `::before` + 淡度 `.62`）、`.cm-get.is-busy`（小一号的圈）、`.is-busy .ico { display:none }` |

**四处不写注释就会踩的地方：**

1. **控制器必须是模块级单例，且每次 `render()` / `draw()` 都要 `attach()`。**
   用户很可能在等待中离开再**回来** —— 回来时视图重新渲染、生成的是一个**新**按钮，
   而回调闭包里的那个早就被摘掉了 DOM。只认闭包里那颗按钮的话，切回来按钮就又能点了
   （首页那条 DOM 替身用例里有 7 条断言盯着它；真浏览器里三处各验了一遍）。
2. **`attach(btn, labelEl)` 的第二个参数是文案节点，缺省才是按钮自己。**
   「续写」「获取评论」都是 `icon + span` 结构，直接写 `btn.textContent` 会把图标一起抹掉。
   忙态下原来那颗图标靠 `.is-busy .ico { display: none }` 藏起来、统一用转圈表达 ——
   这条规则同样有用例盯着（删掉它精确红 2 条）。
3. **收尾要对着「当前挂载」的那一份做，首页还要判断用户有没有动过。**
   生成成功是把输入框清空、草稿清掉。但用户可能在等待中回来接着写下一篇 ——
   那样直接清就是**把他刚写的字冲掉**。所以 `views/home.js` 里存了 `mounted`，
   只有 `mounted.snapshot() === 提交时的那份` 才清。
   `book.js` / `chapter.js` 也各存了一份 `mounted`，用来把「新增的章节 / 新评论」刷到
   **现在挂着**的那份视图上（刷错了那份，用户得再进一次这个页面才看得到结果）。
4. **章节那份忙态是跨章节共享的**：A 章在生成评论时，切到 B 章按钮也是「生成中」。
   这是刻意的取舍 —— 换来「同一时刻只有一条评论生成请求」，也堵住了
   「切走再回来、per-instance 标志已经重置、再点一次就是同一条评论生成两遍」这条路。
   它原来就是视图内的 `generating` 变量，改成模块级单例正是为了这个。

CSS 那边有个顺序坑：`.btn.is-busy` 必须写在 `.btn[disabled]` **之后** ——
两者权重相同（0,2,0），靠书写顺序取胜，否则忙态会和普通禁用按钮一样只剩 `.45` 的淡度。
`.cm-get.is-busy` 只补转圈、**不覆盖** `opacity`（`.5` 和 `.62` 肉眼分不出来），
所以它没有这个顺序要求，就近放在 `.cm-get[disabled]` 下面即可。

**`verify-inline-busy.mjs`** 连 `8791` + CDP `9341`（和 `verify-api-gate.mjs` 一套），62 项，
出四张图（`shot-create-busy.png` / `shot-create-busy-done.png` / `shot-continue-busy.png` /
`shot-comment-busy.png`）。三处**各切走一次再切回原页**，断言按钮仍然是忙的。

替身测不到、只有真浏览器能验的几条：按钮 `disabled` 之后**真的点不动**（再点一次
`__fetchCalls` 不涨）、`.is-busy` 的 `::before` 真的挂着 `rot` 动画、忙态淡度确实是 `0.62`
而不是被 `.btn[disabled]` 的 `.45` 抢走、忙态下原图标真的藏了；以及**整段时间里 `.loading`
一次都没出现过**（MutationObserver 数出现次数，闪一下也算）。

> 写这个脚本时自己踩的两个坑：
> **一是假 `fetch` 的延迟别压着流程卡** —— 第一版给 1.4 秒，而中途要切页、截图、再切回来，
> 回来时请求早跑完了，白红两条，看着像功能坏了。现在延迟 4 秒 + 轮询 `waitFor()` 等结束。
> **二是别在读 `opacity` 时踩到 CSS 过渡** —— `.btn` 上有 `transition: opacity .12s`，
> 点下去那一瞬间读会拿到 `0.620158` 这样的中间值，「忙态淡度是 .62」那条就偶发变红。
> 现在先 `settledOpacity()` 把过渡等过去（220ms）再读，比较时留 0.01 容差。

**`themeColor.test.mjs`** 扫主题色一致性。这个 bug 的教训是：`.fab` 的光晕曾写死
`rgba(91, 91, 214, .38)`（正好是**当时**浅色默认色 `--accent: #5b5bd6` 的 rgb 形态），
换主题色 / 切深色后光晕不跟着变，肉眼才看得出来，断言完全测不到。
所以这里做的是**全量扫描**：`css/*.css` 里凡是 rgb 形态等于 `#5b5bd6` 或 `#8f8ff7` 的
`rgba()` 一律视为可疑，同时断言 `.fab` 的光晕必须走 `var(--accent-rgb)`。
需要 alpha 的地方统一用 `rgba(var(--accent-rgb), .34)` —— 项目里已有 `--bg-rgb`
这个先例，`theme.js` 里的 `toRgbTuple()` 也现成，别再写死颜色。

> 默认主题色后来从紫改成了**浅色黑 `#000000` / 深色白 `#ffffff`**。这意味着
> 「rgb 等于默认色」不再是可靠的判据（黑白在阴影里到处都有），所以上面那条扫描
> 退化成**历史紫色残留**的守卫，主力防线变成 `verify-fab-glow.mjs` 的 computed style 比对。
> 改默认色要一次改全 4 处：`theme.js` 的 `DEFAULT_ACCENT`、`base.css` 的
> 浅色与深色两块兜底（连 `--accent-strong` / `--accent-weak` / `--on-accent`
> 都要按 theme.js 的算式算出来）、设置页取默认色走 `defaultAccent()`。
> 漏改只会在「另一个主题」或「JS 还没跑起来」的一瞬间错色，肉眼基本抓不到 ——
> 所以这些断言是必需的，别嫌碎。

**`settingsApi.render.test.mjs`** 用最小 DOM 替身跑真实的 `settingsApi.render()`，
验证设置页结构：开关关闭时评论字段确实被折叠、开启时字段与「当前生效」文案正确、
占位符带出主配置值、输入框改动分别写回 `commentApi` 还是 `settings`、温度留空存空串而非 `0`。

写这个用例时踩到的坑，改造 DOM 替身时注意：

- 纯文本节点只落在 `childNodes`，不在 `children` —— 遍历要用 `childNodes`，否则所有文案都断言不到。
- `h()` 把 `value` / `placeholder` 走 `setAttribute`，所以要从 `attrs` 里读，不是元素属性。
- 替身至少要补 `append` / `classList` / `getElementById` / `matchMedia`，
  否则会在 topbar、switch 或 toast 里炸掉。

**`backup.test.mjs`** 守住备份的两条线：**只收什么** 和 **恢复动什么**。

备份范围是白名单（`CONTENT_TOP_KEYS`）：书 / 创作 / 角色 / 世界书 / 灵感 / 文件夹 /
输入预设 / 提示词 / 提示词预设 / 首页草稿，加上 `profile` 里的昵称与简介。
**不进备份的是**：头像与背景图（图片）、外观 / 主题 / 字体、API 配置（含 API 预设）、
云端备份配置、界面态。用例里那份 `dirtyState()` 把这几样全塞齐了，
然后逐条断言导出文本里搜不到（`sk-` / `ghp_` / `data:image/` / 主题色）。

恢复语义：`store.replaceContent()` 只替换备份里**真实出现过**的键
（判定用 `k in next`，因为 `adopt()` 之后所有键都有值，那时已经分不出
「备份里没有」和「备份里是空的」了），`profile` 只取昵称与简介，
其余（外观 / 头像 / settings / apiPresets / ui）一律保持本机。
所以用例里同时验了两件事：打开备份恢复后外观和 Key 不变，
以及粘贴一段只有 `roles` 的片段时**本机的书不会被清空**。

> 写成白名单而不是「排除清单」是有意的：将来 state 上新增字段时默认就是「不进备份」。
> 漏一条排除规则的代价是密钥或图片悄悄进了备份文件，漏一条白名单的代价只是新字段没被备份。

**`cloudBackup.test.mjs`** 守云端备份。`fetch` 是注入的，用例里塞个假的，
所以不用真连 GitHub 也能把这几条关键分支验到：

- **404 当「第一次备份」而不是错误**（`exists:false`，不带 sha 直接新建）。
- **更新已有文件必须带 sha**（GitHub 漏了返回 422），且只有指定了分支时才带 `branch` ——
  仓库里还没有这个文件时分支同样不存在，带了会被判 422。写文件的 URL 也不带 `?ref=`。
- **GET contents 只在 ≤1MB 时内联内容**，更大的会返回 `encoding:"none"`,
  这时要自动改用 `Accept: application/vnd.github.raw+json` 再取一次
  （用假的 fetch 断言「发了两次、第二次 Accept 是 raw、sha 仍来自第一次」）。
- **base64 必须中文安全**：`btoa()` 遇到中文直接抛 `InvalidCharacterError`，
  所以走 `TextEncoder` → 字节 → base64；反向用 `TextDecoder`。
  顺便验了带换行的 base64（GitHub 每 60 字符插一个 `\n`）和 20 万字的跨分块往返
  （`String.fromCharCode.apply` 一次喂太多字节会爆栈，所以按 0x8000 分块）。
- **云端设置不进任何备份**：配置存在独立的 `somnus_cloud_v1` 键里，
  不在 store 的 state 里，所以白名单天然拿不到它 —— 用例断言
  `'cloudBackup' in store.getState() === false` 且导出文本里搜不到令牌。

为什么纯前端能直连 GitHub：`api.github.com` 带 CORS，预检 `OPTIONS` 返回 204、
`allow-methods` 含 PUT、`allow-headers` 含 `Authorization`。所以不需要后端或代理。

**`promptPreset.test.mjs`** 守提示词预设那条线，重点是**预设不串页**：
存预设是快照（之后改当前配置不影响已存的）；载入时 `alignBlocksToKind` 会剔掉别的 kind 的数据块
（把续写的 `bookChapters` 混进创作时会被丢掉）、补齐本 kind 缺的数据块、给所有块重发 id 并去重；
存取按 kind 分桶，拿别的类别的预设 id 载不进来（返回 `null`、配置原样不动）；
重命名 / 删除也只碰所在桶。还覆盖旧存档迁移：缺 id 的补上、缺 `blocks` 的丢掉、
`kind` 写错的归到所在桶、评论桶自动建好。

**`promptEdit.render.test.mjs`** 用最小 DOM 替身跑真实的 `promptEdit.render()`，
验证右上角「更多」点开后菜单项**从上到下依次是 保存 / 载入 / 恢复**（这是这次改动的核心要求），
以及预设区只列当前这一类：创作页存的预设不出现在续写页，反之亦然。
DOM 替身比 `settingsApi` 那份多补了几个：菜单要挂 `document.body` 并读
`getBoundingClientRect()` 定位，所以替身要有 `body.children`、`contains()`、
`offsetWidth/Height` 语义和 `window.innerWidth/innerHeight`。

**`verify-prompt-sort.mjs`** 守**同一页**的「长按拖动排序」在手机上真能拖到底 —— 这条
替身用例碰不到，必须在真浏览器里用**真触摸事件**跑（CDP `Input.dispatchTouchEvent`
+ `Emulation.setTouchEmulationEnabled`，视口 390×844）。所以它和 `promptEdit.render.test.mjs`
是一对：那个管菜单结构，这个管手势。

要记住的：

- **症状与根因**：电脑上正常，手机上「长按进了拖动，手指一移就弹回原位」。根因不在排序
  逻辑 —— `begin()` 会把被拖的行 `appendChild` 到 `document.body`，它当场不再是 `.list`
  的后代，而当时拦滚动的 `touchmove` 挂在 `.list` 上 → 收不到 → 没人 `preventDefault`
  → 浏览器把这一移判成滚动接管、发 `pointercancel` → `onUp()` → 行被插回原位。
  所以监听改挂 `window`（`capture: true`、非 passive），并且 `touch-action` 是在
  pointerdown 那一刻一次性判定的，进拖动后才加 `touch-action: none` 对当前手指无效。
- **断言要落在「移动之后还在拖」**：光断「长按能进拖动」抓不到这个 bug —— 坏代码下
  那一步也是 PASS 的。
- **`pointercancel` 不能一律要求为 0**：用手指滚列表时浏览器接管手势、发 pointercancel
  是正确的，正是它让页面滚起来的。只有「拖动过程中」才断零。
- **假触摸没法造出「没过浏览器门限」的移动**：Chrome 在位移没过它自己的手势门限前
  根本不派发 `touchmove`（实测 5px / 9px 一次都没有，40px 才有）。想验「等待期抖动」
  只能记条数看一眼，别写成断言。
- **出图**：`shot-prompt-sort-drag.png`（行浮在手指下、原位留着虚线占位），肉眼确认。
- 播种 12 个块是为了**让页面滚得动** —— 场景「滑动只是滚动、不会误进拖动」需要它；
  同时顺手把 `ui.lastSeenUpdate` 写成最新一条，否则「更新说明」弹窗会盖住整页，
  触摸全落在遮罩上（实测踩过，现象是长按毫无反应）。

**`sheetBatch.test.mjs`** 守底部面板 `showSheet` 的长按批量删除（首页输入框的「载入预设」用它）。
验的是状态机而不是样式：长按进多选 → 点选加减 → 一条不剩自动退出 → 删除走确认框 →
`onDelete` 拿到的正是被选中的那批 id → 面板就地摘掉这几行（不重开）；
也验不传 `onDelete` 时结构一点没变。

这份替身和 `settingsApi` 那份有两处关键差别，改的时候别抄错：

- `getElementById('modal-root')` 必须返回**同一个**根节点。`settingsApi` 那份每次新建，
  挂上去的弹窗取不回来，这里得从根节点往下找回 `.row` / `.btn`。
- 要真派发 `pointerdown` 并**真等过 420ms**（`onLongPress` 的默认阈值）才进得了多选，
  所以用例里 `await sleep(470)`。顺带一提：`document` 替身必须补 `removeEventListener`，
  否则 `swallowClick` 里那个 400ms 的清理定时器会抛错。

**注意**：这份用例碰不到 CSS。`hidden` 属性藏按钮这件事**只有真浏览器能验** ——
见下面「用 hidden 藏不住设了 display 的元素」。

**`collectionPicker.test.mjs`** 守首页输入框那三个入口（角色 / 世界书 / 灵感）的文件夹分组，
跑的是**真实的** `views/home.js` 与 `views/library.js`。详见下面「首页挑条目也要走文件夹」一节。

**`creationBook.test.mjs`** 守「收藏到书架」的命名：**首页标题输入框里填的那个名字是书名**，
正文进第 1 章、章节名固定「第1章」。曾出过的错是拿创作标题同时当书名和第一章名 ——
打开书看到「一本书 + 一个同名的章节」，跟后续「续写」默认的「第2章」「第3章」也接不上。
分两段：先直接调 `store.addBookFromCreation` 断言写进去的书（含标题只有空白、整个对象都缺的兜底），
再用最小 DOM 替身跑**真实的** `creation.render()` —— 点星标 → 确认框点「收藏」→ 断言书架里那本书，
免得只测了 store、而视图里自己另拼一份参数却漏掉。

这份替身比 `sheetBatch` 那份多两处，少一处：

- `router.start()` 得跑起来并 `define('/home', …)` 一个桩路由。收藏成功后视图会调 `reload()`
  重渲染当前路由，`viewEl` 是 `null` 或没有匹配路由时会炸在 `replaceChildren` / 递归 `navigate` 上。
- 要挂 `globalThis.location`（router 用的是裸的 `location`，不是 `window.location`），
  并给 `window.history.length` —— 顶栏返回键会读它。
- 不用补 `closest()` 与真等 420ms：这条链路没有长按。

顶栏左右两栏都带 `.tb-btn`（左栏是返回键），找收藏/删除按钮要从 `.tb-side.tb-right` 里捞，
否则会点到返回键上去。

**`chapterRename.test.mjs`** 守章节页「点顶栏章节名改名」。章节名在界面上**没有第二个改名入口**，
这条路径断了就是彻底改不了名，所以断言必须落在「点一下真的能改」：点标题 → 表单预填当前名 →
改名 → 顶栏和库里的值都变。

**这次改动最要紧的一条**：改完只许 `drawBar()`（只重画顶栏），**不能**整页 `draw()` ——
正文区可能正处在编辑态，整页重画会把 textarea 里没保存的字冲掉。用例里专门有一段
「进入编辑态 → 写下没保存的正文 → 改名」然后断言 textarea 里的字还在、库里也没被偷偷写入。
把 `drawBar()` 换回 `draw()` 跑一遍，这条会 FAIL（实测），所以别当成可有可无的优化。

另外顶栏标题改成 `div.tb-title > span.tb-label` 的结构了（虚线得靠 inline span 才贴着文字），
`h()` 的 `text` 和样式都不受影响，但以后要断言标题文字记得取 `.tb-label`。

## 更新提示（告诉用户「这次改了什么」）

需求：给作者一个写更新内容的地方；用户进入应用时有改动就弹窗告知，**每次更新只弹一次**，附「已阅」。

| 位置 | 做什么 |
|---|---|
| `js/changelog.js` | **写更新内容的地方**，纯数据（`id` / `date` / `title` / `items`） |
| `js/services/updateNotice.js` | 未读判定 + 弹窗；`updateItem()` 被弹窗和日志页共用 |
| `js/views/settingsUpdates.js` | 设置 → 更新日志（弹窗只弹一次，历史在这里回看） |
| `js/app.js` | 启动后 `setTimeout(showUpdateNoticeIfAny, 300)` |
| `js/components/modal.js` | 新增 `closable`；配 `dismissable:false` = 只能走底部按钮 |
| `state.ui.lastSeenUpdate` | 「已阅到哪一版」，界面态 → 不进备份、不跨设备 |

四条要记住的：

1. **更新日志必须跟着代码发布，不能写进 localStorage**。写进去只有本机看得见，
   「告知用户改了什么」这件事就落不了地。加一条更新 = 在 `CHANGELOG` **最前面**插一项
   + 换个新 `id` + 双击 `push.cmd`（它自动把 `sw.js` 的 VERSION 加一）。
2. **`id` 是「看过没有」的唯一判据**：改了 id 才重新弹，只改 items 里的文字不会。
3. **`pendingUpdates()` 在「从没看过」或「看过的 id 已不在列表里」时，只能回退到最新那一条，
   绝不能回退成「全部」** —— 否则第一次打开的用户会被积攒的十几版更新糊一脸。
   用例里专门盯着这条：改成 `list` 立刻红 3 条。
4. **弹窗只留「已阅」一条出路**（`dismissable:false` + `closable:false`）。
   留个 ×、或者允许点遮罩关掉，就等于「随手点掉 → 下次又弹」，跟「只弹一次」自相矛盾。

`updateNotice.test.mjs`（45 项，纯 node）守数据体检 + 三条判定规则 + 弹窗结构 + 记档；
`verify-update-notice.mjs`（20 项，真浏览器 8791 + CDP 9341，出两张图）补的是替身碰不到的：
「一打开就自动弹」这条链路、**真写进 localStorage 再真重载之后不再弹**、
以及那颗 × 在真 DOM 里确实查不到（不是被 CSS 藏起来 —— 本项目在 `hidden` 上栽过一次）。

> 想手验弹窗：把存档里 `ui.lastSeenUpdate` 改成空串再刷新（或者直接跑 `verify-update-notice.mjs`，
> 它自己会播种、还会还原）。

## PWA 验证

这几个用例需要真实浏览器，和上面那批纯函数测试不是一套跑法。
先起服务和无头 Chrome：

```bash
# 1) 静态服务（SW 只在 http/localhost 下才会注册）
#    测子目录部署（GitHub Pages 形态）就把项目拷到 .tmptest/pages/somnus 再从上层起服务
cd ..
C:/Users/玥/.workbuddy/binaries/python/versions/3.13.12/python.exe -m http.server 8777 --bind 127.0.0.1

# 2) 无头 Chrome（agent-browser 的守护进程不稳时直接用内置浏览器）
C:/Users/玥/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe \
  --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9333 \
  --user-data-dir=../.agent-browser/tmp/pwa-verify about:blank

# 3) 跑验证
cd test
node pwaState.test.mjs        # 纯 node：installState 判定逻辑 11 项
node verify-pwa.mjs           # 浏览器：manifest / SW / 缓存内容 / 断网可用，21 项
node verify-install-gated.mjs # 浏览器：安装入口 + iOS 分支 + 子目录部署，11 项
node verify-fab-glow.mjs      # 浏览器：加号光晕跟随主题色，21 项（需服务在 8791）
node verify-sheet-batch.mjs   # 浏览器：载入预设长按批量删除，37 项，顺带出两张图（服务 8791 + CDP 9341）
node verify-compose-open.mjs  # 浏览器：加号展开后点功能图标不收起，47 项，顺带出两张图（服务 8791 + CDP 9341）
node verify-collection-picker.mjs # 浏览器：首页挑角色/世界书/灵感走文件夹分组，38 项，顺带出两张图（服务 8791 + CDP 9341）
node verify-creation-book.mjs # 浏览器：收藏到书架的命名 + 老存档迁移，15 项，顺带出一张图（服务 8791 + CDP 9341）
node verify-api-gate.mjs      # 浏览器：没配 API 时不进「创作中」而是弹设置入口，19 项，顺带出一张图（服务 8791 + CDP 9341）
node verify-inline-busy.mjs   # 浏览器：三处 AI 入口的按钮忙态 + 等待期可切页，62 项，顺带出四张图（服务 8791 + CDP 9341）
node verify-chapter-rename.mjs # 浏览器：点章节名改名 + 虚线提示，18 项，顺带出两张图（服务 8777 + CDP 9333）
node verify-cloud-backup.mjs  # 浏览器：云端备份上传/恢复 + 恢复不动外观，62 项，顺带出三张图（服务 8823 + CDP 9363）
node verify-update-notice.mjs # 浏览器：更新弹窗自动出现 + 已阅后不再弹，20 项，顺带出两张图（服务 8791 + CDP 9341）
node verify-prompt-sort.mjs   # 浏览器：提示词块长按拖动排序（真触摸事件 + 手机视口），31 项，顺带出一张图（服务 8791 + CDP 9341）
node shot-fab-glow.mjs        # 出图：浅色/自定义橙/深色三张，肉眼比对
```

`verify-chapter-rename.mjs` 和 `verify-pwa.mjs` 共用 8777 + 9333，可以一条服务一起跑。
它要真浏览器是因为这次的入口就是「标题看着能点」本身：虚线是画在 inline span 上的
`border-bottom`，DOM 替身里没有 CSS，断不了「虚线是不是真贴着文字、颜色有没有从 `--dim` 取值」，
所以那里直接读 `getComputedStyle`。

`verify-sheet-batch.mjs` / `verify-creation-book.mjs` 连的是 `8791` + CDP `9341`，
起法按上面第 1、2 步把端口换成 8791 / 9341 即可（`--user-data-dir` 用项目内的临时目录，
跑完记得连进程一起清掉）。

**`verify-compose-open.mjs`** 守首页输入框左上角加号的行为：**展开后点功能图标不收起，
只有再点那个 × 才收回**（`js/components/composeBox.js`）。以前点「角色 / 世界书」会自己
收回去，想连着挑两样就得反复展开。

覆盖的关键路径不只是「点一下还在展开」，还包括**真实用法**：挑中面板里的一行 → chip 插进
输入框 → 面板仍亮着 → 接着挑世界书也能插进去。所以要**播种角色 / 世界书 / 灵感**，
否则 `pickCollection` 的面板是空的（暂无内容），点不到行，这条链路根本没走到。
另外还验了切页往返、全屏进出都不改展开状态，以及「收起后点输入区不会自己弹开」。

写这个用例时踩到三个坑（都在脚本里就地注释了）：

- **`Runtime.evaluate` 里动态 `import()` 不认相对写法**，得先 `new URL(path, location.href).href`
  拼成绝对地址，否则报 `Failed to resolve module specifier`。
- **`svg()` 吐的自闭合 `<path/>`，从 `innerHTML` 读回来会变成 `<path></path>`**。
  拿 `svg()` 原串和 DOM 里那个比会永远不等 —— 参照串也得先塞进一个临时元素再读回来。
- **改完 `composeBox.js` 不清 SW 会一直跑旧代码**，表现是「明明改对了验证还是 FAIL」。
  所以脚本先 unregister + 清 caches 再重载，并且额外做两条守卫把两种情况分开：
  直接读磁盘源码断言功能图标区不再出现 `setOpen(false)`，再从页面 `fetch` 同一份文件
  确认浏览器拿到的确实是新的。

**`verify-creation-book.mjs` 有个必须先踩一次的坑**：往 `localStorage` 播种存档之后，
**必须 `Page.reload()`**，不能只 `Page.navigate` 到带 hash 的地址 —— 只改 hash 属于同文档导航，
页面不会重新执行模块，`load()` 也就读不到刚塞进去的存档，表现是「断言读到的是播种前那份空 state」
（书的目录空白、星标按钮找不到），很容易误判成功能坏了。

**`verify-api-gate.mjs`** 连 `8791` + CDP `9341`（和 `verify-creation-book.mjs` 同一套端口），
在真浏览器里验「没配 API 时点生成剧情不进创作中」。它比 DOM 替身那条 `apiGate.test.mjs` 多守两处：

- **loading 用 `MutationObserver` 数整段时间里出现过几次**，而不是同步读某一刻 ——
  用户看到的「闪一下的创作中」就是这么抓的，断言写成「整段时间里一次都没出现」。
- **「去设置」走真实 hash 路由**：点完断言 `location.hash === '#/settings/api'` 且弹窗已关掉。

顺带把**配好之后**那条路也跑了一遍：在设置页真的往 Key 输入框写值并派发 `change`
（走真实的 `patchSettings`），再把 `window.fetch` 换成假的（免得真打 `api.openai.com`），
回首页点生成 —— 断言这次 loading 确实出现过、正文被 trim、创作条目 +1。

> 假 fetch 要返回**真的 `Response` 对象**（`new Response(JSON.stringify(…), { status: 200 })`），
> 因为 `ai.js` 里读的是 `res.ok` / `res.json()`，返回个普通对象会当场炸。
> 另外这两个后台进程（http.server 与 Chrome）用工具的后台任务方式起，
> 不要写成 `(... &)` —— 那样会跟着当前命令一起结束，接下来就 `ECONNREFUSED`。

**`verify-cloud-backup.mjs`** 验云端备份：未连接 / 已连接两种页面形态、点入口进得去、
「立即备份」的确认框与真的 PUT 上去、以及**整份恢复之后外观到底动没动**。

GitHub 请求全由页面里一个假的 `fetch` 接住 —— `js/services/cloud.js` 里的 `realFetch`
是 `(...a) => fetch(...a)`，运行时才取全局 `fetch`，所以覆盖 `window.fetch` 就能接管。
于是不需要真令牌，也不会真往仓库里写东西。

最要紧的几条断言：上传的 PUT body 里搜不到 `sk-` / 头像 / 外观主题 / 云端令牌；
云端那份**故意做成 v1 老格式**（整份存档、带 Key 带外观带头像），恢复后断言
书和昵称按云端走、而外观主题 / 主题色 / 头像 / API / API 预设 / 界面态一个都没变，
且云端那份里的 Key 与头像**没有跟着进来**。

> 「恢复不动外观」这一条有个反直觉的地方：**故意把实现改错（让 replaceContent 顺带赋值
> `state.appearance`），`backup.test.mjs` 里 5 条断言会立刻变红** —— 写完记得这样验一次，
> 否则不知道自己有没有写了个永远成立的安慰剂。

**这个脚本踩到的新坑：`Page.navigate` 到带 hash 的地址之后紧接着 `Page.reload()` 不可靠。**
`reload` 用的是**调用那一刻**的 document URL，hash 导航还没提交时它会把旧地址再加载一遍，
表现是「导航到 `#/backup/cloud` 却停在首页」。所以脚本里的 `goto()` 给 URL 带一个每次都变的
查询串（`?v=N#/backup/cloud`）强制走完整导航 —— 既绕开了同文档导航，也绕开了这个时序问题。

`verify-fab-glow.mjs` 默认连 `8791`，跑之前把上面第 1 步的端口改成 `8791`
（`python -m http.server 8791`）。它覆盖 3 个库 × 明暗主题 × 自定义色，
断言 `getComputedStyle` 读回的 box-shadow rgb 分量与当前 `--accent-rgb` 一致 ——
这是唯一能自动抓住「样式写死颜色」的办法，光看代码容易漏。

`verify-pwa.mjs` 是主力用例，21 项断言，其中三项最要紧：
manifest 必填字段齐全、SW 进入 activated、**断网后 SPA 仍能渲染出内容**。

`pwaState.test.mjs` 是纯 node 断言（读源码文本，不起浏览器），
验的是 `installState()` 的判定顺序 —— 见下面「安装入口不能等事件」。

## 图标生成

```bash
C:/Users/玥/.workbuddy/binaries/python/versions/3.13.12/python.exe make-icons.py
```

图标全在 `icons/`，命名统一成 `icon-<尺寸>.png`（`a783.gif` 是源图，保留原名）。
脚本从 `icons/a783.gif`（370×320）导出 192 / 512 及各自的 maskable 版本。
源图刻意不用 `icons/icon-180.png` —— 只有 180px，放大到 512 会糊。
maskable 版内容只占 62%，Android 裁成圆形时才不会切掉耳朵。
**改了图标配色要同步改这里**：`BG` 常量须与 `index.html` 的
`<meta name="theme-color">` 一致。

**加新图标 / 挪位置时，这三处路径必须一起改**，漏一处就是静默 404：

| 位置 | 引用了什么 |
|---|---|
| `index.html` | 5 个 `<link rel="icon">` / `apple-touch-icon` |
| `manifest.webmanifest` | `icons[]` 5 项 + 3 个 shortcuts 各自的 `icons` |
| `sw.js` 的 `SHELL` | 7 条，用于预缓存（断网时图标也得在） |

`verify-pwa.mjs` 会按 manifest 里的相对路径逐个 fetch 图标并断言 200，
所以挪完跑一遍就能发现漏改（它读的是 `new URL(i.src, link.href)`，路径写错会挂）。

## 安装入口不能等 beforeinstallprompt

**这是本项目踩过的最贵的一个坑，且只在部署上线后才暴露。**

Chrome 派发 `beforeinstallprompt` 前，要求用户**点过一次页面** + **停留满 30 秒**
（参与度启发式）。但浏览器菜单里的「安装应用」同期就已经可用了。

所以：**若把安装入口的显示绑在 `beforeinstallprompt` 上**，新访客打开网页会看到
「我的页没有安装按钮，但浏览器菜单里却能装」的自相矛盾现象。本地之所以看不出来，
是因为反复调试时早就点过、停留够久了，条件早满足。

正确的分层是**能力探测与提示事件解耦**：`installState()` 实时判定四种状态，
入口始终显示，只是文案和点击行为不同：

| 状态 | 条件 | 副标题 | 点击行为 |
|---|---|---|---|
| `installed` | 已装成独立应用 | —— | 整块撤掉 |
| `ios` | iOS Safari | 通过 Safari 分享菜单添加 | toast 引导 |
| `native` | 浏览器已给安装能力 | 安装后可从桌面直接打开，断网也能用 | 弹原生安装框 |
| `menu` | 其余（多半参与度不足） | 在浏览器菜单里选择「安装应用」 | 弹指引弹窗 |

> **判定顺序要紧：`ios` 必须排在 `native` 前面。**
> iOS 上的 Chrome / Firefox 会派发 `beforeinstallprompt`，但系统不提供原生安装框，
> 排在后面会让这批用户看到错误文案、点了装不上。

配套要点：
- `isStandalone()` 每次调用都**实时读** `matchMedia`，不能缓存 ——
  用户装完应用切回浏览器标签页时，模块状态不重置，缓存值还是旧的。
- 状态判定是纯逻辑，用 `pwaState.test.mjs` 读源码断言顺序，比在浏览器里造状态可靠。

## 用 hidden 藏不住设了 display 的元素

批量删除的底部按钮（关闭 / 取消 / 删除）是靠 `hidden` 属性来回切的：

```js
del.hidden = !selecting;
```

**光设属性没用**。`.btn` 自己声明了 `display: inline-flex`，作者样式压过 UA 的
`[hidden] { display: none }` —— 真机上三个按钮会一起亮着，而 `sheetBatch.test.mjs`
那类 DOM 替身根本没有 CSS，断言 `btn.hidden === true` 照样通过。

所以 `components.css` 里补了一句：

```css
.modal-foot .btn[hidden] { display: none; }
```

这条对 `.sheet-tip[hidden]` 同样适用（`.sheet-tip` 只设了 padding，没设 display，
靠的是默认值，加 `[hidden]` 规则是给它上保险）。

结论：**凡是用 hidden 属性做显隐的元素，都得确认没有作者样式给它写过 display。**

## 首页挑条目也要走文件夹（与「我的」页同一套）

用户报的：首页输入框里点「角色 / 世界书 / 灵感」是**把全部条目平铺**出来的，
而「我的」页里这几项早就分好文件夹了 —— 换个入口分组就没了，等于让用户自己记名字。

修法是抽出一个**选取面板**（`js/components/collectionPicker.js`），展示逻辑与管理页
（`views/library.js`）对齐：**根目录先列文件夹、再列未分类的条目；点文件夹只列该文件夹里的；
面包屑点一下回根目录**。文件夹本来就是同一份数据（`state.folders` + 条目的 `folderId`），
换入口不该变样。首页那边只剩一句：

```js
const pick = (type) => pickCollection({ type, onPick: (it) => editor.insertChip(type, it.title) });
```

要点：

- **文件夹行 / 条目行做成公用件** `js/components/collectionList.js`（`folderRow` / `itemRow`），
  管理页与选取面板都用它。两边各写一遍的话，改类名时漏一处就是「看着还在、样式全丢」的
  静默 bug —— 类名（`.folder-row` / `.fo-name` / `.fo-count`）全在 `css/components.css` 里，
  而管理页没有渲染用例，漏改不会红。用例里专门有几条断言比对两边的行结构与计数文案。
- `folderRow` 的 `onMenu`（管理页的「重命名 / 删除」钮）和 `openable`（面板右侧的箭头）
  **互斥**：挑条目的时候不该顺手把文件夹改了名；反过来管理页已有操作钮，再加箭头就显得挤。
- 进文件夹后只列条目、**不再列文件夹**，避免在面板里套娃。
- `.folder-row .chev` 这条 CSS 是给面板补的：箭头不在 `.row` 里，拿不到 `.row .chev { color: var(--dim) }`，
  不补就会继承正文色，比旁边条目的箭头重一档。`verify-collection-picker.mjs` 用 computed style 盯着。
- **没有文件夹时，根目录就是原来的平铺列表**（未分类条目）—— 老用户看不到任何变化。
- 换了个新文件就别忘 `sw.js`：`collectionList.js` / `collectionPicker.js` 都要进 `SHELL`，
  并且 `VERSION` 加一 —— 旧壳里那份 `home.js` 点「角色」还是全量平铺。

`verify-collection-picker.mjs` 连 `8791` + CDP `9341`，38 项，出两张图
（`shot-collection-folders.png` 根目录 / `shot-collection-inside.png` 进了文件夹），
补的是替身用例碰不到的部分：文件夹行塞进底部面板后的样子、箭头色、以及
**在真浏览器里点文件夹 → 挑一条 → 芯片真的插进输入框**这条完整链路。
顺便验了管理页（`#/library/roles`）看到的是同一份分组。

> 写这个用例踩的坑：**DOM 替身缺 `dispatchEvent`**。`editor.insertChip()` 收尾会
> `box.dispatchEvent(new Event('input'))`，替身里只实现了自定义的 `dispatch()`，于是
> 「挑完插芯片」那条链路当场 `TypeError: box.dispatchEvent is not a function`。
> 顺带一提，编辑器问的 `window.getSelection()` 也得补个「没有选区」的返回值，
> 替身里才会走 `box.append(chip, space)` 那条分支。

## 踩过的坑

- **DOM 替身要补齐真 DOM 的成员，缺一个就在调用链上炸**。`collectionPicker.test.mjs` 里
  少了 `dispatchEvent`（`editor.insertChip()` 收尾会 `box.dispatchEvent(new Event('input'))`），
  表现是「挑完插芯片」那条断言直接 `TypeError` 而不是 FAIL —— 看着像用例写错了，其实是用例
  要验的功能根本没跑到。同类的还有 `getSelection` / `closest` / `history.length`，按需补。
- **hidden 属性压不过作者样式的 display**。底部按钮切「关闭 ↔ 取消/删除」只设了 `hidden`，
  真机上三个按钮一起亮着 —— `.btn { display: inline-flex }` 盖掉了 UA 的
  `[hidden] { display: none }`。DOM 替身没有 CSS，测不出来。详见上面单独一节。
- **样式里别写死主题色**。`.fab` 的光晕曾是 `rgba(91, 91, 214, .38)` ——  正好是当时浅色默认色（`#5b5bd6`）的 rgb 形态，所以**浅色下完全看不出来**，
  一换主题色或切深色就露馅。需要 alpha 的地方用
  `rgba(var(--accent-rgb), .34)`，`theme.js` 里的 `toRgbTuple()` 现成。
  `themeColor.test.mjs` 会全量扫描 `css/*.css`，把这类写死的颜色揪出来。
- **SHELL 清单要双向核对**。少写一个文件名不会报错，只会在装不上的浏览器里
  静默失效。`sw.js` 的 SHELL 数组和磁盘实际文件必须一一对应，
  加了新模块记得同步。用 `verify-pwa.mjs` 的缓存统计可以发现漏列。
- **改了代码要同时清 SW 缓存**。`sw.js` 对同源静态资源是 cache-first，
  会直接返回旧副本 —— `Network.setCacheDisabled` 只管 HTTP 缓存，**管不到 SW**。
  验证前必须 `getRegistrations().unregister()` + `caches.delete()`。
  > 反过来对部署也成立：**发新版本后用户要刷两次才拿到新代码**。这是 cache-first 的固有代价。
- **HTTP 缓存和 SW 缓存会互相"喂"旧内容**。SW 的后台更新如果走普通 `fetch(req)`，
  浏览器启发式缓存里那份旧响应会被原样写回 SW 缓存，cache-first 就永远收敛不到新版本 ——
  表现是「样式明明改对了，用户刷新多少次还是旧的」。所以后台更新用
  `fetch(req, { cache: 'no-cache' })` 强制向服务器验证；`register` 也带
  `updateViaCache: 'none'`，否则连新 `sw.js` 本身都可能读不到。
  > 再排查不出去看 `VERSION` —— 换缓存名是唯一能一次性丢掉整份旧壳的手段。
  > 顺带一提：`.fab` 光晕「底色跟着主题色、光晕却还是紫的」这个现象，
  > 就是 CSS 已经更新而 `theme.js` 还是旧版（旧版不下发 `--accent-rgb`）造成的错配。
- **CDP 模拟不了 `display-mode`**。`Emulation.setEmulatedMedia` 无论怎么写
  `features`，`matchMedia('(display-mode: standalone)')` 都恒为 false。
  所以「已安装」这个状态要靠派发 `appinstalled` 事件来验证，
  那才是浏览器在用户装完后真正发的信号。
- **无头 Chrome 跳过参与度启发式**。它无条件派发 `beforeinstallprompt`，
  造不出「拿不到事件」的真实条件（UA 覆盖也没用，事件在首次加载时就派发完了）。
  与其跟环境较劲，不如把状态判定拆出来做纯单测。
- **CDP 脚本里读 computed style 要归一化**。`boxShadow` 读回来是
  `rgba(0, 0, 0, 0.34) 0px 6px 20px 0px`（默认色改成黑之后的形态），取 rgb 要用正则截 `rgba(...)`
  再去掉 alpha 分量；比色时两边都要 `replace(/\s/g,'')`，
  否则 `rgb(0, 0, 0)` 和 `rgb(0,0,0)` 会误判为不等。
- **`start.cmd` / `push.cmd` 必须存成 GBK，注释里不能放中文**。cmd.exe 按当前代码页逐字节读批处理文件，
  `chcp 65001` + UTF-8 会让多字节中文字符把行首的 `rem`/`echo` 前缀吞掉，于是注释和长提示的
  碎片被当命令跑 —— 实测 9 处 `'xxx' is not recognized`，换 `GBK + chcp 936` 后 0 处。
  中文写在 `echo` 里是安全的，写在注释里不安全；注释保持纯 ASCII 是双保险。
  `startCmd.test.mjs` 强制这两条，改完 .cmd 记得跑一次（`--fix` 自动修）。
  > 顺带两条教训。**一是 `echo` 里的 `>` 必须写成 `^>`**：`push.cmd` 里写了句
  > `echo   sw.js 版本 -> v10，…`，那个 `>` 被 cmd 当重定向，**凭空生成了一个名叫
  > 「v10，已装机的用户下次打开才会拿到新代码。」的文件**，下一轮推送又把它当新文件提交上去。
  > 是端到端演练才炸出来的 —— 光看脚本读一百遍也看不出来。守卫现在专门查这条。
  > **二是 `grep -c $'\r'` 不能用来判断行尾**。Git Bash 的 grep 在文本模式下会把
  > CRLF 当成 LF，明明 102 处 CRLF 却报 0 处。要判就按字节数 `data.count(b"\r\n")`。
  > 这次一开始就是被它带偏，白绕了一大圈。
- **别拿 `where` 判断「工具能不能用」**。`start.cmd` 原来用 `where python` 挑解释器，
  而用户的 PATH 里没有真 Python，只有一个 Microsoft Store 的 `python.exe` ——
  **0 字节的 reparse point**，执行什么都不干直接返回 **9009**，`where` 却照样找得到它。
  fallback 挂在 `where` 上，于是那个能用的解释器永远轮不到，双击只会打印「找不到 Python」。
  现在改成**候选逐个真跑一次 `-c`，跑得通才算数**。
  > 跟上面端口那节是同一个教训：**存在 ≠ 能用**（端口 LISTENING ≠ 服务可用）。
  > 另外注意诊断时的环境差异：WorkBuddy 会话内的 PATH 里有它自带的 python，
  > 而用户双击时继承的是系统 PATH，**必须按用户那份 PATH 复现**才看得见问题。

