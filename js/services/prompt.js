/**
 * 提示词构建：把「块」按顺序拼成最终请求。
 *
 * 缓存友好设计：块越靠前越稳定。书名 / 简介 / 全部章节这类内容在两次请求之间完全一致，
 * 只有末尾的「剧情走向」会变，因此前缀可以稳定命中服务端 prompt cache。
 * 默认顺序就是这个原则，用户在「提示词」页改动顺序时请保留最后一块为变动内容。
 */

import { getState } from '../store.js';
import { KINDS, DATA_BLOCKS } from './promptSchema.js';

export { KINDS, DATA_BLOCKS, isDataBlock } from './promptSchema.js';

/** 取值：把块渲染成文本 */
function renderBlock(block, ctx) {
  switch (block.type) {
    case 'text':
      return (block.text || '').trim();

    // ---- 创作 ----
    case 'title':
      return ctx.title ? `【标题】${ctx.title}` : '';
    case 'content':
      return ctx.content ? `【创作要求】\n${ctx.content}` : '';

    // ---- 续写 ----
    case 'bookTitle':
      return ctx.book ? `【书名】${ctx.book.title || '未命名'}` : '';
    case 'bookIntro':
      return ctx.book && ctx.book.intro ? `【简介】\n${ctx.book.intro}` : '';
    case 'bookChapters':
      return chaptersText(ctx.book);
    case 'direction':
      return ctx.direction ? `【本章剧情走向】\n${ctx.direction}` : '';

    // ---- 评论 ----
    case 'chapterContent':
      return chapterText(ctx.chapter);
    case 'existingComments':
      return commentsText(ctx.comments);

    default:
      return '';
  }
}

/** 全书正文：章节顺序固定、逐字不变，保证前缀稳定 */
function chaptersText(book) {
  const chapters = (book && book.chapters) || [];
  if (!chapters.length) return '';
  return chapters
    .map((c, i) => `【${c.title || `第${i + 1}章`}】\n${c.content || ''}`)
    .join('\n\n');
}

/** 单章正文（评论用，只带书名和这一章，不带简介） */
function chapterText(chapter) {
  if (!chapter) return '';
  const body = (chapter.content || '').trim();
  if (!body) return '';
  return `【${chapter.title || '本章'}】\n${body}`;
}

/**
 * 已有评论，交给模型避免重复、也用来判断谁被 @ 了。
 * 写成「网名：@对象 正文」——和模型自己要输出的格式一致，它才好照着接话。
 */
function commentsText(comments) {
  const list = comments || [];
  if (!list.length) return '';
  const lines = list.map((c) => {
    const at = c.replyTo ? `@${c.replyTo} ` : '';
    return `${c.name || '匿名'}：${at}${c.text || ''}`;
  });
  return `【已有评论】\n${lines.join('\n')}`;
}

export function promptConfig(kind) {
  return getState().prompt[kind] || { system: '', blocks: [] };
}

/**
 * 组装最终请求
 * @returns {{system:string, user:string}}
 */
export function buildPrompt(kind, ctx = {}) {
  const cfg = promptConfig(kind);
  const parts = [];
  for (const block of cfg.blocks || []) {
    if (block.enabled === false) continue;
    const text = renderBlock(block, ctx);
    if (text) parts.push(text);
  }
  return { system: (cfg.system || '').trim(), user: parts.join('\n\n') };
}

/* ---------------- 便捷入口 ---------------- */

export const buildCreatePrompt = (ctx = {}) => buildPrompt('create', ctx);
export const buildContinuePrompt = (ctx = {}) => buildPrompt('continue', ctx);
export const buildCommentPrompt = (ctx = {}) => buildPrompt('comment', ctx);

/* ---------------- 预览 ---------------- */

const SAMPLE = {
  create: {
    title: '示例标题',
    content: '示例：详细要求输入框里的内容'
  },
  continue: {
    book: {
      title: '示例书名',
      intro: '示例：这本书的简介',
      chapters: [
        { title: '第1章', content: '示例：第一章正文……' },
        { title: '第2章', content: '示例：第二章正文……' }
      ]
    },
    direction: '示例：这一章想写的剧情走向'
  },
  comment: {
    book: { title: '示例书名' },
    chapter: { title: '第2章', content: '示例：这一章的正文……' },
    comments: [
      { name: '阿柚', text: '示例：评论区里已经有一条评论。' },
      { name: '夜航船', replyTo: '阿柚', text: '示例：读者之间的回复。' },
      { name: '示例昵称', replyTo: '阿柚', text: '示例：你发的回复，会带上 @。' }
    ]
  }
};

/** 预览最终发出的内容（用示例数据填充变量块） */
export function previewPrompt(kind) {
  const { system, user } = buildPrompt(kind, SAMPLE[kind]);
  return [
    system ? `── system ──\n${system}` : '',
    user ? `── user ──\n${user}` : ''
  ].filter(Boolean).join('\n\n');
}
