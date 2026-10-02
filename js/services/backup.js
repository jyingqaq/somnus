/**
 * 数据备份：整份存档的打包格式、导入校验与内容统计。
 *
 * 除了最下面的 downloadText()（要碰 DOM）之外全是纯函数，
 * 可以脱离浏览器直接跑用例验证。
 */

export const BACKUP_APP = 'ai-writer';
export const BACKUP_VERSION = 1;

/** 单个备份文件的体积上限，防止手滑选中一个巨大的无关文件把标签页卡死 */
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

/** 判定「这确实是一份本应用的存档」时看的键 */
const FINGERPRINT_KEYS = [
  'books', 'creations', 'presets', 'roles', 'worlds', 'ideas',
  'prompt', 'settings', 'profile', 'appearance', 'folders'
];

/* ---------------- 导出 ---------------- */

export function buildBackup(state) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: state
  };
}

export function stringifyBackup(state) {
  return JSON.stringify(buildBackup(state), null, 2);
}

/** ai-writer-backup-20261002-1900.json */
export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}`;
  return `ai-writer-backup-${stamp}.json`;
}

/* ---------------- 导入 ---------------- */

/**
 * 把文本解析成存档对象。不合法就抛带人话说明的错误，调用方直接 toast 出去。
 * 兼容两种写法：带 { app, version, data } 外壳的正式备份，
 * 以及直接把 state 对象存下来的文件。
 * @returns {{data:object, exportedAt:number, version:number}}
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
  const data = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data))
    ? parsed.data
    : parsed;

  if (!FINGERPRINT_KEYS.some((k) => k in data)) {
    throw new Error('这看起来不是本应用导出的备份');
  }

  return {
    data,
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
    presets: countOf(data, 'presets'),
    apiPresets: countOf(data, 'apiPresets')
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
  if (s.apiPresets) parts.push(`${s.apiPresets} 套 API 配置`);
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

/** 存档里有没有配置过 API Key —— 备份里带着明文 Key，导出前值得提醒一句 */
export function hasApiKey(data) {
  const s = data && data.settings;
  return !!(s && typeof s.apiKey === 'string' && s.apiKey.trim());
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
