/** 我的 */

import { h, fileToAvatar } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, openModal } from '../components/modal.js';
import { listRow } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';
import { canInstall, isIosStandalone, onInstallChange, promptInstall } from '../pwa.js';

function avatarNode(size) {
  const profile = store.getState().profile;
  const style = size ? { width: size, height: size } : null;
  const node = h('div', { class: 'avatar', style });
  if (profile.avatar) node.appendChild(h('img', { src: profile.avatar, alt: '' }));
  else node.appendChild(icon('user', size ? Number(size) * 0.5 : 28));
  return node;
}

function editAvatar(rerender) {
  let pending = store.getState().profile.avatar || '';

  const preview = h('div', { class: 'avatar', style: { width: '92px', height: '92px', borderRadius: '28px', margin: '4px auto 16px' } });
  const paint = () => {
    preview.replaceChildren();
    if (pending) preview.appendChild(h('img', { src: pending, alt: '' }));
    else preview.appendChild(icon('user', 42));
  };
  paint();

  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    pending = await fileToAvatar(file);
    paint();
  });

  const urlInput = h('input', { class: 'field', placeholder: '图片链接', autocomplete: 'off' });
  urlInput.addEventListener('change', () => {
    const v = urlInput.value.trim();
    if (v) { pending = v; paint(); }
  });

  const body = h('div', { class: 'form' },
    preview,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn', onClick: () => fileInput.click() }, icon('image', 19), h('span', { text: '本地上传' })),
      fileInput
    ),
    h('label', { class: 'form-row' },
      h('span', { class: 'form-label', text: '链接' }),
      urlInput
    )
  );

  openModal({
    title: '头像',
    body,
    actions: [
      { label: '取消', kind: 'plain', onClick: (close) => close() },
      {
        label: '保存',
        kind: 'primary',
        onClick: (close) => {
          store.patchProfile({ avatar: pending });
          close();
          rerender();
        }
      }
    ]
  });
}

export function render() {
  const page = h('div', { class: 'page' });
  const slot = h('div');
  page.appendChild(slot);

  function draw() {
    slot.replaceChildren();
    const profile = store.getState().profile;

    slot.appendChild(topbar({ title: '我的', align: 'left', hero: true }));

    /* 用户名称栏 */
    const head = h('div', { class: 'profile-head' },
      (() => {
        const av = avatarNode();
        av.addEventListener('click', () => editAvatar(draw));
        return av;
      })(),
      h('div', { class: 'pf-main' },
        h('div', {
          class: 'pf-nick',
          text: profile.nickname || '未命名',
          onClick: async () => {
            const values = await showForm({
              title: '昵称',
              fields: [{ key: 'nickname', label: '昵称', value: profile.nickname || '' }],
              submitLabel: '保存'
            });
            if (!values) return;
            store.patchProfile({ nickname: values.nickname });
            draw();
          }
        }),
        h('div', {
          class: 'pf-bio',
          text: profile.bio || '个人简介',
          onClick: async () => {
            const values = await showForm({
              title: '个人简介',
              fields: [{ key: 'bio', label: '个人简介', type: 'textarea', value: profile.bio || '', rows: 4 }],
              submitLabel: '保存'
            });
            if (!values) return;
            store.patchProfile({ bio: values.bio });
            draw();
          }
        })
      )
    );
    slot.appendChild(head);

    /* 功能入口 */
    const rows = [
      { label: '角色', iconName: 'person', path: '/library/roles' },
      { label: '世界书', iconName: 'globe', path: '/library/worlds' },
      { label: '灵感', iconName: 'bulb', path: '/library/ideas' },
      { label: '提示词', iconName: 'layers', path: '/prompt' },
      { label: '备份', iconName: 'upload', path: '/backup' },
      { label: '设置', iconName: 'gear', path: '/settings' }
    ];

    slot.appendChild(h('div', { class: 'card' },
      h('div', { class: 'list' }, rows.map((r) => h('div', {
        class: 'row',
        onClick: () => navigate(r.path)
      },
        icon(r.iconName, 20, 'ico row-ico'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: r.label })),
        h('span', { class: 'chev' }, icon('chev', 18))
      )))
    ));

    /*
     * 安装入口。
     * 只在「确实能装」的时候出现：浏览器已给出安装能力，或 iOS 可以手动加主屏。
     * 一旦装成就整行隐藏 —— 已经装好的应用再提示安装是废话。
     * beforeinstallprompt 是异步到达的，所以订阅状态变化后重绘。
     */
    const installCard = h('div', { class: 'card' });
    slot.appendChild(installCard);

    function drawInstall() {
      installCard.replaceChildren();

      const showIosGuide = isIosStandalone();
      if (!showIosGuide && !canInstall()) return;

      const sub = showIosGuide
        ? '通过 Safari 分享菜单添加到主屏幕'
        : '安装后可从桌面直接打开，断网也能用';

      installCard.appendChild(h('div', { class: 'list' },
        listRow({
          label: '安装到桌面',
          sub,
          iconName: 'download',
          onClick: async () => {
            // iOS 没有 beforeinstallprompt，只能引导用户手动加
            if (showIosGuide) {
              toast('点底部「分享」→「添加到主屏幕」');
              return;
            }
            const res = await promptInstall();
            if (res === 'dismissed') toast('已取消安装');
          }
        })
      ));
    }

    drawInstall();
    // 页面被替换时由 router 丢弃 DOM，这里退订即可
    unsubscribeInstall = onInstallChange(drawInstall);
  }

  let unsubscribeInstall = null;
  draw();
  return page;
}
