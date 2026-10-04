/**
 * AI 接口层（OpenAI 兼容 /chat/completions）
 * 想换供应商/协议，只改这里即可。
 */

import { getState, resolveCommentApi } from '../store.js';

/**
 * 按用途挑一套配置。
 * scope='comment' 走评论专用接口（没开的项自动回落到主配置），其余用主配置。
 */
export function configOf(scope) {
  return scope === 'comment' ? resolveCommentApi() : getState().settings;
}

/**
 * 「什么算配好了」全项目只有这一处定义：**地址和 Key 都得有**。
 *
 * 为什么要这么严：默认的 apiBase 是有值的（https://api.openai.com/v1），
 * 所以只看地址的话，一个刚装上、什么都还没填的用户也算「配好了」——
 * 于是界面会先挂出「创作中」，再发一个注定 401 的请求，转一圈才报错。
 *
 * 本地不需要鉴权的服务（Ollama / LM Studio 之类）在 Key 里随便填一个
 * 占位字符串即可，换来的是「没配」这件事在界面上分得清楚。
 *
 * @returns {string} 没问题返回空串，否则返回一句能直接给用户看的话
 */
export function apiProblem(scope) {
  const s = configOf(scope);
  if (!(s.apiBase || '').trim()) return '还没填 API 地址';
  if (!(s.apiKey || '').trim()) return '还没填 API Key';
  return '';
}

function endpoint(cfg) {
  const base = (cfg.apiBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('还没填 API 地址');
  return base + '/chat/completions';
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opt] scope: 'comment' 时用评论专用配置
 * @returns {Promise<string>}
 */
export async function chat(messages, opt = {}) {
  const s = configOf(opt.scope);
  // 兜底：任何调用方漏了「先判一次」，这里也不许发出注定失败的请求
  const problem = apiProblem(opt.scope);
  if (problem) throw new Error(problem);

  const body = {
    model: s.model || 'gpt-4o-mini',
    messages,
    temperature: Number(s.temperature) >= 0 ? Number(s.temperature) : 0.9
  };
  const maxTokens = Number(s.maxTokens);
  if (maxTokens > 0) body.max_tokens = maxTokens;
  if (opt.json) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers.Authorization = 'Bearer ' + s.apiKey;

  const res = await fetch(endpoint(s), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    throw new Error(`请求失败 ${res.status} ${detail}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('返回内容为空');
  return content.trim();
}

/** 拉取服务商支持的模型列表 GET /models */
export async function listModels(override) {
  const s = { ...getState().settings, ...(override || {}) };
  const base = (s.apiBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('还没填 API 地址');

  const headers = {};
  if (s.apiKey) headers.Authorization = 'Bearer ' + s.apiKey;

  const res = await fetch(base + '/models', { headers });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    throw new Error(`拉取失败 ${res.status} ${detail}`);
  }
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.data || data.models || []);
  return arr
    .map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model))
    .filter(Boolean)
    .sort();
}

/** 单轮便捷调用 */
export function ask({ system, user }, opt) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  return chat(messages, opt);
}

/**
 * 连通性测试：发一条极短的请求，确认地址 / Key / 模型可用。
 * max_tokens 压到 16，避免测试本身产生不必要费用。
 * @param {string} [scope] 传 'comment' 测试评论专用配置
 * @returns {Promise<{model:string, reply:string}>}
 */
export async function testConnection(scope) {
  const s = configOf(scope);
  const problem = apiProblem(scope);
  if (problem) throw new Error(problem);

  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = 'Bearer ' + s.apiKey;

  const res = await fetch((s.apiBase || '').trim().replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: s.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: '回复「ok」两个字即可' }],
      max_tokens: 16
    })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    throw new Error(`请求失败 ${res.status} ${detail}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string') throw new Error('返回内容为空');
  return { model: data?.model || s.model, reply: reply.trim() };
}
