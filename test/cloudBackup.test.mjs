/**
 * 云端备份（GitHub）的测试。
 *
 * 覆盖 js/services/cloud.js 的配置规整 / URL 组装 / base64 编解码 / 报错文案，
 * 以及两个真正发请求的函数 —— fetch 是注入的，这里塞一个假的，
 * 所以不用真的连 GitHub 也能把「404 当第一次备份」「>1MB 改用 raw」「更新必须带 sha」
 * 这几条关键分支验到。
 *
 * 另外守住一条硬要求：**云端设置不进任何备份**。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

const store = await import('../js/store.js');
const { stringifyBackup, parseBackup } = await import('../js/services/backup.js');
const {
  CLOUD_API, DEFAULT_PATH,
  normalizeConfig, splitRepo, configError, contentsUrl, fileUrl,
  toBase64Utf8, fromBase64Utf8, explainHttp, explainThrown, commitMessage,
  checkRepo, fetchRemote, pushRemote
} = await import('../js/services/cloud.js');
const {
  loadCloudConfig, saveCloudConfig, clearCloudConfig, hasCloudConfig
} = await import('../js/services/cloudConfig.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) =>
  ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

/** 假 fetch：记下每次调用，交给 handler 决定回什么 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] || null },
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

const GOOD = {
  token: 'ghp_test_token',
  owner: 'someone',
  repo: 'novel-backup',
  branch: '',
  path: 'somnus-backup.json'
};

/* ---------------- 配置 ---------------- */

console.log('\n== 配置规整 ==');
eq('拆分 owner/repo', splitRepo('someone/novel-backup').owner, 'someone');
eq('拆分出 repo', splitRepo('someone/novel-backup').repo, 'novel-backup');
eq('认仓库网址', splitRepo('https://github.com/someone/novel-backup').owner, 'someone');
eq('认 .git 结尾', splitRepo('someone/novel-backup.git').repo, 'novel-backup');
eq('只有仓库名时 owner 为空', splitRepo('novel-backup').owner, '');

const cfg = normalizeConfig({ repo: 'someone/novel-backup', token: ' ghp_x ', path: '' });
eq('token 去空格', cfg.token, 'ghp_x');
eq('从 repo 里拆出 owner', cfg.owner, 'someone');
eq('path 留空给默认值', cfg.path, DEFAULT_PATH);
eq('路径开头的斜杠被去掉', normalizeConfig({ ...GOOD, path: '/backup/x.json' }).path, 'backup/x.json');
eq('未知字段不会带进来', 'whatever' in normalizeConfig({ ...GOOD, whatever: 1 }), false);

console.log('\n== 配置校验 ==');
ok('缺 token 报错', !!configError({ ...GOOD, token: '' }), configError({ ...GOOD, token: '' }));
ok('缺仓库报错', !!configError({ ...GOOD, repo: '' }));
ok('仓库名带斜杠报错', !!configError({ ...GOOD, repo: 'a/b/c' }));
eq('粘贴时多打的空格会被清掉', normalizeConfig({ repo: ' someone / novel-backup ' }).owner, 'someone');
ok('路径有 .. 报错', !!configError({ ...GOOD, path: '../x.json' }));
eq('填齐了就没问题', configError(GOOD), null);

console.log('\n== URL 组装 ==');
eq('默认分支不带 ref', contentsUrl(GOOD), `${CLOUD_API}/repos/someone/novel-backup/contents/somnus-backup.json`);
ok('指定分支带 ref', contentsUrl({ ...GOOD, branch: 'main' }).endsWith('?ref=main'));
ok('写文件时不带 ref', !contentsUrl({ ...GOOD, branch: 'main' }, { withRef: false }).includes('?'));
ok('子目录路径逐段编码',
  contentsUrl({ ...GOOD, path: 'bak/2026 年.json' }).includes('/contents/bak/2026%20%E5%B9%B4.json'),
  contentsUrl({ ...GOOD, path: 'bak/2026 年.json' }));
ok('仓库地址是给人看的', fileUrl({ ...GOOD, branch: 'main' }).startsWith('https://github.com/someone/novel-backup/blob/main/'));

/* ---------------- base64 ---------------- */

console.log('\n== base64 编解码（中文必须能过） ==');
const zh = '{"title":"第一人称的雨","text":"她说：「走吧。」——然后点了根烟，烟头明灭。"}';
const b64 = toBase64Utf8(zh);
ok('中文能编码（没有抛 InvalidCharacterError）', typeof b64 === 'string' && b64.length > 0);
eq('中文能原样解回来', fromBase64Utf8(b64), zh);
eq('emoji（代理对）能原样解回来', fromBase64Utf8(toBase64Utf8('雨🌧️烟🚬')), '雨🌧️烟🚬');
eq('换行与缩进保留', fromBase64Utf8(toBase64Utf8('a\n  b\tc')), 'a\n  b\tc');

// GitHub 返回的 base64 每 60 字符插一个 \n，atob 不认，得先洗掉
const wrapped = b64.replace(/(.{60})/g, '$1\n');
eq('带换行的 base64 也能解', fromBase64Utf8(wrapped), zh);

const long = '雨'.repeat(200000); // 跨过 0x8000 的分块边界，验证不会爆栈
eq('超长中文能往返', fromBase64Utf8(toBase64Utf8(long)) === long, true);

/* ---------------- 报错文案 ---------------- */

console.log('\n== 报错文案 ==');
ok('401 说令牌', explainHttp(401, '{"message":"Bad credentials"}').includes('令牌'));
ok('401 带上 GitHub 的原话', explainHttp(401, '{"message":"Bad credentials"}').includes('Bad credentials'));
ok('404 提私有仓库', explainHttp(404, '').includes('私有仓库'));
ok('409 提重试', explainHttp(409, '').includes('再试一次'));
ok('422 提 sha', explainHttp(422, '').includes('sha'));
ok('422 也带上原话', explainHttp(422, '{"message":"Invalid request"}').includes('Invalid request'));
ok('未知状态码原样报出', explainHttp(500, '').includes('500'));
ok('超长 message 会被截断', explainHttp(422, JSON.stringify({ message: 'x'.repeat(400) })).length < 220);
ok('非 JSON 体不炸', !!explainHttp(403, 'not json'));
ok('断网翻译成人话', explainThrown(new TypeError('Failed to fetch')).includes('连不上'));
eq('认不出的错误原样返回', explainThrown(new Error('boom')), 'boom');
eq('空错误也给一句话', explainThrown(null), '出了点问题');

eq('提交信息格式', commitMessage(new Date('2026-10-03T16:10:00')), 'backup: 2026-10-03 16:10');

/* ---------------- 读 ---------------- */

console.log('\n== 读：文件不存在不是错误 ==');
const f404 = fakeFetch(() => res(404, { message: 'Not Found' }));
const r404 = await fetchRemote(GOOD, { fetch: f404 });
eq('返回 exists:false', r404.exists, false);
eq('text 是空串', r404.text, '');
eq('sha 是空串', r404.sha, '');

console.log('\n== 读：正常返回内联内容 ==');
const payload = JSON.stringify({ app: 'somnus', version: 2, data: { books: [] } });
const fOk = fakeFetch(() => res(200, { encoding: 'base64', content: toBase64Utf8(payload), sha: 'sha-1' }));
const rOk = await fetchRemote(GOOD, { fetch: fOk });
eq('只发了一次请求', fOk.calls.length, 1);
eq('拿到文本', rOk.text, payload);
eq('拿到 sha', rOk.sha, 'sha-1');
eq('带上了 token', fOk.calls[0].init.headers.Authorization, 'Bearer ghp_test_token');
eq('带上了 API 版本头', fOk.calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');

console.log('\n== 读：超过 1MB 时改用 raw 媒体类型再取一次 ==');
const fBig = fakeFetch((url, init, i) => (i === 0
  ? res(200, { encoding: 'none', content: '', sha: 'sha-big', size: 3 * 1024 * 1024 })
  : res(200, payload)));
const rBig = await fetchRemote(GOOD, { fetch: fBig });
eq('发了两次请求', fBig.calls.length, 2);
eq('第二次要 raw', fBig.calls[1].init.headers.Accept, 'application/vnd.github.raw+json');
eq('文本从 raw 那一次拿到', rBig.text, payload);
eq('sha 仍然来自第一次', rBig.sha, 'sha-big');

console.log('\n== 读：路径指到目录 / 各种失败 ==');
const fDir = fakeFetch(() => res(200, [{ name: 'a.json' }]));
let dirErr = '';
try { await fetchRemote(GOOD, { fetch: fDir }); } catch (e) { dirErr = e.message; }
ok('目录路径给出人话提示', dirErr.includes('目录'), dirErr);

const f403 = fakeFetch((url, init, i) => (i === 0
  ? res(403, { message: 'rate limit' })
  : res(403, { message: 'rate limit' })));
let e403 = '';
try { await fetchRemote(GOOD, { fetch: f403 }); } catch (e) { e403 = e.message; }
ok('403 给出人话提示', e403.includes('权限') || e403.includes('频率'), e403);

console.log('\n== 读：配置不全时不发请求 ==');
const never = fakeFetch(() => { throw new Error('不该被调用'); });
let cfgErr = '';
try { await fetchRemote({ ...GOOD, token: '' }, { fetch: never }); } catch (e) { cfgErr = e.message; }
ok('缺 token 直接报错', cfgErr.includes('令牌'), cfgErr);
eq('一个请求都没发', never.calls.length, 0);

/* ---------------- 写 ---------------- */

console.log('\n== 写：新建文件（sha 为空） ==');
const body = JSON.stringify({ app: 'somnus', version: 2, data: {} });
const fNew = fakeFetch(() => res(201, { content: { sha: 'sha-new' } }));
const w1 = await pushRemote(GOOD, body, '', { fetch: fNew, now: new Date('2026-10-03T16:10:00') });
const sent1 = JSON.parse(fNew.calls[0].init.body);
eq('方法是 PUT', fNew.calls[0].init.method, 'PUT');
eq('不带 sha', 'sha' in sent1, false);
eq('不带分支', 'branch' in sent1, false);
eq('内容原样能解回来', fromBase64Utf8(sent1.content), body);
eq('提交信息是人话', sent1.message, 'backup: 2026-10-03 16:10');
eq('URL 不带 ref', fNew.calls[0].url.includes('?'), false);
eq('返回新 sha', w1.sha, 'sha-new');

console.log('\n== 写：更新已有文件（必须带 sha） ==');
const fUpd = fakeFetch(() => res(200, { content: { sha: 'sha-2' } }));
await pushRemote(GOOD, body, 'sha-1', { fetch: fUpd });
const sent2 = JSON.parse(fUpd.calls[0].init.body);
eq('带上了 sha', sent2.sha, 'sha-1');
eq('没填分支就不带分支', 'branch' in sent2, false);

console.log('\n== 写：指定了分支时，更新才带 branch ==');
const fBr = fakeFetch(() => res(200, { content: { sha: 'sha-3' } }));
await pushRemote({ ...GOOD, branch: 'main' }, body, 'sha-1', { fetch: fBr });
eq('更新时带 branch', JSON.parse(fBr.calls[0].init.body).branch, 'main');

console.log('\n== 写：失败时报人话 ==');
const f422 = fakeFetch(() => res(422, { message: 'Invalid request' }));
let e422 = '';
try { await pushRemote(GOOD, body, 'stale-sha', { fetch: f422 }); } catch (e) { e422 = e.message; }
ok('422 给出人话提示', e422.includes('sha') || e422.includes('GitHub'), e422);

console.log('\n== 检查仓库 ==');
const fRepo = fakeFetch(() => res(200, { full_name: 'someone/novel-backup', private: true, default_branch: 'main' }));
const info = await checkRepo(GOOD, { fetch: fRepo });
eq('拿到仓库全名', info.fullName, 'someone/novel-backup');
eq('知道是私有仓库', info.private, true);
eq('拿到默认分支', info.defaultBranch, 'main');

/* ---------------- 云端配置不进备份 ---------------- */

console.log('\n== 云端配置不进任何备份 ==');
const empty = loadCloudConfig();
eq('没配过时 token 为空', empty.token, '');
eq('没配过时 path 为空（交给 normalizeConfig 补默认）', empty.path, '');
eq('没配过 hasCloudConfig 为 false', hasCloudConfig(), false);

saveCloudConfig({ token: 'ghp_cloud_secret', owner: 'someone', repo: 'novel-backup', path: DEFAULT_PATH });
eq('存得进', loadCloudConfig().token, 'ghp_cloud_secret');
eq('存齐了 hasCloudConfig 为 true', hasCloudConfig(), true);

eq('state 里没有云端配置这个键', 'cloudBackup' in store.getState(), false);
const dump = stringifyBackup(store.snapshot());
ok('导出文本里搜不到云端令牌', !dump.includes('ghp_cloud_secret'));
ok('导出文本里搜不到仓库名之外的云端信息', !dump.includes('ghp_'));

const roundTrip = parseBackup(dump);
ok('重新解析也带不出云端配置', !JSON.stringify(roundTrip.data).includes('ghp_'));

console.log('\n== 断开连接 ==');
saveCloudConfig({ lastSha: 'sha-x', lastSyncAt: 123 });
eq('同步状态能存下来', loadCloudConfig().lastSha, 'sha-x');
clearCloudConfig();
eq('断开后 token 没了', loadCloudConfig().token, '');
eq('断开后同步状态也没了', loadCloudConfig().lastSha, '');
eq('断开后 hasCloudConfig 为 false', hasCloudConfig(), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
