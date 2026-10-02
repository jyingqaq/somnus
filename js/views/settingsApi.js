/** 设置 · API（含预设管理） */

import { h } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showSheet, showForm, showConfirm } from '../components/modal.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { fieldWithButton, listRow } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { back } from '../router.js';
import { listModels } from '../services/ai.js';

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

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

  function draw() {
    slot.replaceChildren();
    const s = store.getState().settings;

    slot.appendChild(topbar({
      title: 'API',
      back: true,
      align: 'center',
      onBack: () => back('/settings')
    }));

    const textField = (key, label, { type = 'text', placeholder = '', step } = {}) => {
      const input = h('input', {
        class: 'field',
        type,
        value: s[key] ?? '',
        placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false'
      });
      if (step) input.step = step;
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        store.patchSettings({ [key]: type === 'number' ? Number(raw) : raw });
        toast('已保存');
      });
      return h('label', { class: 'form-row', style: { padding: '11px 14px' } },
        h('span', { class: 'form-label', text: label }),
        input
      );
    };

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

    /* 预设 */
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
