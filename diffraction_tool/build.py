#!/usr/bin/env python3
"""Bundle src/ into a single self-contained HTML file: dist/diffraction_annotator.html"""
import os
ROOT = os.path.dirname(os.path.abspath(__file__))
S = lambda f: open(os.path.join(ROOT, 'src', f), encoding='utf-8').read()
core = '\n'.join(S(f) for f in ['tiff.js', 'dm.js', 'ocr_templates.js', 'imageproc.js'])
lib = '\n'.join(S(f) for f in ['crystal.js', 'zip.js', 'library_data.js', 'library_refl.js'])
html = S('index.html')
def put(tag, text):
    global html
    assert tag in html, tag
    html = html.replace(tag, text.replace('</script', '<\\/script'), 1)
put('/*STYLE*/', S('style.css'))
put('/*CORE*/', core)
put('/*WORKER*/', S('worker.js'))
put('/*LIBRARY*/', lib)
put('/*APP*/', S('app.js'))
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'diffraction_annotator.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, round(len(html.encode()) / 1e6, 2), 'MB')
