/**
 * 评论专用接口的配置解析测试。
 * store.js 在模块加载时就要读 localStorage，所以先塞个最小实现再动态 import。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

const store = await import('../js/store.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ('  -> ' + extra) : '')); }
};
const eq = (name, got, want) =>
  ok(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

/** 把主配置设成固定值，方便断言 */
function setupMain(over = {}) {
  store.patchSettings({
    apiBase: 'https://main.example/v1',
    apiKey: 'sk-main',
    model: 'main-model',
    temperature: 0.9,
    maxTokens: 0,
    ...over
  });
}

/** 清空评论专用配置 */
function clearComment(over = {}) {
  store.patchCommentApi({
    enabled: false, apiBase: '', apiKey: '', model: '',
    temperature: '', maxTokens: '', ...over
  });
}

console.log('\n== 默认状态 ==');
eq('默认未启用', store.getState().settings.commentApi.enabled, false);
eq('默认地址为空', store.getState().settings.commentApi.apiBase, '');

console.log('\n== 关闭时完全跟随主配置 ==');
setupMain();
clearComment();
let eff = store.resolveCommentApi();
eq('关闭时地址用主', eff.apiBase, 'https://main.example/v1');
eq('关闭时 Key 用主', eff.apiKey, 'sk-main');
eq('关闭时模型用主', eff.model, 'main-model');
eq('关闭时温度用主', eff.temperature, 0.9);
eq('关闭时 not fromCommentApi', eff.fromCommentApi, false);
eq('关闭时 differs 为 false', store.commentApiDiffers(), false);

console.log('\n== 开启但全部留空：逐项回落到主配置 ==');
clearComment({ enabled: true });
eff = store.resolveCommentApi();
eq('留空时地址回落', eff.apiBase, 'https://main.example/v1');
eq('留空时模型回落', eff.model, 'main-model');
eq('留空时 Key 回落', eff.apiKey, 'sk-main');
eq('留空时 fromCommentApi', eff.fromCommentApi, true);
eq('全留空视为无差异', store.commentApiDiffers(), false);

console.log('\n== 开启且只覆盖部分字段 ==');
clearComment({ enabled: true, model: 'comment-model' });
eff = store.resolveCommentApi();
eq('只填模型时地址仍用主', eff.apiBase, 'https://main.example/v1');
eq('只填模型时 Key 仍用主', eff.apiKey, 'sk-main');
eq('只填模型时模型被覆盖', eff.model, 'comment-model');
eq('部分覆盖算有差异', store.commentApiDiffers(), true);

console.log('\n== 完全独立的一套 ==');
setupMain();
clearComment({
  enabled: true,
  apiBase: 'https://comment.example/v1',
  apiKey: 'sk-comment',
  model: 'comment-model',
  temperature: '0.2',
  maxTokens: '2048'
});
eff = store.resolveCommentApi();
eq('独立地址', eff.apiBase, 'https://comment.example/v1');
eq('独立 Key', eff.apiKey, 'sk-comment');
eq('独立模型', eff.model, 'comment-model');
eq('独立温度为字符串原样传出', eff.temperature, '0.2');
eq('独立最大长度', eff.maxTokens, '2048');

console.log('\n== 主配置改动不影响已填的评论配置 ==');
setupMain({ model: 'main-changed', temperature: 0.5 });
eff = store.resolveCommentApi();
eq('评论模型不受主配置影响', eff.model, 'comment-model');
eq('评论温度不受主配置影响', eff.temperature, '0.2');

console.log('\n== 温度 0 是合法值，不能被当成空值回落 ==');
clearComment({ enabled: true, temperature: '0' });
eff = store.resolveCommentApi();
eq('0 温度原样保留', eff.temperature, '0');
setupMain({ temperature: 0.9 });
eq('0 温度不回落成主配置', store.resolveCommentApi().temperature, '0');

console.log('\n== 主配置被污染后不影响评论解析 ==');
store.patchSettings({ model: undefined });
clearComment({ enabled: true, model: 'safe-model' });
eq('主配置为空时评论仍有模型', store.resolveCommentApi().model, 'safe-model');

console.log('\n== 数字项按数值比较，不能被字符串形态骗过 ==');
// 主配置存 number 0.9，评论里手填 "0.9"，实际请求配置完全相同
setupMain({ temperature: 0.9, maxTokens: 0 });
clearComment({ enabled: true, temperature: '0.9', maxTokens: '0' });
eq('0.9 与 "0.9" 视为无差异', store.commentApiDiffers(), false);
clearComment({ enabled: true, temperature: '0.9', maxTokens: '2048' });
eq('改了最大长度算有差异', store.commentApiDiffers(), true);
clearComment({ enabled: true, temperature: '0', maxTokens: '' });
eq('0 与 0.9 算有差异', store.commentApiDiffers(), true);

console.log('\n== 旧存档（没有 commentApi 字段）能补全默认值 ==');
mem.clear();
mem.set('somnus_state_v1', JSON.stringify({
  settings: { apiBase: 'https://legacy.example/v1', model: 'legacy-model' }
}));
// 换一个 query 让模块重新执行，走真实的 load() 路径
const legacy = await import('../js/store.js?legacy=1');
const ls = legacy.getState().settings;
eq('旧存档地址保留', ls.apiBase, 'https://legacy.example/v1');
eq('旧存档模型保留', ls.model, 'legacy-model');
ok('旧存档补出 commentApi 对象', !!ls.commentApi && typeof ls.commentApi === 'object');
eq('补出的 enabled 为 false', ls.commentApi.enabled, false);
eq('补出的 apiBase 为空', ls.commentApi.apiBase, '');
// 补全后 resolveCommentApi 不应报错，且退回主配置
eq('旧存档解析回落主配置地址', legacy.resolveCommentApi().apiBase, 'https://legacy.example/v1');
eq('旧存档解析标记为非专用', legacy.resolveCommentApi().fromCommentApi, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
