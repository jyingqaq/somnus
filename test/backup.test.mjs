/**
 * 备份范围与恢复语义的测试。
 *
 * 覆盖 js/services/backup.js 的打包 / 解析 / 白名单，以及 store.replaceContent
 * 在恢复时不动外观、头像、API 与云端设置的行为。
 *
 * 这个文件守住的是两条线：
 * 1) 备份只收文字内容 —— 图片（头像 / 背景图）、外观 / 主题、API 配置、
 *    云端备份配置都不许出现在导出文本里。
 * 2) 恢复只换文字内容 —— 上面那几类本机配置一份都不许被改。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

const store = await import('../js/store.js');
const {
  buildBackup, stringifyBackup, parseBackup, pickContent, hasApiKey,
  summarize, formatSummary, backupFileName, CONTENT_TOP_KEYS
} = await import('../js/services/backup.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) =>
  ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

/** 直接拿 store 里的默认提示词，省得手拼块结构（拼漏一块会被 migrate 判成损坏、整份换默认） */
const defaultPrompt = structuredClone(store.getState().prompt);

/** 一份「该有的有、不该有的也有」的存档，用来验证白名单真的在拦 */
function dirtyState() {
  return {
    settings: {
      apiBase: 'https://api.example/v1',
      apiKey: 'sk-secret',
      model: 'gpt-x',
      temperature: 0.7,
      maxTokens: 4096,
      commentApi: { enabled: true, apiBase: 'https://c.example/v1', apiKey: 'sk-comment', model: 'c-model' }
    },
    apiPresets: [{ id: 'p1', name: '我的 Key', apiKey: 'sk-preset' }],
    activeApiPreset: 'p1',
    // 云端配置按设计不在 state 里，这里故意塞一份：白名单也得把它挡住
    cloudBackup: { token: 'ghp-cloud-secret', owner: 'someone', repo: 'novel' },

    appearance: {
      theme: 'dark',
      accent: '#ff0000',
      backgrounds: { home: { src: 'data:image/png;base64,BBB', opacity: 0.4 } }
    },
    profile: { nickname: '阿玥', bio: '写小说的', avatar: 'data:image/jpeg;base64,ZZZZ' },
    ui: { composeOpen: true },
    draft: { title: '草稿标题', html: '<p>草稿正文</p>' },

    books: [{ id: 'b1', title: '测试书', chapters: [{ id: 'c1', title: '第一章', content: '正文' }] }],
    creations: [{ id: 'x1', title: '一次创作' }],
    roles: [{ id: 'r1', title: '主角' }],
    worlds: [],
    ideas: [],
    folders: { roles: [{ id: 'f1', name: '人物' }], worlds: [], ideas: [] },
    presets: [{ id: 's1', title: '输入预设' }],
    prompt: {
      ...structuredClone(defaultPrompt),
      create: { ...structuredClone(defaultPrompt.create), system: '备份里的提示词' }
    },
    promptPresets: { create: [{ id: 'pp1', name: '预设' }], continue: [], comment: [] }
  };
}

console.log('\n== 导出：图片 / 外观 / API / 云端配置都不进备份 ==');
const dirty = dirtyState();
const backup = buildBackup(dirty);

['settings', 'appearance', 'apiPresets', 'activeApiPreset', 'cloudBackup', 'ui'].forEach((k) => {
  eq(`顶层没有 ${k}`, k in backup.data, false);
});
eq('profile 里没有 avatar', 'avatar' in backup.data.profile, false);

const text = stringifyBackup(dirty);
ok('搜不到主 Key', !text.includes('sk-secret'));
ok('搜不到评论 Key', !text.includes('sk-comment'));
ok('搜不到预设 Key', !text.includes('sk-preset'));
ok('搜不到 API 地址', !text.includes('api.example'));
ok('搜不到云端令牌', !text.includes('ghp-cloud-secret'));
ok('搜不到头像图片', !text.includes('ZZZZ'));
ok('搜不到背景图', !text.includes('data:image/png'));
ok('搜不到主题色', !text.includes('#ff0000'));

console.log('\n== 导出：该留的文字一个不少 ==');
eq('白名单里的键都在', CONTENT_TOP_KEYS.every((k) => k in backup.data), true);
eq('书还在', backup.data.books.length, 1);
eq('书名还在', backup.data.books[0].title, '测试书');
eq('章节还在', backup.data.books[0].chapters.length, 1);
eq('章节正文还在', backup.data.books[0].chapters[0].content, '正文');
eq('创作还在', backup.data.creations.length, 1);
eq('角色还在', backup.data.roles.length, 1);
eq('角色文件夹还在', backup.data.folders.roles.length, 1);
eq('输入预设还在', backup.data.presets.length, 1);
eq('提示词还在', backup.data.prompt.create.system, '备份里的提示词');
eq('提示词预设还在', backup.data.promptPresets.create.length, 1);
eq('首页草稿还在', backup.data.draft.title, '草稿标题');
eq('昵称还在', backup.data.profile.nickname, '阿玥');
eq('简介还在', backup.data.profile.bio, '写小说的');

console.log('\n== pickContent 不改原对象 ==');
const src = dirtyState();
const before = JSON.stringify(src);
pickContent(src);
eq('原对象未被修改', JSON.stringify(src), before);
eq('乱输入返回空对象', JSON.stringify(pickContent(null)), '{}');

console.log('\n== 导入：新备份解析后依然只有文字 ==');
const parsedNew = parseBackup(stringifyBackup(dirty));
eq('解析出的 data 没有 settings', 'settings' in parsedNew.data, false);
eq('解析出的 data 没有 appearance', 'appearance' in parsedNew.data, false);
eq('解析出的 data 没有 cloudBackup', 'cloudBackup' in parsedNew.data, false);
eq('没有标记为旧备份', parsedNew.hadApiKey, false);
eq('书被解析出来', parsedNew.data.books.length, 1);
eq('版本号是 2', parsedNew.version, 2);

console.log('\n== 导入：老备份（整份存档，带 Key 带外观带头像）会被削成文字内容 ==');
const legacyText = JSON.stringify({
  app: 'somnus',
  version: 1,
  exportedAt: Date.now(),
  data: dirtyState()
});
const parsedLegacy = parseBackup(legacyText);
eq('标记出里面有 Key', parsedLegacy.hadApiKey, true);
eq('旧备份的 settings 被丢掉', 'settings' in parsedLegacy.data, false);
eq('旧备份的 appearance 被丢掉', 'appearance' in parsedLegacy.data, false);
eq('旧备份的头像被丢掉', 'avatar' in parsedLegacy.data.profile, false);
eq('旧备份的云端配置被丢掉', 'cloudBackup' in parsedLegacy.data, false);
ok('削完之后搜不到任何 Key', !JSON.stringify(parsedLegacy.data).includes('sk-'));
ok('削完之后搜不到头像图片', !JSON.stringify(parsedLegacy.data).includes('ZZZZ'));
eq('旧备份的正文仍在', parsedLegacy.data.books.length, 1);

console.log('\n== 导入：非法输入仍然报错 ==');
const throws = (name, input) => {
  try { parseBackup(input); ok(name, false, '没有抛错'); }
  catch (e) { ok(name, !!e.message); }
};
throws('空内容报错', '');
throws('非 JSON 报错', 'hello world');
throws('无关 JSON 报错', '{"foo":1}');
throws('数组报错', '[1,2,3]');

/* ---------------- 恢复语义 ---------------- */

console.log('\n== 整份恢复：内容按备份走，其余一律不动 ==');
store.patchAppearance({ theme: 'light', accent: '#123456' });
store.patchSettings({ apiBase: 'https://local.example/v1', apiKey: 'sk-local', model: 'local-model' });
store.saveApiPreset('本机预设');
const localPresetId = store.getState().activeApiPreset;
store.patchProfile({ nickname: '本机昵称', avatar: 'data:image/local' });
store.patchUi({ composeOpen: true });

store.replaceContent(parsedNew.data);
const after = store.getState();
eq('书确实恢复了', after.books.length, 1);
eq('书名是备份里的', after.books[0].title, '测试书');
eq('提示词按备份走', after.prompt.create.system, '备份里的提示词');
eq('昵称按备份走', after.profile.nickname, '阿玥');
eq('外观主题没被动', after.appearance.theme, 'light');
eq('外观主题色没被动', after.appearance.accent, '#123456');
eq('头像没被动（图片不进备份）', after.profile.avatar, 'data:image/local');
eq('Key 没被冲掉', after.settings.apiKey, 'sk-local');
eq('地址没被冲掉', after.settings.apiBase, 'https://local.example/v1');
eq('模型没被冲掉', after.settings.model, 'local-model');
eq('API 预设没被冲掉', after.apiPresets.length, 1);
eq('当前预设 id 保持', after.activeApiPreset, localPresetId);
eq('界面态没被动', after.ui.composeOpen, true);

console.log('\n== 整份恢复：备份里没出现的键不会被清空 ==');
const booksBefore = store.list('books').length;
store.replaceContent({ roles: [{ id: 'r9', title: '只给角色' }] });
eq('角色按备份替换（不是追加）', store.list('roles').length, 1);
eq('角色的确是那份', store.list('roles')[0].title, '只给角色');
eq('没提到的书原样保留', store.list('books').length, booksBefore);

console.log('\n== 整份恢复：备份里残留的 API / 外观 / 头像字段也进不来 ==');
store.replaceContent({
  books: [],
  settings: { apiKey: 'sk-evil', apiBase: 'https://evil.example/v1', model: 'evil' },
  apiPresets: [{ id: 'evil', name: '坏的', apiKey: 'sk-evil-preset' }],
  appearance: { theme: 'dark', accent: '#000000' },
  profile: { avatar: 'data:image/evil', nickname: '新昵称' },
  ui: { composeOpen: false }
});
const evil = store.getState();
eq('残留 apiKey 被忽略', evil.settings.apiKey, 'sk-local');
eq('残留 apiBase 被忽略', evil.settings.apiBase, 'https://local.example/v1');
eq('残留 model 被忽略', evil.settings.model, 'local-model');
eq('残留 apiPresets 被忽略', evil.apiPresets.length, 1);
eq('残留主题被忽略', evil.appearance.theme, 'light');
eq('残留主题色被忽略', evil.appearance.accent, '#123456');
eq('残留头像被忽略', evil.profile.avatar, 'data:image/local');
eq('界面态不受影响', evil.ui.composeOpen, true);
eq('昵称按备份走（文字）', evil.profile.nickname, '新昵称');
eq('书被清空了（备份里就是空）', evil.books.length, 0);

console.log('\n== 合并恢复：只进内容，不碰设置与外观 ==');
store.replaceContent({ books: [], creations: [], roles: [], worlds: [], ideas: [], presets: [] });
store.patchSettings({ apiKey: 'sk-keep', model: 'keep-model' });
const added = store.mergeContent(parsedNew.data);
ok('合并有新增内容', added > 0, 'added=' + added);
eq('合并后 Key 不变', store.getState().settings.apiKey, 'sk-keep');
eq('合并后模型不变', store.getState().settings.model, 'keep-model');
eq('合并后主题不变', store.getState().appearance.theme, 'light');
eq('合并后头像不变', store.getState().profile.avatar, 'data:image/local');
ok('书被合并进来', store.list('books').length >= 1);

console.log('\n== 统计不涉及配置类数据 ==');
const s = summarize(dirtyState());
eq('统计里没有 apiPresets 字段', 'apiPresets' in s, false);
eq('统计里没有 appearance 字段', 'appearance' in s, false);
ok('摘要文案不提 API', !formatSummary(s).includes('API'), formatSummary(s));
ok('摘要里有书', formatSummary(s).includes('1 本书'), formatSummary(s));

console.log('\n== hasApiKey 只用于识别旧备份 ==');
eq('主配置有 Key 时为 true', hasApiKey(dirtyState()), true);
eq('只有评论 Key 时也为 true', hasApiKey({ settings: { commentApi: { apiKey: 'sk-c' } } }), true);
eq('没有 Key 时为 false', hasApiKey({ settings: { apiKey: '' } }), false);
eq('空存档为 false', hasApiKey({}), false);

console.log('\n== 文件名 ==');
ok('文件名带前缀', backupFileName(new Date('2026-10-02T19:00:00')).startsWith('somnus-backup-'));
eq('文件名格式', backupFileName(new Date('2026-10-02T19:00:00')), 'somnus-backup-20261002-1900.json');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
