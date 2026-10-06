import './routes.js';
import { start } from './router.js';
import { mountNav } from './components/nav.js';
import { initTheme } from './theme.js';
import { initPwa } from './pwa.js';

/*
 * 启动时**不做任何和更新有关的 UI**。
 *
 * 以前这里挂过两样东西：底部的「有新版本可用」提示条，和 300ms 后自动弹的
 * 「更新说明」弹窗。它们不可控 —— 挡内容、抢 #modal-root、正在写的时候冒出来，
 * 于是全撤了。现在更新只有一个入口：设置 → 获取更新（views/settingsUpdates.js），
 * 用户点一下才查、才切壳。
 */
initTheme();
mountNav();
start(document.getElementById('view'));
initPwa();
