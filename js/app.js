import './routes.js';
import { start } from './router.js';
import { mountNav } from './components/nav.js';
import { initTheme } from './theme.js';
import { initPwa } from './pwa.js';

initTheme();
mountNav();
start(document.getElementById('view'));
initPwa();
