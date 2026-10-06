import './routes.js';
import { start } from './router.js';
import { mountNav } from './components/nav.js';
import { initTheme } from './theme.js';
import { initPwa } from './pwa.js';
import { mountUpdateBar } from './components/updateBar.js';
import { showUpdateNoticeIfAny } from './services/updateNotice.js';

initTheme();
mountNav();
start(document.getElementById('view'));
initPwa();
/*
 * 新版本提示条：新壳装好却卡在 waiting 时，底部挂一条「有新版本可用」。
 * 它自己订阅 pwa.js 的状态，这里是唯一的挂载点。
 */
mountUpdateBar();

/*
 * 更新提示：这次打开如果碰上了还没「已阅」的新版本，弹一次「更新说明」。
 *
 * 稍等一下再弹（不是同步调）—— 让首页先画出来，否则一打开就是一层弹窗压在
 * 还没渲染完的空白页上。判定与记档都在 services/updateNotice.js 里，
 * 每条更新对每台设备只会弹一次。
 */
setTimeout(showUpdateNoticeIfAny, 300);
