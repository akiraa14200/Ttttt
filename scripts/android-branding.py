#!/usr/bin/env python3
"""Apply the RykoCollection logo to the generated Capacitor Android project.

Runs in CI after `npx cap add android`. Writes launcher icons (legacy, round and
adaptive foreground) for every density and replaces the default Capacitor splash
images with the logo centred on black. Nothing outside android/app/src/main/res changes.
"""
import pathlib, sys
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO = Image.open(ROOT / 'branding' / 'logo.png').convert('RGBA')
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
if not RES.is_dir():
    sys.exit(f'Android res folder not found: {RES}')

BLACK = (0, 0, 0, 255)
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def logo(size):
    return LOGO.resize((size, size), Image.LANCZOS)

def rounded(img, radius_ratio):
    mask = Image.new('L', img.size, 0)
    r = int(img.size[0] * radius_ratio)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=r, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0)); out.paste(img, (0, 0), mask); return out

def circle(img):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, img.size[0] - 1, img.size[1] - 1], fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0)); out.paste(img, (0, 0), mask); return out

for name, scale in DENSITIES.items():
    folder = RES / f'mipmap-{name}'
    folder.mkdir(parents=True, exist_ok=True)
    legacy = round(48 * scale)
    rounded(logo(legacy), 0.18).save(folder / 'ic_launcher.png')
    circle(logo(legacy)).save(folder / 'ic_launcher_round.png')
    # Adaptive foreground: 108dp canvas; keep the artwork inside the launcher mask safe zone.
    fg_size = round(108 * scale)
    fg = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    art = round(fg_size * 0.80)
    fg.paste(logo(art), ((fg_size - art) // 2, (fg_size - art) // 2))
    fg.save(folder / 'ic_launcher_foreground.png')

# Adaptive icon background colour.
values = RES / 'values'; values.mkdir(exist_ok=True)
(values / 'ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')
anydpi = RES / 'mipmap-anydpi-v26'; anydpi.mkdir(exist_ok=True)
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n')
(anydpi / 'ic_launcher.xml').write_text(adaptive)
(anydpi / 'ic_launcher_round.xml').write_text(adaptive)

# Splash screens: logo centred on black, same pixel size as each generated file.
count = 0
for splash in RES.glob('drawable*/splash.png'):
    with Image.open(splash) as old:
        w, h = old.size
    canvas = Image.new('RGBA', (w, h), BLACK)
    art = round(min(w, h) * 0.42)
    canvas.paste(rounded(logo(art), 0.18), ((w - art) // 2, (h - art) // 2), rounded(logo(art), 0.18))
    canvas.convert('RGB').save(splash)
    count += 1
# Black launch screen everywhere: Android 12+ system splash (otherwise a white/light
# background), the pre-12 splash window, and the window behind the WebView while it loads.
styles = values / 'styles.xml'
xml = styles.read_text()
launch_items = ('        <item name="android:windowBackground">@android:color/black</item>\n'
                '        <item name="windowSplashScreenBackground">@android:color/black</item>\n'
                '        <item name="windowSplashScreenIconBackgroundColor">@android:color/black</item>\n'
                '        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>\n'
                '        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n')
marker = '<item name="android:background">@drawable/splash</item>'
if marker not in xml:
    sys.exit('Unexpected styles.xml: launch theme not found')
if 'windowSplashScreenBackground' not in xml:
    xml = xml.replace(marker, marker + '\n' + launch_items.rstrip('\n'), 1)
no_action = '<item name="android:background">@null</item>'
if no_action in xml and 'android:windowBackground">@android:color/black</item>\n    </style>\n\n\n    <style name="AppTheme.NoActionBarLaunch"' not in xml:
    xml = xml.replace(no_action, no_action + '\n        <item name="android:windowBackground">@android:color/black</item>', 1)
styles.write_text(xml)
v31 = RES / 'values-v31'; v31.mkdir(exist_ok=True)
(v31 / 'styles.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
''' + launch_items + '''        <item name="android:windowSplashScreenBackground">@android:color/black</item>
        <item name="android:windowSplashScreenIconBackgroundColor">@android:color/black</item>
        <item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>
    </style>
</resources>
''')

print(f'Applied RykoCollection branding: icons for {len(DENSITIES)} densities, {count} splash images.')
