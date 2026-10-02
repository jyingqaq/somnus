/** 路由表：新增页面只需在这里加一行 */

import { define } from './router.js';

import * as home from './views/home.js';
import * as creation from './views/creation.js';
import * as shelf from './views/shelf.js';
import * as book from './views/book.js';
import * as chapter from './views/chapter.js';
import * as library from './views/library.js';
import * as profile from './views/profile.js';
import * as settings from './views/settings.js';
import * as settingsApi from './views/settingsApi.js';
import * as settingsTheme from './views/settingsTheme.js';
import * as prompt from './views/prompt.js';
import * as promptEdit from './views/promptEdit.js';
import * as backup from './views/backup.js';

define('/home', home);
define('/creation/:id', creation);
define('/shelf', shelf);
define('/book/:id', book);
define('/book/:id/chapter/:cid', chapter);
define('/library/:type', library);
define('/me', profile);
define('/settings', settings);
define('/settings/api', settingsApi);
define('/settings/theme', settingsTheme);
define('/prompt', prompt);
define('/prompt/:kind', promptEdit);
define('/backup', backup);
