/**
 * 首页输入框的「角色 / 世界书 / 灵感」选取面板。
 *
 * 与管理页（views/library.js）保持同一套结构：**根目录先列文件夹，再列未分类的条目**；
 * 点文件夹只列该文件夹里的条目，面包屑点一下回根目录。
 *
 * 曾经这里是直接把 `store.list()` 全量铺出来，于是「我的」页里分好的文件夹到了首页就没了 ——
 * 用户在一堆条目里找不着北。文件夹是同一份数据（state.folders + 条目的 folderId），
 * 选取面板只是换了个入口，展示逻辑该跟着走。
 *
 * 条目行 / 文件夹行来自 components/collectionList.js（与管理页共用的那套），
 * 别在这里另写一遍类名。
 */

import { h, clear } from '../util/dom.js';
import * as store from '../store.js';
import { openModal } from './modal.js';
import { folderRow, itemRow } from './collectionList.js';

/**
 * @param {object} o
 * @param {'role'|'world'|'idea'} o.type
 * @param {(item: object) => void} o.onPick 选中某条（面板**已关闭**之后才回调，
 *   与 showSheet 的行为一致：先收起面板再执行，免得回调里的弹窗被面板压住）
 * @returns {object|null} openModal 的句柄
 */
export function pickCollection({ type, onPick }) {
  const meta = store.COLLECTIONS[type];
  if (!meta) return null;

  let folderId = '';

  const titleNode = h('div', { class: 'm-title', text: meta.label });
  const crumbSlot = h('div');
  const list = h('div', { class: 'list' });
  const body = h('div', {}, crumbSlot, list);

  const modal = openModal({
    title: titleNode,
    body,
    sheet: true,
    actions: [{ label: '关闭', kind: 'plain', onClick: (close) => close() }]
  });

  function draw() {
    clear(crumbSlot);
    clear(list);

    const folders = store.listFolders(meta.key);
    const current = folders.find((f) => f.id === folderId);

    if (current) {
      // 面包屑：点前面那个类别名回根目录（结构与样式跟管理页同一套）
      crumbSlot.appendChild(h('div', { class: 'crumb' },
        h('span', { class: 'crumb-back', text: meta.label, onClick: () => { folderId = ''; draw(); } }),
        h('span', { text: '/' }),
        h('b', { text: current.name })
      ));
    } else {
      // 根目录才显示文件夹；进去之后只列条目，免得还能再套一层
      folders.forEach((f) => {
        list.appendChild(folderRow({
          name: f.name,
          count: store.itemsIn(meta.key, f.id).length,
          openable: true,
          onClick: () => { folderId = f.id; draw(); }
        }));
      });
    }

    const items = store.itemsIn(meta.key, current ? current.id : '');
    items.forEach((it) => {
      list.appendChild(itemRow({
        iconName: meta.icon,
        title: it.title,
        sub: (it.detail || '').slice(0, 30),
        onClick: () => { modal.close(); onPick(it); }
      }));
    });

    if (!list.childNodes.length) {
      list.appendChild(h('div', { class: 'empty', text: current ? '该文件夹暂无内容' : '暂无内容' }));
    }
  }

  draw();
  return modal;
}
