/**
 * 章节评论解析：把模型返回的自然语言结果尽量稳妥地还原成结构化评论。
 *
 * 解析器刻意写得很宽容。模型返回格式出错是常态（多一层 ```json、
 * 加序号、用全角竖线、把「网名：」和「评论：」拆成两行……），
 * 这里按「JSON → 逐行」两级依次尝试，都失败才返回空数组，
 * 由调用方把原始文本原样展示给用户，而不是直接报「生成失败」。
 */

const MAX_COMMENTS = 12;
const MAX_NAME = 16;
const MAX_TEXT = 200;

const NAME_KEYS = ['name', 'nickname', 'nick', 'user', 'username', 'author', '网名', '昵称', '用户名', '名字'];
const TEXT_KEYS = ['text', 'content', 'comment', 'message', 'body', '评论', '内容', '评论内容', '正文'];
const REPLY_KEYS = ['replyto', 'reply_to', 'reply', 'target', 'to', '回复', '回复给', '回复对象'];

/** 竖线分隔符的几种写法：半角、全角、竖、竖杠 */
const BAR_SEPS = ['|', '｜', '丨', '│'];

const NAME_LABEL = /^(?:网名|昵称|用户名|名字|name)\s*[:：]\s*(.*)$/i;
const TEXT_LABEL = /^(?:评论内容|评论|内容|正文|comment|text)\s*[:：]\s*(.*)$/i;

/** 行首的序号 / 列表符号 */
const LEAD_MARK = /^\s*(?:[-*•·▪◦>]+|\d+\s*[.、)）:：]|[（(]\s*\d+\s*[)）])\s*/;

/** 整行都是分隔线 */
const RULE_LINE = /^[-=_~*#\s]{3,}$/;

/** 一行里出现这些标点，说明它更像正文而不是「名字：」 */
const SENTENCE_PUNCT = /[。！？，、；…]/;

const FALLBACK_NAMES = ['匿名读者', '路过', '夜读者', '书虫', '看客', '过客'];

/** 去掉首尾的引号、书名号、markdown 强调符等噪音 */
function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\u00a0/g, ' ')
    .replace(/^[\s"'“”‘’「」『』《》【】*`]+/, '')
    .replace(/[\s"'“”‘’「」『』《》【】*`]+$/, '')
    .trim();
}

/* ---------------- JSON 路线 ---------------- */

function pickKey(obj, keys) {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key.trim().toLowerCase())) continue;
    const value = obj[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function unwrapFence(text) {
  return text
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/** 模型可能在 JSON 外面多写一句引导语，这里把所有可能是 JSON 的片段都列出来 */
function jsonCandidates(text) {
  const out = [];
  const body = unwrapFence(text);
  if (/^[[{]/.test(body)) out.push(body);

  // ```json … ``` 代码块，不管夹在哪里
  const fence = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence) out.push(unwrapFence(fence[1]));

  // 顶格的 [ 或 { 之后才是 JSON，前面是引导语
  const at = body.search(/^[ \t]*[[{]/m);
  if (at > 0) out.push(body.slice(at));

  return out;
}

function tryParseJson(text) {
  for (const candidate of jsonCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 截到最后一个闭合括号再试一次
      const start = candidate.search(/[[{]/);
      if (start < 0) continue;
      const end = candidate.lastIndexOf(candidate[start] === '[' ? ']' : '}');
      if (end <= start) continue;
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch { /* 换个候选继续 */ }
    }
  }
  return null;
}

function fromJson(text) {
  const data = tryParseJson(text);
  if (data == null) return null;

  if (Array.isArray(data)) return collect(data);
  if (typeof data !== 'object') return null;

  const named = data.comments || data.list || data.data || data.items || data.result;
  if (Array.isArray(named)) return collect(named);

  // 也可能包成 { "评论": [...] } 这种中文键
  const firstArray = Object.values(data).find((v) => Array.isArray(v));
  return firstArray ? collect(firstArray) : null;
}

function collect(arr) {
  const out = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const parsed = parseLine(item, true);
      if (parsed) out.push(parsed);
      continue;
    }
    if (item && typeof item === 'object') {
      const name = clean(pickKey(item, NAME_KEYS));
      const text = clean(pickKey(item, TEXT_KEYS));
      const replyTo = clean(pickKey(item, REPLY_KEYS)).replace(/^@+/, '');
      if (text) out.push({ name, text, replyTo });
    }
  }
  return out.length ? out : null;
}

/* ---------------- 逐行路线 ---------------- */

/**
 * 单行拆成 {name, text}
 * @param {string} raw 原始行
 * @param {boolean} allowColon 是否允许用「名字：内容」这种没有竖线的写法
 */
function parseLine(raw, allowColon) {
  const line = clean(clean(raw).replace(LEAD_MARK, ''));
  if (!line) return null;

  for (const sep of BAR_SEPS) {
    const at = line.indexOf(sep);
    if (at > 0) {
      const name = clean(line.slice(0, at));
      const text = clean(line.slice(at + sep.length));
      if (text) return { name, text };
    }
  }

  if (allowColon) {
    const at = line.search(/[:：\t]/);
    if (at > 0) {
      const head = line.slice(0, at);
      const tail = clean(line.slice(at + 1));
      // 只在前缀「像名字」时才切：够短、没有空格、不含句读标点
      const looksLikeName = head.length >= 2 && head.length <= 5 && !/\s/.test(head) && !SENTENCE_PUNCT.test(head);
      if (tail && looksLikeName) return { name: clean(head), text: tail };
    }
  }

  return { name: '', text: line };
}

function fromLines(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !RULE_LINE.test(l));

  // 整篇都没出现竖线，才推断模型走的是「名字：内容」路线；
  // 只要有一行用了竖线，冒号就一律当正文，避免切坏带冒号的评论
  const colonMode = !lines.some((l) => BAR_SEPS.some((s) => l.includes(s)));

  const out = [];
  let pendingName = '';

  for (const line of lines) {
    const stripped = line.replace(LEAD_MARK, '').trim();

    // 「网名：xxx」独占一行，名字留给下一行用
    const nameHit = stripped.match(NAME_LABEL);
    if (nameHit) {
      pendingName = clean(nameHit[1]);
      continue;
    }

    // 「评论：xxx」独占一行，与上一行的名字配对
    const textHit = stripped.match(TEXT_LABEL);
    if (textHit && textHit[1].trim()) {
      out.push({ name: pendingName, text: clean(textHit[1]) });
      pendingName = '';
      continue;
    }

    // 「好的，以下是评论：」这类引导语，不是评论
    if (!BAR_SEPS.some((s) => stripped.includes(s)) && /[:：]$/.test(stripped)) continue;

    const parsed = parseLine(stripped, colonMode);
    if (parsed) {
      out.push({ name: pendingName || parsed.name, text: parsed.text });
      pendingName = '';
    }
  }

  return out;
}

/* ---------------- 归一化 ---------------- */

/** 清洗 + 补名字，先不去重（去重要等 @回复 拆出来之后才有正确的 key） */
function sanitize(list) {
  const out = [];

  for (const item of list) {
    let text = clean(item.text);
    if (!text) continue;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    let name = clean(item.name).replace(/^@+/, '').slice(0, MAX_NAME);
    // 名字位混进了英文键名（{name: ...} 被原样吐出来）时兜底
    if (!name || NAME_KEYS.includes(name.toLowerCase())) {
      name = FALLBACK_NAMES[out.length % FALLBACK_NAMES.length];
    }

    out.push({ name, text, replyTo: clean(item.replyTo).replace(/^@+/, '').slice(0, MAX_NAME) });
  }

  return out;
}

/** @ 后面允许紧跟的收尾字符：空格、常见标点或整句结束 */
const MENTION_TAIL = /^[\s，,、：:！!？?。.~—\-…]*/;

/**
 * 把「@网名 正文」拆成 { replyTo, text }。
 *
 * 只认**已知网名**（已有评论 + 本批生成的人），并且最长优先匹配，
 * 避免「@林」把「@林间」咬掉一半；@ 到不存在的人时保持原样，不误解。
 */
function attachReplies(list, knownNames) {
  const names = [...new Set(knownNames.filter(Boolean))].sort((a, b) => b.length - a.length);

  return list.map((item) => {
    // JSON 里直接给了回复对象，且对象确实存在 —— 优先采信
    if (item.replyTo && names.includes(item.replyTo)) return { ...item };
    if (!item.text.startsWith('@')) return { ...item, replyTo: '' };

    for (const name of names) {
      if (!item.text.startsWith(`@${name}`)) continue;
      const rest = item.text.slice(name.length + 1);
      if (rest && !MENTION_TAIL.test(rest)) continue; // @林 不该匹配到 @林间
      const body = rest.replace(MENTION_TAIL, '').trim();
      if (!body) break; // 只 @ 了人没写内容，当作普通评论保留
      return { name: item.name, text: body, replyTo: name };
    }
    return { ...item, replyTo: '' };
  });
}

/** 去重：同一个人 + 同一个回复对象 + 同一句话才算重复 */
function dedupe(list) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const key = `${item.name}::${item.replyTo || ''}::${item.text.replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_COMMENTS) break;
  }

  return out;
}

/* ---------------- 拒答识别 ---------------- */

/** 模型拒答时的典型开头 */
const REFUSAL_OPEN = /^(很?抱歉|对不起|不好意思|作为一个|作为 ?AI|作为人工智能|作为语言模型|我(无法|不能))/;
/** 与开头同时出现，才确认是拒答而不是评论（「抱歉，这章我读不下去」应当保留） */
const REFUSAL_BODY = /(无法|不能|没法|做不到|不便)(完成|满足|生成|提供|继续|回应|帮助)|(这个|该|你的|此)请求|违规|不当|敏感/;

/**
 * 解析模型返回的评论文本
 * @param {string} raw
 * @returns {Array<{name:string,text:string}>} 解析失败返回空数组
 */
/**
 * 解析模型返回的评论文本
 * @param {string} raw 模型原始输出
 * @param {{names?:string[]}} [options] names = 评论区已有的网名，用来校验 @ 的对象是否存在
 * @returns {Array<{name:string,text:string,replyTo:string}>} 解析失败返回空数组
 */
export function parseComments(raw, options = {}) {
  const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const viaJson = fromJson(text);
  const list = sanitize(viaJson || fromLines(text));

  // 整段没有任何分隔符、只解出一条、又像拒答 —— 判定为没生成成功，
  // 交给调用方把原文摊给用户看，而不是塞一条「抱歉，我无法完成这个请求」进评论区
  if (list.length === 1 && !viaJson && !BAR_SEPS.some((s) => text.includes(s))) {
    const only = list[0].text;
    if (REFUSAL_OPEN.test(only) && REFUSAL_BODY.test(only)) return [];
  }

  // @ 的对象既可以是评论区里已有的人，也可以同批里刚生成出来的人
  const known = [...(options.names || []), ...list.map((it) => it.name)];
  return dedupe(attachReplies(list, known));
}

export default parseComments;
