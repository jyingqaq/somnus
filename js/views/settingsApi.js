/** 设置 · API（含预设管理） */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showSheet, showForm, showConfirm, openModal } from '../components/modal.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { fieldWithButton, listRow, switchBox } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { back } from '../router.js';
import { listModels, testConnection } from '../services/ai.js';

/** 评论专用接口里，这些字段留空 = 沿用主配置 */
const C_FIELDS = ['apiBase', 'apiKey', 'model', 'temperature', 'maxTokens'];

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  /* ---------------- 主配置：拉模型 / 预设 ---------------- */

  async function pullModels() {
    showLoading('拉取模型');
    try {
      const ids = await listModels();
      hideLoading();
      if (!ids.length) { toast('未返回模型'); return; }
      showSheet({
        title: `模型（${ids.length}）`,
        items: ids.map((id) => ({
          label: id,
          onClick: () => {
            store.patchSettings({ model: id });
            toast('已切换模型');
            draw();
          }
        }))
      });
    } catch (e) {
      hideLoading();
      toast(e.message || '拉取失败');
    }
  }

  /** 评论专用接口的模型列表：传 override，让它用自己那套地址/Key */
  async function pullCommentModels() {
    const c = store.getState().settings.commentApi || {};
    showLoading('拉取模型');
    try {
      const ids = await listModels({
        apiBase: c.apiBase || store.getState().settings.apiBase,
        apiKey: c.apiKey || store.getState().settings.apiKey
      });
      hideLoading();
      if (!ids.length) { toast('未返回模型'); return; }
      showSheet({
        title: `模型（${ids.length}）`,
        items: ids.map((id) => ({
          label: id,
          onClick: () => {
            store.patchCommentApi({ model: id });
            toast('已切换模型');
            draw();
          }
        }))
      });
    } catch (e) {
      hideLoading();
      toast(e.message || '拉取失败');
    }
  }

  /** 拿评论专用配置发一条最短的请求，验证地址/Key/模型能不能用 */
  async function testCommentApi() {
    showLoading('测试连接');
    try {
      const { model, reply } = await testConnection('comment');
      hideLoading();
      openModal({
        title: '连接成功',
        body: h('div', {},
          h('div', { class: 'alert-msg', text: `模型 ${model || '未知'} 已响应，评论拉取将走这套配置。` }),
          h('pre', { class: 'prompt-preview', text: reply || '（返回为空）' })
        ),
        actions: [{ label: '好', kind: 'primary', onClick: (close) => close() }]
      });
    } catch (e) {
      hideLoading();
      toast(e.message || '连接失败');
    }
  }

  /** 把主配置整份复制过来，省得逐项手输 */
  async function copyMainToComment() {
    const s = store.getState().settings;
    const ok = await showConfirm({
      title: '复制主配置',
      message: '将把主配置的地址、Key、模型、温度、最大长度全部写入评论专用接口。',
      confirmLabel: '复制'
    });
    if (!ok) return;
    store.patchCommentApi({
      apiBase: s.apiBase,
      apiKey: s.apiKey,
      model: s.model,
      temperature: String(s.temperature),
      maxTokens: String(s.maxTokens),
      enabled: true
    });
    toast('已复制');
    draw();
  }

  async function resetCommentApi() {
    const ok = await showConfirm({
      title: '清空评论配置',
      message: '评论专用接口将恢复为全部沿用主配置。',
      confirmLabel: '清空'
    });
    if (!ok) return;
    const blank = {};
    C_FIELDS.forEach((k) => { blank[k] = ''; });
    store.patchCommentApi(blank);
    toast('已清空');
    draw();
  }

  /* ---------------- 预设 ---------------- */

  async function savePreset() {
    const values = await showForm({
      title: '保存 API 预设',
      fields: [{ key: 'name', label: '预设名称', placeholder: '例如：官方 / 中转' }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.saveApiPreset(values.name);
    toast('已保存');
    draw();
  }

  function presetMenu(preset) {
    showSheet({
      title: preset.name,
      items: [
        {
          label: '应用',
          icon: 'check',
          onClick: () => { store.applyApiPreset(preset.id); toast('已切换'); draw(); }
        },
        { label: '重命名', icon: 'edit', onClick: () => renamePreset(preset) },
        { label: '删除', icon: 'trash', onClick: () => deletePreset(preset) }
      ]
    });
  }

  async function renamePreset(preset) {
    const values = await showForm({
      title: '重命名',
      fields: [{ key: 'name', label: '预设名称', value: preset.name }],
      submitLabel: '保存'
    });
    if (!values) return;
    store.renameApiPreset(preset.id, values.name);
    draw();
  }

  async function deletePreset(preset) {
    const ok = await showConfirm({ title: '删除预设', message: preset.name });
    if (!ok) return;
    store.removeApiPreset(preset.id);
    toast('已删除');
    draw();
  }

  /* ---------------- 渲染 ---------------- */

  function draw() {
    slot.replaceChildren();
    const s = store.getState().settings;
    const c = s.commentApi || {};

    slot.appendChild(topbar({
      title: 'API',
      back: true,
      align: 'center',
      onBack: () => back('/settings')
    }));

    /**
     * 一个输入行。target 决定写回 settings 还是 settings.commentApi。
     * 数字项允许留空（评论专用配置里表示「跟随主配置」），所以要区分空串和 0。
     */
    const textField = (key, label, { type = 'text', placeholder = '', step, target = 'main' } = {}) => {
      const src = target === 'comment' ? c : s;
      const input = h('input', {
        class: 'field',
        type,
        value: src[key] ?? '',
        placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false'
      });
      if (step) input.step = step;
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        let val = raw;
        if (type === 'number') val = raw === '' ? '' : Number(raw);
        if (target === 'comment') store.patchCommentApi({ [key]: val });
        else store.patchSettings({ [key]: val });
        toast('已保存');
        // 空/非空会改变「跟随主配置」的提示文案，重画一次
        if (target === 'comment') draw();
      });
      return h('label', { class: 'form-row', style: { padding: '11px 14px' } },
        h('span', { class: 'form-label', text: label }),
        input
      );
    };

    /* ---- 主配置 ---- */
    slot.appendChild(h('div', { class: 'section-title', text: '主配置 · 用于正文创作与续写' }));
    slot.appendChild(h('div', { class: 'card' },
      textField('apiBase', 'API 地址', { placeholder: 'https://api.openai.com/v1' }),
      textField('apiKey', 'API Key', { type: 'password', placeholder: 'sk-...' }),
      fieldWithButton({
        label: '模型',
        value: s.model,
        placeholder: 'gpt-4o-mini',
        onChange: (v) => { store.patchSettings({ model: v }); toast('已保存'); },
        buttonLabel: '拉取',
        onButton: pullModels
      }),
      textField('temperature', '温度', { type: 'number', step: '0.1', placeholder: '0.9' }),
      textField('maxTokens', '最大长度', { type: 'number', placeholder: '0 表示不限制' })
    ));

    /* ---- 评论专用接口 ---- */
    slot.appendChild(h('div', { class: 'section-title', text: '评论专用接口 · 用于章节页拉取评论' }));

    const cCard = h('div', { class: 'card' });

    // 开关行：关掉时整块折叠，评论就完全走主配置
    cCard.appendChild(h('div', { class: 'row', style: { borderBottom: '1px solid var(--line)' } },
      icon('chat', 20, 'ico row-ico'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: '使用独立接口' }),
        h('div', {
          class: 'row-sub',
          text: c.enabled ? '评论走下面这套配置' : '关闭中，评论沿用主配置'
        })
      ),
      switchBox({
        checked: !!c.enabled,
        onChange: (v) => {
          store.patchCommentApi({ enabled: v });
          toast(v ? '已启用评论专用接口' : '已改为沿用主配置');
          draw();
        }
      })
    ));

    if (c.enabled) {
      cCard.appendChild(textField('apiBase', 'API 地址', {
        placeholder: `留空沿用主配置：${s.apiBase || '未设置'}`,
        target: 'comment'
      }));
      cCard.appendChild(textField('apiKey', 'API Key', {
        type: 'password',
        placeholder: s.apiKey ? '留空沿用主配置的 Key' : '留空沿用主配置（主配置也没填）',
        target: 'comment'
      }));
      cCard.appendChild(fieldWithButton({
        label: '模型',
        value: c.model,
        placeholder: `留空沿用主配置：${s.model || '未设置'}`,
        onChange: (v) => { store.patchCommentApi({ model: v }); toast('已保存'); },
        buttonLabel: '拉取',
        onButton: pullCommentModels
      }));
      cCard.appendChild(textField('temperature', '温度', {
        type: 'number',
        step: '0.1',
        placeholder: `留空沿用主配置：${s.temperature}`,
        target: 'comment'
      }));
      cCard.appendChild(textField('maxTokens', '最大长度', {
        type: 'number',
        placeholder: `留空沿用主配置：${s.maxTokens || 0}`,
        target: 'comment'
      }));

      // 生效状态：告诉用户最终到底会用哪一套
      const eff = store.resolveCommentApi();
      cCard.appendChild(h('div', { class: 'form-row', style: { padding: '11px 14px' } },
        h('span', { class: 'form-label', text: '当前生效' }),
        h('div', { class: 'alert-msg', style: { padding: '0' } },
          `${eff.apiBase || '未设置'} · ${eff.model || '未设置模型'}` +
          (store.commentApiDiffers() ? '' : '（与主配置一致）'))
      ));

      cCard.appendChild(listRow({ label: '测试连接', iconName: 'check', onClick: testCommentApi }));
      cCard.appendChild(listRow({ label: '复制主配置过来', iconName: 'copy', onClick: copyMainToComment }));
      cCard.appendChild(listRow({
        label: '清空评论配置',
        iconName: 'trash',
        danger: true,
        onClick: resetCommentApi
      }));
    }

    slot.appendChild(cCard);

    /* ---- 预设 ---- */
    slot.appendChild(h('div', { class: 'section-title', text: '预设' }));
    const presetCard = h('div', { class: 'card' },
      listRow({ label: '保存当前配置为预设', iconName: 'save', onClick: savePreset })
    );

    store.list('apiPresets').forEach((p) => {
      const active = store.getState().activeApiPreset === p.id;
      presetCard.appendChild(h('div', {
        class: 'row',
        onClick: () => { store.applyApiPreset(p.id); toast('已切换'); draw(); }
      },
        icon(active ? 'check' : 'layers', 20, 'ico' + (active ? ' row-ico' : '')),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: p.name }),
          h('div', { class: 'row-sub', text: p.model || '未设置模型' })
        ),
        h('button', {
          class: 'fo-op',
          onClick: (e) => { e.stopPropagation(); presetMenu(p); }
        }, icon('edit', 18))
      ));
    });

    slot.appendChild(presetCard);
  }

  draw();
  return page;
}
