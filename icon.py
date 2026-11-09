from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

RES = 'android/res'

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def gradient_bg(size):
    top, bottom = (16, 30, 47), (8, 38, 40)
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(top, bottom, y / (size - 1)))
    # teal glow top-left
    glow = Image.new('L', (size, size), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-size * 0.3, -size * 0.42, size * 0.85, size * 0.55], fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    color = Image.new('RGB', (size, size), (45, 212, 191))
    img = Image.composite(color, img, glow.point(lambda v: int(v * 0.55)))
    return img

def glyph_layer(size, scale=1.0):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    text = 'Aa'
    font = ImageFont.load_default(size=int(size * 0.46 * scale))
    cx, cy = size / 2, size * 0.49
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((cx, cy + size * 0.012), text, font=font, fill=(0, 0, 0, 100), anchor='mm')
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(size * 0.012)))
    ImageDraw.Draw(img).text((cx, cy), text, font=font, fill=(240, 255, 252, 255), anchor='mm')
    return img

def rounded(img, radius_ratio=0.22):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1],
                                           radius=int(img.size[0] * radius_ratio), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out

# preview
prev = rounded(gradient_bg(512))
prev = Image.alpha_composite(prev, glyph_layer(512, 0.92))
prev.save('icon-preview.png')

sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
fg_sizes = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for dpi, s in sizes.items():
    os.makedirs(f'{RES}/mipmap-{dpi}', exist_ok=True)
    icon = rounded(gradient_bg(s))
    icon = Image.alpha_composite(icon, glyph_layer(s, 0.92))
    icon.save(f'{RES}/mipmap-{dpi}/ic_launcher.png')
    fg = glyph_layer(fg_sizes[dpi], 0.86)
    fg.save(f'{RES}/mipmap-{dpi}/ic_launcher_fg.png')
os.makedirs(f'{RES}/mipmap-anydpi-v26', exist_ok=True)
open(f'{RES}/mipmap-anydpi-v26/ic_launcher.xml', 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBg" />
    <foreground android:drawable="@mipmap/ic_launcher_fg" />
</adaptive-icon>
''')
print('icons done')
