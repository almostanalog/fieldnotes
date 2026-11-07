"""Stamp a fresh version onto every CSS/JS URL in index.html, so browsers fetch the new
files right after a push instead of reusing cached ones (GitHub Pages lets browsers keep
files for 10 minutes, and home-screen apps can hold on longer).

The stylesheet and app.js get ?v=<stamp>. The other modules are imported from app.js by
relative paths, so an import map in index.html points each of them at its stamped URL too.

Run before each commit:  python tools/stamp.py
"""
import json, re, time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
index = root / 'index.html'
v = time.strftime('%Y%m%d%H%M%S')
html = index.read_text(encoding='utf-8')

html = re.sub(r'href="\./css/app\.css(\?v=\w+)?"', f'href="./css/app.css?v={v}"', html)
html = re.sub(r'src="\./js/app\.js(\?v=\w+)?"', f'src="./js/app.js?v={v}"', html)

modules = sorted(p.name for p in (root / 'js').glob('*.js') if p.name != 'app.js')
imap = json.dumps({'imports': {f'./js/{m}': f'./js/{m}?v={v}' for m in modules}}, indent=2)
block = f'<script type="importmap">\n{imap}\n</script>'
if '<script type="importmap">' in html:
    html = re.sub(r'<script type="importmap">.*?</script>', lambda _: block, html, flags=re.S)
else:   # the import map has to come before the first module script
    html = html.replace('  <script type="module"', '  ' + block.replace('\n', '\n  ') + '\n  <script type="module"', 1)

index.write_text(html, encoding='utf-8')
print('stamped', v, '| modules:', ', '.join(modules))
