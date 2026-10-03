/**
 * 数据备份：打包格式、导入校验与内容统计。
 * 本地导出文件和云端备份共用这一套 —— 必须是同一个格式，
 * 否则「云端备份下来的文件」没法用「从文件导入」恢复。
 *
 * 备份范围是**白名单**：只收承载文字内容的键（见 CONTENT_TOP_KEYS）。
 * 图片（头像、背景图、字体文件）、外观 / 主题、API 配置、云端备份配置都不进备份 ——
 * 备份文件是要传来传去的，Key 不能跟着走；换设备后自行在设置里填一次即可。
 *
 * 为什么写成白名单而不是「排除清单」：将来 state 上新增字段时，默认就是「不进备份」。
 * 漏补一条排除规则的代价是密钥或图片悄悄进了备份文件，
 * 漏补一条白名单的代价只是新字段暂时没被备份 —— 两种错法，后者便宜得多。
 *
 * 除了最下面的 downloadText() / readFileText()（要碰 DOM）之外全是纯函数，
 * 可以脱离浏览器直接跑用例验证。
 */

export const BACKUP_APP = 'somnus';
/** 2：备份范围从「整份存档减掉 API」改成「只收文字内容」 */
export const BACKUP_VERSION = 2;

/** 单个备份文件的体积上限，防止手滑选中一个巨大的无关文件把标签页卡死 */
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

/**
 * 备份收哪些顶层键。
 * store.js 的 replaceContent() 也引用这份清单来决定「恢复时替换什么」——
 * 两处必须是同一个常量，否则会出现「导出漏了一个键、恢复却按旧清单覆盖」的错配。
 */
export const CONTENT_TOP_KEYS = [
  'books', 'creations', 'presets', 'roles', 'worlds', 'ideas',
  'folders', 'prompt', 'promptPresets', 'draft'
];

/** profile 里属于文字的部分；头像（图片）不在其中 */
export const PROFILE_TEXT_KEYS = ['nickname', 'bio'];

/**
 * 判定「这确实是一份本应用的存档」时看的键。
 * 仍然认 settings / appearance：v1 的老备份是整份存档，靠这几个键才认得出。
 */
const FINGERPRINT_KEYS = [...CONTENT_TOP_KEYS, 'settings', 'profile', 'appearance'];

/* ---------------- 导出 ---------------- */

/**
 * 从任意存档里挑出该备份的部分，返回新对象（不改原对象）。
 *
 * 导出和导入都过这一道：导出时保证只有内容进文件；导入时顺手把老备份里的
 * API 配置、外观、头像丢掉 —— 不用为旧格式另写一条清洗路径，
 * 「备份格式升级」这件事就只剩一个函数要改。
 */
export function pickContent(data) {
  if (!data || typeof data !== 'object') return {};
  const src = structuredClone(data);
  const out = {};
  CONTENT_TOP_KEYS.forEach((k) => { if (k in src) out[k] = src[k]; });

  const p = src.profile;
  if (p && typeof p === 'object') {
    const kept = {};
    PROFILE_TEXT_KEYS.forEach((k) => { if (k in p) kept[k] = p[k]; });
    if (Object.keys(kept).length) out.profile = kept;
  }
  return out;
}

export function buildBackup(state) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: pickContent(state)
  };
}

export function stringifyBackup(state) {
  return JSON.stringify(buildBackup(state), null, 2);
}

/** somnus-backup-20261002-1900.json */
export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}`;
  return `somnus-backup-${stamp}.json`;
}

/* ---------------- 导入 ---------------- */

/**
 * 把文本解析成存档对象。不合法就抛带人话说明的错误，调用方直接 toast 出去。
 * 兼容两种写法：带 { app, version, data } 外壳的正式备份，
 * 以及直接把 state 对象存下来的文件。
 * 返回的 data 已经过 pickContent()：只留文字内容，
 * 所以哪怕是 v1 那种「整份存档带 Key 带外观」的老备份，也不会把 Key / 外观写进来。
 * @returns {{data:object, exportedAt:number, version:number, hadApiKey:boolean}}
 */
export function parseBackup(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) throw new Error('内容为空');

  if (byteSize(raw) > MAX_BACKUP_BYTES) throw new Error('文件太大了，不像是本应用的备份');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('不是有效的 JSON 内容');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('备份内容的结构不对');
  }

  // 有外壳就剥一层，没有就当成裸存档
  const raw0 = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data))
    ? parsed.data
    : parsed;

  if (!FINGERPRINT_KEYS.some((k) => k in raw0)) {
    throw new Error('这看起来不是本应用导出的备份');
  }

  // 旧版本的备份里存过 Key，这里直接丢掉
  const hadApiKey = hasApiKey(raw0);

  return {
    data: pickContent(raw0),
    hadApiKey,
    exportedAt: Number(parsed.exportedAt) || 0,
    version: Number(parsed.version) || 0
  };
}

/* ---------------- 统计 ---------------- */

const countOf = (data, key) => (Array.isArray(data[key]) ? data[key].length : 0);

export function summarize(data) {
  const books = Array.isArray(data.books) ? data.books : [];
  let chapters = 0;
  let comments = 0;
  books.forEach((b) => {
    const list = (b && Array.isArray(b.chapters)) ? b.chapters : [];
    chapters += list.length;
    list.forEach((c) => { comments += (c && Array.isArray(c.comments)) ? c.comments.length : 0; });
  });

  return {
    books: books.length,
    chapters,
    comments,
    creations: countOf(data, 'creations'),
    roles: countOf(data, 'roles'),
    worlds: countOf(data, 'worlds'),
    ideas: countOf(data, 'ideas'),
    presets: countOf(data, 'presets')
  };
}

/** 一句话描述数据量，空的项直接不提 */
export function formatSummary(s) {
  const parts = [];
  if (s.books) parts.push(`${s.books} 本书`);
  if (s.chapters) parts.push(`${s.chapters} 章`);
  if (s.comments) parts.push(`${s.comments} 条评论`);
  if (s.creations) parts.push(`${s.creations} 次创作`);
  if (s.roles) parts.push(`${s.roles} 个角色`);
  if (s.worlds) parts.push(`${s.worlds} 个世界书`);
  if (s.ideas) parts.push(`${s.ideas} 条灵感`);
  if (s.presets) parts.push(`${s.presets} 条输入预设`);
  return parts.length ? parts.join(' · ') : '暂无内容';
}

/** UTF-8 字节数 */
export function byteSize(text) {
  return new TextEncoder().encode(String(text)).length;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 存档里有没有配置过 API Key。
 * 现在的备份不会带 Key，这个只用来识别「旧版本导出的、里面还留着 Key 的备份」，
 * 导入时提示一句让人放心。
 */
export function hasApiKey(data) {
  const s = data && data.settings;
  if (!s) return false;
  if (typeof s.apiKey === 'string' && s.apiKey.trim()) return true;
  const c = s.commentApi;
  return !!(c && typeof c.apiKey === 'string' && c.apiKey.trim());
}

/* ---------------- 落盘 ---------------- */

/** 触发一次浏览器下载 */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
