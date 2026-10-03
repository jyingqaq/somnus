"""
生成 PWA 所需的图标。

源图用 icons/a783.gif（370×320）而不是 icons/icon-180.png —— 后者只有 180px，
放到 512 会糊掉。

原图是「透明底 + 白身 + 深色描边」的手绘兔子，直接当图标有两个问题：
1. 透明底在深色任务栏 / 深色启动台上会变成一团看不见的白；
2. Android 会把 maskable 图标裁成圆形，耳朵和下巴会被切掉。
所以下面统一铺一层与 --bg 同色的底板，maskable 版另留 20% 安全边距。

产物落在 icons/，命名统一为 icon-<尺寸>.png（a783.gif 是源图，保留原名）。

    python make-icons.py
"""

import os
from PIL import Image

# 与 index.html 的 <meta name="theme-color"> 保持一致
BG = (243, 243, 246, 255)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, 'icons')

# maskable 的安全区是中心 80% 直径的圆，内容再收一点更保险
MASKABLE_INNER = 0.62


def load_source():
    """取 GIF 首帧并裁到内容边界框，返回正方化的 RGBA。"""
    im = Image.open(os.path.join(ICONS, 'a783.gif')).convert('RGBA')
    box = im.getbbox()  # 只按 alpha 通道裁，GIF 的白底也会被一起裁进来
    im = im.crop(box)

    # 补成正方形，避免长宽比被拉变形
    side = max(im.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return square


def render(src, size, inner=1.0):
    """把 src 缩放后铺到 size×size 的底板上。inner 控制内容占比。"""
    canvas = Image.new('RGBA', (size, size), BG)

    target = int(size * inner)
    art = src.resize((target, target), Image.LANCZOS)
    canvas.paste(art, ((size - target) // 2, (size - target) // 2), art)
    return canvas


def main():
    src = load_source()

    jobs = [
        # 普通图标：内容基本铺满，供浏览器标签、桌面快捷方式等使用。
        # 留 4% 余量，源图内容是贴边的，直接铺满会显得压边。
        ('icon-192.png', 192, 0.96),
        ('icon-512.png', 512, 0.96),
        # maskable：留安全边距，供 Android 自适应图标裁切
        ('icon-maskable-192.png', 192, MASKABLE_INNER),
        ('icon-maskable-512.png', 512, MASKABLE_INNER),
    ]

    for name, size, inner in jobs:
        out = os.path.join(ICONS, name)
        render(src, size, inner).save(out, 'PNG', optimize=True)
        print(f'icons/{name}  {size}x{size}')


if __name__ == '__main__':
    main()
