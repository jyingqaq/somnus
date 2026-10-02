/**
 * AI 接口层（OpenAI 兼容 /chat/completions）
 * 想换供应商/协议，只改这里即可。
 */

import { getState } from '../store.js';

function endpoint() {
  const base = (getState().settings.apiBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置 API 地址');
  return base + '/chat/completions';
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opt]
 * @returns {Promise<string>}
 */
export async function chat(messages, opt = {}) {
  const s = getState().settings;
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

  const res = await fetch(endpoint(), {
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
