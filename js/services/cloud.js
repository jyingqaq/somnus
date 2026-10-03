/**
 * 云端备份：把本机的文字内容推到 GitHub 仓库里的一个 JSON 文件，也能读回来。
 *
 * 为什么纯前端就能干这件事：api.github.com 本身带 CORS —— 预检 OPTIONS 返回 204，
 * allow-methods 里有 PUT，allow-headers 里有 Authorization，Allow-Origin 为 *。
 * 所以不需要后端，也不需要任何代理。
 *
 * 三个必须踩准的点（下面都处理了）：
 * 1) **btoa() 遇到中文直接抛 InvalidCharacterError**。中文必须先过 TextEncoder 变成字节，
 *    再逐字节拼 base64；解码同理走 TextDecoder。对一个写小说的应用，这条必然撞上。
 * 2) **更新已有文件时 GitHub 要求带 sha**，漏了返回 422 —— 所以「先 GET 拿 sha 再 PUT」
 *    不是可选步骤。
 * 3) **GET contents 只在文件 ≤1MB 时才内联内容**（更大的会返回 content:"" + encoding:"none"，
 *    1–100MB 只能用 raw / object 媒体类型）。几十万字的小说很容易过线，
 *    所以这里在发现 encoding 不是 base64 时会自动改用 raw 媒体类型补取一次。
 *
 * 网络之外的逻辑全是纯函数（配置规整 / URL / base64 / 报错文案），可以脱离浏览器跑用例；
 * 两个真正发请求的函数把 fetch 做成可注入的，用例里塞个假的就行。
 */

export const CLOUD_API = 'https://api.github.com';
export const DEFAULT_PATH = 'somnus-backup.json';

/* ---------------- 配置 ---------------- */

/**
 * 把用户填的东西规整成一份可用的配置。
 * repo 允许直接粘 "owner/repo" 甚至仓库网址 —— 少一个输入框，少一处填错。
 */
export function normalizeConfig(input) {
  const c = input || {};
  const trim = (v) => String(v == null ? '' : v).trim();
  const split = splitRepo(trim(c.repo));
  const path = trim(c.path).replace(/^\/+/, '') || DEFAULT_PATH;
  return {
    token: trim(c.token),
    owner: trim(c.owner) || split.owner,
    repo: split.repo || trim(c.repo),
    branch: trim(c.branch),
    path,
    lastSyncAt: Number(c.lastSyncAt) || 0,
    lastSha: trim(c.lastSha)
  };
}

/** "owner/repo" / 完整网址 / 带 .git 的地址 都认 */
export function splitRepo(value) {
  const s = String(value || '')
    .replace(/^https?:\/\/[^/]*github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\s+/g, '');
  const at = s.indexOf('/');
  if (at < 0) return { owner: '', repo: s };
  return { owner: s.slice(0, at), repo: s.slice(at + 1) };
}

/** 配置能不能用。不能就返回一句人话，能用返回 null */
export function configError(input) {
  const c = normalizeConfig(input);
  if (!c.token) return '还没填访问令牌';
  if (!c.owner || !c.repo) return '还没填仓库，写成 用户名/仓库名 这样';
  if (!/^[A-Za-z0-9_.-]+$/.test(c.owner) || !/^[A-Za-z0-9_.-]+$/.test(c.repo)) {
    return '仓库名里有 GitHub 不接受的字符';
  }
  if (c.path.includes('..')) return '文件路径里不能有 ..';
  return null;
}

/* ---------------- URL ---------------- */

const enc = (s) => encodeURIComponent(s);
const encPath = (p) => String(p).split('/').map(enc).join('/');

/**
 * contents 端点地址。
 * `ref` 只在 GET 时带 —— PUT 的分支是写在请求体里的，查询串那个 ref 对它没有意义。
 */
export function contentsUrl(input, { withRef = true } = {}) {
  const c = normalizeConfig(input);
  const base = `${CLOUD_API}/repos/${enc(c.owner)}/${enc(c.repo)}/contents/${encPath(c.path)}`;
  return withRef && c.branch ? `${base}?ref=${enc(c.branch)}` : base;
}

/** 给人看的仓库地址，用来「去 GitHub 上翻历史」 */
export function fileUrl(input) {
  const c = normalizeConfig(input);
  return `https://github.com/${c.owner}/${c.repo}/blob/${enc(c.branch || 'HEAD')}/${encPath(c.path)}`;
}

/* ---------------- base64（中文安全） ---------------- */

/** 一次转多少字节。分块是因为 String.fromCharCode 参数太多会爆调用栈，几十万字的稿子真能撞上 */
const B64_CHUNK = 0x8000;

export function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text == null ? '' : text));
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
}

export function fromBase64Utf8(b64) {
  // GitHub 会在 base64 里每 60 个字符插一个换行，atob 不认
  const bin = atob(String(b64 == null ? '' : b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------------- 报错文案 ---------------- */

/** 把 HTTP 状态码 + GitHub 的 message 变成能给人看的一句话 */
export function explainHttp(status, bodyText) {
  let detail = '';
  try {
    const j = JSON.parse(String(bodyText || ''));
    if (j && typeof j.message === 'string') detail = j.message;
  } catch { /* 不是 JSON 就算了，状态码本身也有信息量 */ }
  if (detail.length > 140) detail = `${detail.slice(0, 140)}…`;
  const tail = detail ? `：${detail}` : '';

  switch (status) {
    case 401: return `访问令牌无效或已过期${tail}`;
    case 403: return `没有权限，或者触发了 GitHub 的频率限制${tail}`;
    case 404: return `找不到仓库或文件 —— 私有仓库要确认令牌里勾上了它${tail}`;
    case 409: return `和仓库上的版本对不上了，再试一次${tail}`;
    case 422: return `GitHub 拒了这次写入（sha 对不上或分支不存在）${tail}`;
    default: return `GitHub 返回了 ${status}${tail}`;
  }
}

/** fetch 自己抛的错（断网、DNS）也翻译一下 */
export function explainThrown(e) {
  const msg = (e && e.message) || String(e || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return '连不上 GitHub，检查一下网络再试';
  }
  return msg || '出了点问题';
}

async function readText(res) {
  try { return await res.text(); } catch { return ''; }
}

function baseHeaders(cfg, extra) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra
  };
}

/* ---------------- 请求 ---------------- */

const realFetch = (...args) => fetch(...args);

/**
 * 检查仓库能不能访问，顺便把「是不是私有」带回来 ——
 * 公开仓库放稿件等于公开，界面上要提一句。
 * @returns {Promise<{fullName:string, private:boolean, defaultBranch:string}>}
 */
export async function checkRepo(input, opts = {}) {
  const doFetch = opts.fetch || realFetch;
  const c = normalizeConfig(input);
  const bad = configError(c);
  if (bad) throw new Error(bad);

  const url = `${CLOUD_API}/repos/${enc(c.owner)}/${enc(c.repo)}`;
  const res = await doFetch(url, { headers: baseHeaders(c), cache: 'no-store' });
  if (!res.ok) throw new Error(explainHttp(res.status, await readText(res)));

  const json = await res.json();
  return {
    fullName: json.full_name || `${c.owner}/${c.repo}`,
    private: !!json.private,
    defaultBranch: json.default_branch || ''
  };
}

/**
 * 读回云端的备份文件。
 * 文件不存在**不是错误** —— 第一次备份就是这个状态，返回 exists:false 让调用方自己决定。
 * @returns {Promise<{exists:boolean, text:string, sha:string}>}
 */
export async function fetchRemote(input, opts = {}) {
  const doFetch = opts.fetch || realFetch;
  const c = normalizeConfig(input);
  const bad = configError(c);
  if (bad) throw new Error(bad);

  const url = contentsUrl(c);
  const res = await doFetch(url, { headers: baseHeaders(c), cache: 'no-store' });

  if (res.status === 404) return { exists: false, text: '', sha: '' };
  if (!res.ok) throw new Error(explainHttp(res.status, await readText(res)));

  const json = await res.json();
  if (Array.isArray(json)) throw new Error('这个路径指向一个目录，请把设置里的文件路径改成 xxx.json 这样');

  // ≤1MB 才有内联内容；更大的（1–100MB）拿不到 content，得用 raw 媒体类型再取一次
  let text = '';
  if (json.encoding === 'base64' && typeof json.content === 'string' && json.content) {
    text = fromBase64Utf8(json.content);
  } else {
    const raw = await doFetch(url, {
      headers: baseHeaders(c, { Accept: 'application/vnd.github.raw+json' }),
      cache: 'no-store'
    });
    if (!raw.ok) throw new Error(explainHttp(raw.status, await readText(raw)));
    text = await raw.text();
  }

  return { exists: true, text, sha: json.sha || '' };
}

/** backup: 2026-10-03 16:10 —— 仓库历史里一眼能看出是什么时候同步的 */
export function commitMessage(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  return `backup: ${d} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * 覆盖写入。sha 是「更新已有文件」的必填项；传空表示新建。
 * @returns {Promise<{sha:string}>} 写完之后仓库里那份的 sha，存下来供下次用
 */
export async function pushRemote(input, text, sha, opts = {}) {
  const doFetch = opts.fetch || realFetch;
  const c = normalizeConfig(input);
  const bad = configError(c);
  if (bad) throw new Error(bad);

  const body = {
    message: commitMessage(opts.now || new Date()),
    content: toBase64Utf8(text)
  };
  if (sha) {
    body.sha = sha;
    // 只有「更新已有文件」时才带分支：仓库里还没有这个文件时分支同样不存在，
    // 带上会被 GitHub 判 422。
    if (c.branch) body.branch = c.branch;
  } else if (c.branch) {
    body.branch = c.branch;
  }

  const res = await doFetch(contentsUrl(c, { withRef: false }), {
    method: 'PUT',
    headers: baseHeaders(c, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(explainHttp(res.status, await readText(res)));

  const json = await res.json().catch(() => null);
  return { sha: (json && json.content && json.content.sha) || '' };
}
