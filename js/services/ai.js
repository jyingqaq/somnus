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

function endpoint(cfg) {
  const base = (cfg.apiBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置 API 地址');
  return base + '/chat/completions';
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opt] scope: 'comment' 时用评论专用配置
 * @returns {Promise<string>}
 */
export async function chat(messages, opt = {}) {
  const s = configOf(opt.scope);
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
  if (!base) throw new Error('未配置 API 地址');

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
  if (!(s.apiBase || '').trim()) throw new Error('未配置 API 地址');
  if (!(s.apiKey || '').trim()) throw new Error('未配置 API Key');

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
