/**
 * 云端备份的配置：令牌 / 仓库 / 分支 / 文件路径 / 上次同步状态。
 *
 * **单独存一个键，不放进 store 的 state。**
 * 这是有意为之：state 是备份的取数来源，而 services/backup.js 是白名单制
 * （只挑它认识的文字内容键），所以只要配置不在 state 里，
 * 「云端设置不进任何备份」就是结构上的事实 ——
 * 而不是靠每个导出路径都记得删一遍、日后加一处新导出就漏一处。
 * 同 promptPresets 按 kind 分桶的思路：让界面做不到，比让人记得住可靠。
 *
 * 代价是这里自带一套读写，不能跟着 store 的订阅一起刷新 ——
 * 页面用完后自己 draw() 重画即可（它只在云端备份页里用得到）。
 */

const KEY = 'somnus_cloud_v1';

const DEFAULTS = {
  token: '',
  owner: '',
  repo: '',
  branch: '',
  path: '',
  lastSyncAt: 0,
  lastSha: ''
};

export function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCloudConfig(patch) {
  const next = { ...loadCloudConfig(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('[cloud] 保存配置失败', e);
  }
  return next;
}

/** 断开连接：只清本机这份，云端文件不动 */
export function clearCloudConfig() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 忽略 */ }
  return { ...DEFAULTS };
}

/** 配置齐了才算连上 */
export function hasCloudConfig() {
  const c = loadCloudConfig();
  return !!(c.token && c.owner && c.repo);
}
