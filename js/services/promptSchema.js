/**
 * 提示词的「骨架」定义：默认系统词、数据块清单、默认块顺序。
 * 单独成文件是为了让 store.js 与 prompt.js 都能引用而不产生循环依赖。
 */

export const DEFAULT_SYSTEM_CREATE =
  '你是一名中文小说写作助手。根据用户给出的创作要求直接输出正文，不要输出任何解释、前言、思考过程、标题或 Markdown 标记，只输出小说正文。';

export const DEFAULT_SYSTEM_CONTINUE =
  '你是一名中文小说写作助手，正在为用户续写已有小说。紧接已有内容自然续写下一章，不要复述前文，不要输出解释、标题或 Markdown 标记，只输出正文。';

/**
 * 评论区系统词（v2）。
 * 格式要求写得非常死并给出样例，是因为这段输出要交给程序解析，
 * 样例能极大压低模型自由发挥（加序号、加引号、加解释）的概率。
 * 竖线分隔是刻意选的：网名和内容里几乎不会出现 |，一次 indexOf 就能切开。
 *
 * 回复一律用「@网名 正文」写进评论内容里，不额外增加字段：
 * 这样格式面不变（还是两段），解析失败时最多是少了个回复对象，不会整条丢掉。
 */
export const DEFAULT_SYSTEM_COMMENT = [
  '你是一个中文小说网站的普通读者，正在章节评论区留言。',
  '阅读用户给出的章节，写出若干条真实、自然、有共鸣的读者评论。',
  '',
  '输出格式必须是下面这样，一条评论一行：',
  '网名|评论内容',
  '',
  '例如：',
  '阿柚|这一章的雨写得太有画面感了，读着像能闻到潮气。',
  '林间|我总觉得那个船长身上还有事没交代，等着看后面怎么圆。',
  '夜航船|@林间 我也是，钟声之后他一句话都没说。',
  '林间|@夜航船 说不定下一章就圆上了。',
  '',
  '规则（必须严格遵守）：',
  '1. 一行一条评论，网名与评论内容之间只用一个半角竖线 | 分隔，全篇不要再出现第二个 |',
  '2. 网名 2~5 个汉字，要像真实网名，不要用「读者1」「用户A」这类编号；同一个人的多次发言必须用同一个网名',
  '3. 评论内容 15~45 字，口语化，可以谈感受、猜剧情、吐槽或追问，不要复述原文',
  '4. 评论区要有来有往：至少要写 2 条读者之间的互相回复，先有人抛出说法，再由别人 @ 他接话、附和或反驳',
  '5. 回复别人时，评论内容必须写成「@对方的网名 正文」，@ 后面紧跟网名，再接一个空格；',
  '   @ 的必须是上文出现过的网名，不要 @ 不存在的人，也不要每条都去 @ 别人',
  '6. 如果【已有评论】里有人被 @ 了，被 @ 的那个人要写一条回复它的话，同样以 @对方的网名 开头',
  '7. 只输出评论行本身，不要序号、引号、标题、空行、代码块，也不要任何解释或总结'
].join('\n');

export const DEFAULT_COMMENT_HINT =
  '再生成 5 条新的读者评论，其中至少 2 条是读者之间的互相回复；如果有人被 @ 了，让被 @ 的那个人回复他。不要与已有评论重复。';

/** v1 的默认值，只在升级时用来判断用户有没有改过（改过就不动） */
const V1_SYSTEM_COMMENT = [
  '你是一个中文小说网站的普通读者，正在章节评论区留言。',
  '阅读用户给出的章节，写出若干条真实、自然、有共鸣的读者评论。',
  '',
  '输出格式必须是下面这样，一条评论一行：',
  '网名|评论内容',
  '',
  '例如：',
  '阿柚|这一章的雨写得太有画面感了，读着像能闻到潮气。',
  '林间|我总觉得那个船长身上还有事没交代，等着看后面怎么圆。',
  '夜航船|钟声那段起鸡皮疙瘩了，节奏压得很稳。',
  '',
  '规则（必须严格遵守）：',
  '1. 一行一条评论，网名与评论内容之间只用一个半角竖线 | 分隔，全篇不要再出现第二个 |',
  '2. 网名 2~5 个汉字，各不相同，要像真实网名，不要用「读者1」「用户A」这类编号',
  '3. 评论内容 15~45 字，口语化，可以谈感受、猜剧情、吐槽或追问，不要复述原文',
  '4. 只输出评论行本身，不要序号、引号、标题、空行、代码块，也不要任何解释或总结'
].join('\n');

const V1_COMMENT_HINT = '再生成 5 条新的读者评论，不要与已有评论重复。';

export const KINDS = {
  create: { label: '创作', desc: '首页生成剧情' },
  continue: { label: '续写', desc: '书籍详细页续写章节' },
  comment: { label: '评论', desc: '章节详情页生成评论' }
};

/**
 * 数据块：内容由程序注入（输入框、书籍、章节等），不可删除，可排序、可停用
 * type 同时是 renderBlock() 里的取值分支
 */
export const DATA_BLOCKS = {
  create: [
    { type: 'title', name: '标题', hint: '标题输入框的内容' },
    { type: 'content', name: '输入框内容', hint: '详细要求输入框的正文' }
  ],
  continue: [
    { type: 'bookTitle', name: '书名', hint: '当前书籍的书名' },
    { type: 'bookIntro', name: '书籍简介', hint: '当前书籍的简介' },
    { type: 'bookChapters', name: '全部章节', hint: '当前书籍的全部章节正文' },
    { type: 'direction', name: '剧情走向', hint: '续写弹窗里填写的剧情走向' }
  ],
  comment: [
    { type: 'bookTitle', name: '书名', hint: '当前书籍的书名' },
    { type: 'chapterContent', name: '章节内容', hint: '当前章节的标题与正文' },
    { type: 'existingComments', name: '已有评论', hint: '评论区里已有的评论，用来避免重复' }
  ]
};

/**
 * 每次请求都会变的块。
 * 新增块默认插到它前面，保证「稳定前缀」这一区段不被破坏。
 */
export const VOLATILE_BLOCK = {
  create: 'content',
  continue: 'direction',
  comment: 'existingComments'
};

export function isDataBlock(type) {
  return Object.keys(DATA_BLOCKS).some((k) => DATA_BLOCKS[k].some((b) => b.type === type));
}

/** 默认块顺序：稳定内容在前、变动内容在后，最大化前缀缓存命中 */
const DEFAULT_ORDER = {
  create: ['title', 'content'],
  continue: ['bookTitle', 'bookIntro', 'bookChapters', 'direction'],
  comment: ['bookTitle', 'chapterContent', 'existingComments']
};

/** 默认系统词 */
const DEFAULT_SYSTEM = {
  create: DEFAULT_SYSTEM_CREATE,
  continue: DEFAULT_SYSTEM_CONTINUE,
  comment: DEFAULT_SYSTEM_COMMENT
};

/** 除数据块外，额外预置的自定义块（放在末尾，当收尾指令用） */
const DEFAULT_TEXT_BLOCKS = {
  comment: [{ name: '生成要求', text: DEFAULT_COMMENT_HINT }]
};

let seq = 0;
export const blockId = () => `pb${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 生成一份默认配置（每次调用都是全新对象） */
export function defaultPromptConfig(kind) {
  const blocks = (DEFAULT_ORDER[kind] || []).map((type) => {
    const meta = DATA_BLOCKS[kind].find((b) => b.type === type);
    return { id: blockId(), type, name: meta.name, enabled: true };
  });

  (DEFAULT_TEXT_BLOCKS[kind] || []).forEach((b) => {
    blocks.push({ id: blockId(), type: 'text', name: b.name, text: b.text, enabled: true });
  });

  return { system: DEFAULT_SYSTEM[kind] || '', blocks };
}

/**
 * 把旧版本的默认值就地升级到新版。
 * 只在内容与旧版默认值**逐字相同**时才替换，用户自己改过的原样保留。
 *
 * 这里刻意不用 version 字段做门禁：`load()` 会把默认值 deepMerge 进存档，
 * 新加的 version 键会直接从默认值继承下来，导致升级永远被跳过。
 * 逐字比对是自限的——升过一次之后内容就不再等于旧版默认值了。
 */
export function upgradePromptConfig(kind, cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;

  if (kind === 'comment') {
    if (cfg.system === V1_SYSTEM_COMMENT) cfg.system = DEFAULT_SYSTEM_COMMENT;
    cfg.blocks = (cfg.blocks || []).map((b) => (
      b && b.type === 'text' && b.name === '生成要求' && b.text === V1_COMMENT_HINT
        ? { ...b, text: DEFAULT_COMMENT_HINT }
        : b
    ));
  }

  return cfg;
}

/* ---------------- 预设 ---------------- */

/**
 * 预设是某一类提示词的完整快照，**只属于它被保存时的那一类**。
 * 存放时按 kind 分桶（见 store.DEFAULTS.promptPresets），
 * 载入时再走一遍 alignBlocksToKind 做兜底对齐，两道一起保证「预设不串」。
 *
 * @param {string} kind
 * @param {string} name
 * @returns {{id:string,name:string,kind:string,system:string,blocks:Array,createdAt:number}}
 */
export function makePromptPreset(kind, name, cfg) {
  return {
    id: blockId(),
    name,
    kind,
    system: cfg.system || '',
    // 存快照而不是引用：外部后续改动当前配置，不该顺着改到已保存的预设
    blocks: structuredClone(cfg.blocks || []),
    createdAt: Date.now()
  };
}

/**
 * 把一份块列表对齐到指定 kind：
 * - 丢掉不属于该 kind 的数据块（例如把「续写」的预设错当成「创作」载入时）
 * - 补齐该 kind 应该有、但预设里没有的数据块（顺序按默认顺序追加）
 * - id 全部重新生成，避免和当前配置里的块撞 id
 *
 * 自定义文本块原样保留（它们本来就与 kind 无关），只重发 id。
 */
export function alignBlocksToKind(kind, blocks) {
  const want = new Set((DATA_BLOCKS[kind] || []).map((b) => b.type));
  const has = new Set();

  const kept = (blocks || [])
    .filter((b) => b && b.type)
    .filter((b) => {
      if (b.type === 'text') return true;
      if (!want.has(b.type)) return false;   // 别的 kind 的数据块，丢掉
      if (has.has(b.type)) return false;     // 同一个数据块重复了，只留一个
      has.add(b.type);
      return true;
    })
    .map((b) => ({ ...b, id: blockId() }));

  // 补齐漏掉的数据块，保证载入后这一类该有的变量都在
  (DEFAULT_ORDER[kind] || []).forEach((type) => {
    if (has.has(type)) return;
    const meta = (DATA_BLOCKS[kind] || []).find((b) => b.type === type);
    if (!meta) return;
    has.add(type);
    kept.push({ id: blockId(), type, name: meta.name, enabled: true });
  });

  return kept;
}
