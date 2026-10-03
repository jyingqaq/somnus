/**
 * 提示词预设的测试。
 * 重点守一条线：**预设只适配它所属的那一类，不跨类**。
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k)
};

const store = await import('../js/store.js');
const { alignBlocksToKind, makePromptPreset, defaultPromptConfig, DATA_BLOCKS } =
  await import('../js/services/promptSchema.js');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); }
};
const eq = (n, got, want) =>
  ok(n, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const section = (t) => console.log('\n== ' + t + ' ==');

/* ---------------- 各类的数据块互不相同 ---------------- */

section('数据块基线');
{
  const create = DATA_BLOCKS.create.map((b) => b.type);
  const cont = DATA_BLOCKS.continue.map((b) => b.type);
  const comment = DATA_BLOCKS.comment.map((b) => b.type);
  const dup = create.filter((t) => cont.includes(t));
  ok('创作/续写 独有的块类型不重叠（bookChapters 只属续写）',
    cont.includes('bookChapters') && !create.includes('bookChapters'));
  ok('续写/评论 交叉检查', dup.length === 0, JSON.stringify(dup));
}

/* ---------------- 保存：快照而非引用 ---------------- */

section('保存为快照');
{
  const cfg = defaultPromptConfig('create');
  cfg.system = '原始系统词';
  const p = makePromptPreset('create', '日常', cfg);

  eq('预设带上了自己的 kind', p.kind, 'create');
  eq('预设记下了系统词', p.system, '原始系统词');

  // 存完之后再改当前配置，预设不该跟着变
  cfg.system = '改过的系统词';
  cfg.blocks.push({ id: 'x1', type: 'text', name: '新块', text: '内容', enabled: true });
  eq('改当前配置不影响已存预设', p.system, '原始系统词');
  eq('给当前配置加块也不进预设', p.blocks.length, 2);
}

/* ---------------- 载入：不能带进别的类别的块 ---------------- */

section('载入时剔除他类数据块');
{
  // 造一份「串了」的预设：把续写的 bookChapters 混进创作
  const dirty = [
    { id: 'a', type: 'title', name: '标题', enabled: true },
    { id: 'b', type: 'bookChapters', name: '全部章节', enabled: true },   // 续写才有
    { id: 'c', type: 'direction', name: '剧情走向', enabled: true },      // 续写才有
    { id: 'd', type: 'content', name: '输入框内容', enabled: true },
    { id: 'e', type: 'text', name: '文风', text: '语言克制', enabled: true }
  ];
  const out = alignBlocksToKind('create', dirty);
  const types = out.map((b) => b.type);

  ok('续写的 bookChapters 被剔除', !types.includes('bookChapters'), JSON.stringify(types));
  ok('续写的 direction 被剔除', !types.includes('direction'), JSON.stringify(types));
  ok('创作自己的数据块都在', types.includes('title') && types.includes('content'));
  ok('自定义文本块保留', types.includes('text') && out.find((b) => b.type === 'text').text === '语言克制');
  eq('总块数正确', out.length, 3);
}

section('载入时补齐缺失的数据块');
{
  // 只存了自定义块，两个数据块都没存
  const sparse = [{ id: 'z', type: 'text', name: '文风', text: '克制', enabled: true }];
  const out = alignBlocksToKind('continue', sparse);
  const types = out.map((b) => b.type);
  ['bookTitle', 'bookIntro', 'bookChapters', 'direction'].forEach((t) => {
    ok(`补回 ${t}`, types.includes(t), JSON.stringify(types));
  });
  eq('补齐后共 5 块', out.length, 5);
  eq('原顺序保留（自定义块在前）', out[0].type, 'text');
}

section('载入时重发 id 并去重');
{
  const dupes = [
    { id: 'same', type: 'title', name: '标题', enabled: true },
    { id: 'same2', type: 'title', name: '标题', enabled: true },  // 重复的数据块
    { id: 'same3', type: 'content', name: '输入框内容', enabled: true }
  ];
  const out = alignBlocksToKind('create', dupes);
  eq('重复的数据块只留一个', out.filter((b) => b.type === 'title').length, 1);
  const ids = out.map((b) => b.id);
  eq('id 全部重发，不沿用旧的', ids.includes('same'), false);
  eq('id 互不相同', new Set(ids).size, ids.length);
}

/* ---------------- 存取：按类分桶 ---------------- */

section('存取按 kind 分桶');
{
  store.savePromptPreset('create', '创作-短篇');
  store.savePromptPreset('create', '创作-长篇');
  store.savePromptPreset('continue', '续写-细腻');

  eq('创作桶 2 个', store.listPromptPresets('create').length, 2);
  eq('续写桶 1 个', store.listPromptPresets('continue').length, 1);
  eq('评论桶 0 个', store.listPromptPresets('comment').length, 0);
  eq('总数 3', store.countPromptPresets(), 3);

  // 在续写里保存，创作桶不该变
  const before = store.listPromptPresets('create').map((p) => p.id);
  store.savePromptPreset('continue', '续写-粗放');
  const after = store.listPromptPresets('create').map((p) => p.id);
  ok('在续写里保存不影响创作桶', JSON.stringify(before) === JSON.stringify(after));
  ok('每个预设都带自己的 kind',
    store.listPromptPresets('create').every((p) => p.kind === 'create') &&
    store.listPromptPresets('continue').every((p) => p.kind === 'continue'));
}

/* ---------------- 载入：只影响当前类 ---------------- */

section('载入只改当前类');
{
  const p = store.listPromptPresets('create')[0];
  const contBefore = structuredClone(store.promptOf('continue'));
  const commentBefore = structuredClone(store.promptOf('comment'));

  store.applyPromptPreset('create', p.id);

  ok('创作被替换', store.promptOf('create').system === p.system);
  ok('续写没被动', JSON.stringify(store.promptOf('continue')) === JSON.stringify(contBefore));
  ok('评论没被动', JSON.stringify(store.promptOf('comment')) === JSON.stringify(commentBefore));
}

section('拿别的类别的 id 载不进来');
{
  const foreign = store.listPromptPresets('continue')[0];
  const before = structuredClone(store.promptOf('create'));
  const res = store.applyPromptPreset('create', foreign.id);
  eq('返回 null（找不到）', res, null);
  ok('创作配置原样未动',
    JSON.stringify(store.promptOf('create')) === JSON.stringify(before));
}

section('删除 / 重命名也只碰当前桶');
{
  const target = store.listPromptPresets('continue')[0];
  const contBefore = store.listPromptPresets('continue').length;
  const createBefore = store.listPromptPresets('create').length;

  store.renamePromptPreset('continue', target.id, '改名了');
  eq('续写桶改名生效', store.listPromptPresets('continue')[0].name, '改名了');
  eq('创作桶数量不变', store.listPromptPresets('create').length, createBefore);

  store.removePromptPreset('continue', target.id);
  eq('续写桶少了一个', store.listPromptPresets('continue').length, contBefore - 1);
  eq('创作桶仍未受影响', store.listPromptPresets('create').length, createBefore);
}

/* ---------------- 载入后仍能正常拼装 ---------------- */

section('载入后的配置可用');
{
  const p = store.listPromptPresets('create')[0];
  store.applyPromptPreset('create', p.id);
  const cfg = store.promptOf('create');
  const types = cfg.blocks.map((b) => b.type);
  ok('创作的数据块齐全', types.includes('title') && types.includes('content'), JSON.stringify(types));
  ok('块都有 id', cfg.blocks.every((b) => !!b.id));
  ok('块都有 name', cfg.blocks.every((b) => !!b.name));
}

/* ---------------- 脏存档迁移 ---------------- */

section('旧存档迁移');
{
  mem.set('somnus_state_v1', JSON.stringify({
    promptPresets: {
      create: [
        { id: 'k1', name: '正常预设', system: 'S', blocks: [{ type: 'title', name: '标题' }] },
        { name: '缺 id 也要能补', system: 'S2', blocks: [{ type: 'content', name: '内容' }] },
        null,
        { id: 'bad', name: '缺 blocks', system: 'S3' }
      ],
      // 串到别的桶 / kind 写错的
      continue: [{ id: 'k2', kind: 'create', name: '串页的', system: 'X', blocks: [{ type: 'bookChapters', name: '章节' }] }]
    }
  }));

  const s = await import('../js/store.js?legacy=1');
  const cs = s.getState().promptPresets.create;

  eq('正常预设留下', cs.length, 2);
  ok('缺 id 的补上了', cs.every((p) => !!p.id));
  ok('残缺项（缺 blocks）被丢掉', !cs.some((p) => p.id === 'bad'));
  ok('null 项被丢掉', !cs.some((p) => p === null));

  const cont = s.getState().promptPresets.continue;
  eq('串进来的预设归到续写桶', cont.length, 1);
  eq('kind 修正为所在桶', cont[0].kind, 'continue');
  ok('块按续写对齐（bookChapters 是续写的数据块，留下了）',
    cont[0].blocks.some((b) => b.type === 'bookChapters'));
  ok('对齐后补齐了续写全部数据块', cont[0].blocks.length === 4,
    JSON.stringify(cont[0].blocks.map((b) => b.type)));

  ok('评论桶自动建好', Array.isArray(s.getState().promptPresets.comment));
}

/* ---------------- 提示词预设不算 API 配置，跟着备份走 ---------------- */

section('预设随备份保留');
{
  const { buildBackup, parseBackup } = await import('../js/services/backup.js');
  const snap = store.snapshot();
  const parsed = parseBackup(JSON.stringify(buildBackup(snap)));
  eq('备份里带上了创作预设', parsed.data.promptPresets.create.length, store.listPromptPresets('create').length);
  ok('备份里带上了续写预设', Array.isArray(parsed.data.promptPresets.continue));
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
