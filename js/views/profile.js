/** 我的 */

import { h, fileToAvatar } from '../util/dom.js';
import { icon } from '../util/icons.js';
import * as store from '../store.js';
import { topbar } from '../components/topbar.js';
import { showForm, openModal } from '../components/modal.js';
import { listRow } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';
import { installState, onInstallChange, promptInstall } from '../pwa.js';

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
     *
     * 关键是**不能等 beforeinstallprompt 才显示入口**。Chrome 要用户点过一次、
     * 停留满 30 秒才派发该事件，而浏览器菜单里的「安装应用」同期就已经可用了 ——
     * 若把入口绑死在那个事件上，新访客会看到「没有安装按钮，但菜单里能装」的矛盾。
     * 所以四种状态都显示入口，只是文案和点击行为不同。
     */
    const installCard = h('div', { class: 'card' });
    slot.appendChild(installCard);

    function drawInstall(state) {
      installCard.replaceChildren();

      // 已装成就整块撤掉：再提示安装是废话
      if (state === 'installed') return;

      const COPY = {
        native: {
          sub: '安装后可从桌面直接打开，断网也能用',
          act: null            // 弹浏览器原生安装框
        },
        ios: {
          sub: '通过 Safari 分享菜单添加到主屏幕',
          act: () => toast('点底部「分享」→「添加到主屏幕」')
        },
        menu: {
          sub: '在浏览器菜单里选择「安装应用」',
          act: () => openMenuGuide()
        }
      };
      const cur = COPY[state] || COPY.menu;

      installCard.appendChild(h('div', { class: 'list' },
        listRow({
          label: '安装到桌面',
          sub: cur.sub,
          iconName: 'download',
          onClick: async () => {
            if (cur.act) { cur.act(); return; }
            const res = await promptInstall();
            if (res === 'dismissed') toast('已取消安装');
          }
        })
      ));
    }

    /** 还没有原生安装能力时，弹窗讲清各浏览器怎么装 */
    function openMenuGuide() {
      const isEdge = /Edg\//.test(navigator.userAgent);
      openModal({
        title: '安装到桌面',
        body: h('div', { class: 'form' },
          h('div', { class: 'empty' },
            isEdge ? '点右上角「…」，选「应用」→「安装此站点为应用」'
              : '点右上角「⋮」菜单，选「投放」/「安装应用」'
          ),
          h('div', { class: 'form-label', text: '也可以直接点地址栏右侧的安装图标。' })
        ),
        actions: [{ label: '知道了', kind: 'primary', onClick: (close) => close() }]
      });
    }

    drawInstall(installState());
    // 页面被替换时由 router 丢弃 DOM，这里退订即可
    unsubscribeInstall = onInstallChange(drawInstall);
  }

  let unsubscribeInstall = null;
  draw();
  return page;
}
