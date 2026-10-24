# -*- coding: utf-8 -*-
"""1) 用 Python 重新打 ZIP（ZIP 规范要求正斜杠，PowerShell 的 Compress-Archive 会写成反斜杠）
   2) 生成 Toy 封面（4:3，1200x900）"""
import os, sys, zipfile, math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
ZIP = os.path.join(ROOT, 'yanshiji-shuowang-toy.zip')

# ---------- 1. 打包 ----------
if os.path.exists(ZIP):
    os.remove(ZIP)
files = []
for dirpath, _, names in os.walk(DIST):
    for n in names:
        full = os.path.join(dirpath, n)
        files.append(os.path.relpath(full, DIST).replace('\\', '/'))
files.sort()
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(os.path.join(DIST, rel.replace('/', os.sep)), rel)

print('ZIP:', os.path.basename(ZIP), round(os.path.getsize(ZIP) / 1024, 1), 'KB')
with zipfile.ZipFile(ZIP) as z:
    bad = [i.filename for i in z.infolist() if '\\' in i.filename]
    print('  条目（正斜杠检查）:')
    for i in z.infolist():
        print(f'    {i.filename:<26} {i.file_size/1024:7.1f} KB')
    print('  ' + ('✓ 全部使用正斜杠' if not bad else '✗ 仍有反斜杠: ' + str(bad)))
    print('  ' + ('✓ 根目录有 index.html' if 'index.html' in [i.filename for i in z.infolist()] else '✗ 缺少 index.html'))

# ---------- 2. 封面 ----------
# ⚠ 这一段画的是**程序生成的备用封面**。项目里真正投稿用的是 AI 生成 + 合成的
# toy-poster-1200x900.png（原图另存于 朔望月-海报视觉_assets/）。
# 以前这里无条件覆盖，跑一次打包就把合成封面冲掉了（1.8MB → 63KB）。
# 现在默认只在文件不存在时才生成；要主动重画请显式加 --force-cover。
COVER = os.path.join(ROOT, 'toy-poster-1200x900.png')
if os.path.exists(COVER) and '--force-cover' not in sys.argv:
    print('\n封面: 已存在 toy-poster-1200x900.png，跳过程序生成'
          '（要重画备用封面加 --force-cover）')
    sys.exit(0)

W, H = 1200, 900
PAPER = (245, 239, 226)
INK = (47, 42, 33)
INK2 = (88, 79, 63)
DIM = (139, 130, 114)
GOLD = (168, 132, 44)
SEASON = {'春': ((63, 128, 80), (243, 250, 244), (168, 207, 176)),
          '夏': ((188, 82, 54), (253, 241, 237), (226, 176, 160)),
          '秋': ((173, 125, 30), (253, 246, 230), (223, 196, 134)),
          '冬': ((63, 99, 137), (238, 244, 250), (170, 195, 220))}

F = r'C:\Windows\Fonts'
def font(name, size):
    return ImageFont.truetype(os.path.join(F, name), size)
F_SERIF = lambda s: font('STSONG.TTF', s)
F_BOLD  = lambda s: font('msyhbd.ttc', s)
F_SANS  = lambda s: font('msyh.ttc', s)

img = Image.new('RGB', (W, H), PAPER)
# 竖向平滑渐变底色（避免椭圆渐晕留下可见弧线）
top_c, bot_c = (255, 252, 246), (240, 232, 214)
for y in range(H):
    t = y / (H - 1)
    d_line = tuple(int(top_c[i] + (bot_c[i] - top_c[i]) * t) for i in range(3))
    ImageDraw.Draw(img).line([(0, y), (W, y)], fill=d_line)
d = ImageDraw.Draw(img)

# 月亮：左新月、右满月（与标题拉开距离）
def crescent(cx, cy, rad, color):
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color)
    off = int(rad * 0.52)
    d.ellipse([cx - rad + off, cy - rad - 2, cx + rad + off, cy + rad + 2], fill=(250, 245, 235))

def fullmoon(cx, cy, rad, color, halo):
    d.ellipse([cx - rad - 16, cy - rad - 16, cx + rad + 16, cy + rad + 16], fill=halo)
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color)

crest_x, crest_y, crest_r = 178, 150, 34
full_x, full_y, full_r = 1022, 150, 36
fullmoon(full_x, full_y, full_r, (247, 226, 156), (253, 246, 223))
crescent(crest_x, crest_y, crest_r, (168, 186, 214))

def center(text, y, fnt, fill):
    w = d.textlength(text, font=fnt)
    d.text(((W - w) / 2, y), text, font=fnt, fill=fill)

center('衍时纪 · 朔望月', 108, F_SERIF(84), INK)
center('二 十 四 节 气 与 十 二 节 日', 226, F_SANS(30), DIM)

# 分隔线
d.line([(300, 292), (900, 292)], fill=(222, 211, 184), width=2)
# 中间的小月亮点缀
d.ellipse([593, 285, 607, 299], fill=GOLD)

# 五张示例牌
CARDS = [
    ('立春', '春', '1', '二月四日', '2·4', '春'),
    ('夏至', '夏', '4', '六月廿一', '6·2·1', '夏'),
    ('秋分', '秋', '4', '九月廿三', '9·2·3', '秋'),
    ('冬至', '冬', '4', '腊月廿二', '1·2·2·2', '冬'),
    ('端午', '节', None, '五月初五', '5·5', '夏'),
]
cw, ch, gap = 156, 224, 22
total = len(CARDS) * cw + (len(CARDS) - 1) * gap
x0 = (W - total) // 2
y0 = 348
for i, (name, tag, order, date, digits, season) in enumerate(CARDS):
    x = x0 + i * (cw + gap)
    accent, bg, border = SEASON[season]
    d.rounded_rectangle([x, y0, x + cw, y0 + ch], radius=16, fill=bg, outline=border, width=3)
    # 顶部色带
    d.rounded_rectangle([x, y0, x + cw, y0 + 12], radius=6, fill=accent)
    d.rounded_rectangle([x, y0 + 6, x + cw, y0 + 12], radius=0, fill=accent)
    # 牌名
    nf = F_BOLD(30)
    nw = d.textlength(name, font=nf)
    d.text((x + (cw - nw) / 2, y0 + 34), name, font=nf, fill=INK)
    # 季·序 / 彩
    tagtxt = (tag + order) if order else '彩牌'
    tf = F_BOLD(19)
    tw = d.textlength(tagtxt, font=tf)
    d.text((x + (cw - tw) / 2, y0 + 82), tagtxt, font=tf, fill=accent)
    # 日期
    df = F_SANS(18)
    dw = d.textlength(date, font=df)
    d.text((x + (cw - dw) / 2, y0 + 114), date, font=df, fill=DIM)
    # 数字胶囊
    dzf = F_BOLD(24)
    dzw = d.textlength(digits, font=dzf)
    pw = dzw + 34
    d.rounded_rectangle([x + (cw - pw) / 2, y0 + 152, x + (cw + pw) / 2, y0 + 196], radius=10, fill=(243, 233, 207))
    d.text((x + (cw - dzw) / 2, y0 + 158), digits, font=dzf, fill=INK)

center('三十六张牌 · 三套玩法 · 朔比形，望比和', 636, F_SANS(24), INK2)
center('原 · 朔望月　|　衍 · 朔望月　|　衍时纪 · 朔望月', 686, F_BOLD(23), GOLD)
center('赢下地猴 · 记分 combo · 十六点 · 赌命翻盘', 736, F_SANS(21), DIM)

out = os.path.join(ROOT, 'toy-poster-1200x900.png')
img.save(out, 'PNG', optimize=True)
print('\n封面:', os.path.basename(out), f'{W}x{H}', round(os.path.getsize(out) / 1024, 1), 'KB',
      f'(比例 {W/H:.2f}:1 = 4:3)')
