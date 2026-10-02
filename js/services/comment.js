/**
 * 章节评论：请求 AI 生成评论，并把结果交给 commentParser 解析。
 */

import { ask } from './ai.js';
import { buildCommentPrompt } from './prompt.js';
import { parseComments } from './commentParser.js';

export { parseComments };

/* ---------------- 请求 ---------------- */

/**
 * 让 AI 生成评论
 * @param {{book:object, chapter:object, comments:Array}} ctx
 * @returns {Promise<{raw:string, list:Array}>}
 */
export async function generateComments(ctx) {
  const { system, user } = buildCommentPrompt(ctx);
  const raw = await ask({ system, user });
  // 已有网名传给解析器，用于校验模型 @ 的人是否真的存在
  const names = (ctx.comments || []).map((c) => c.name).filter(Boolean);
  return { raw, list: parseComments(raw, { names }) };
}
