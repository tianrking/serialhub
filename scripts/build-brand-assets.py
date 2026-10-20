#!/usr/bin/env python3
"""Build original SerialHub vector artwork and native icons. See BRAND.md."""
import argparse
from html import escape
import io
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets/brand"
COLOR = "#91c8be"
MARK = '<path d="M5 16h7m7-4 6-6h3m-8 10h8m-9 4 6 6h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/><path fill="currentColor" fill-rule="evenodd" d="M12 12h8v8h-8zm2 2v4h4v-4z"/><path fill="currentColor" d="M1 14h4v4H1zm26-10h4v4h-4zm0 10h4v4h-4zm0 10h4v4h-4z"/>'

def svg(body, width, height, title="SerialHub"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">{body}</svg>\n'

def text_paths(text, x, baseline, size, font, color, tracking=0):
    from fontTools.pens.svgPathPen import SVGPathPen
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    parts = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            parts.append(f'<path transform="translate({x:.3f} {baseline}) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}" fill="{color}"/>')
        x += font["hmtx"].metrics[name][0] * scale + tracking
    return ''.join(parts)

def build_vectors(font_dir):
    BRAND.mkdir(parents=True, exist_ok=True)
    (BRAND / 'serialhub-symbol.svg').write_text(svg(f'<g color="{COLOR}">{MARK}</g>',32,32))
    app = svg(f'<rect x="1" y="1" width="62" height="62" rx="13" fill="#1d2228" stroke="#3a424d" stroke-width="2"/><g transform="translate(8 8) scale(1.5)" color="{COLOR}">{MARK}</g>',64,64)
    (BRAND / 'serialhub-app.svg').write_text(app)
    (ROOT / 'web/public/favicon.svg').write_text(app)
    (BRAND / 'serialhub-tray.svg').write_text(svg(f'<rect x=".5" y=".5" width="31" height="31" rx="6" fill="#1d2228" stroke="#3a424d"/><g transform="translate(2 2) scale(.875)" color="{COLOR}">{MARK}</g>',32,32))
    (BRAND / 'serialhub-tray-template.svg').write_text(svg(f'<g color="#000000">{MARK}</g>',32,32))
    build_readme_logo(font_dir)
    # The React symbol uses the same geometry as the standalone vector source.
    (ROOT/'web/src/BrandMark.tsx').write_text('''/** SerialHub fan-out symbol. Geometry source: scripts/build-brand-assets.py. */
export default function BrandMark({ size = 24 }: { size?: number }) {
  return <svg className="brand-symbol" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M5 16h7m7-4 6-6h3m-8 10h8m-9 4 6 6h3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    <path fill="currentColor" fillRule="evenodd" d="M12 12h8v8h-8zm2 2v4h4v-4z" />
    <path fill="currentColor" d="M1 14h4v4H1zm26-10h4v4h-4zm0 10h4v4h-4zm0 10h4v4h-4z" />
  </svg>;
}
''')

def build_readme_logo(font_dir):
    """A transparent standalone mark and wordmark; no banner or feature labels."""
    from fontTools.ttLib import TTFont
    bold = TTFont(font_dir / 'DejaVuSans-Bold.ttf')
    size, tracking = 44, -1.0
    cmap = bold.getBestCmap()
    width = sum(bold['hmtx'].metrics[cmap[ord(c)]][0] * size / bold['head'].unitsPerEm
                for c in 'SerialHub') + tracking * (len('SerialHub') - 1)
    BRAND.mkdir(parents=True, exist_ok=True)
    for mode, ink, accent in [('dark', '#e6edf3', COLOR), ('light', '#1d262c', '#397a70')]:
        body = f'<g transform="translate(162 16) scale(3)" color="{accent}">{MARK}</g>'
        body += text_paths('SerialHub', (420 - width) / 2, 177, size, bold, ink, tracking)
        (BRAND / f'serialhub-lockup-{mode}.svg').write_text(svg(body, 420, 200))


def build_native():
    from PIL import Image
    subprocess.run(['node', str(ROOT/'scripts/render-brand-assets.cjs')], cwd=ROOT, check=True)
    def png(size): return (BRAND/f'icon-{size}.png').read_bytes()
    sizes=[16,24,32,48,64,128,256]
    payloads=[png(size) for size in sizes]
    offset=6+16*len(sizes)
    directory=[]
    for size, data in zip(sizes,payloads):
        directory.append(struct.pack('<BBBBHHII',size % 256,size % 256,0,0,1,32,len(data),offset));offset+=len(data)
    (ROOT/'assets/serialhub.ico').write_bytes(struct.pack('<HHH',0,1,len(sizes))+b''.join(directory)+b''.join(payloads))
    chunks=[]
    for tag,size in [(b'ic07',128),(b'ic08',256),(b'ic09',512),(b'ic10',1024)]:
        data=png(size);chunks.append(tag+struct.pack('>I',len(data)+8)+data)
    data=b''.join(chunks);(ROOT/'assets/serialhub.icns').write_bytes(b'icns'+struct.pack('>I',len(data)+8)+data)
    (ROOT/'assets/serialhub.png').write_bytes(png(256))
    for name in ['serialhub-tray','serialhub-tray-template']:
        with Image.open(io.BytesIO((BRAND/f'{name}.png').read_bytes())) as bitmap:
            assert bitmap.size==(32,32)
            (BRAND/f'{name}.rgba').write_bytes(bitmap.convert('RGBA').tobytes())
    for size in [16,24,32,48,64,128,256,512,1024]: (BRAND/f'icon-{size}.png').unlink()
    print('BRAND_ASSETS_OK: SVG, PNG, ICO, ICNS, RGBA tray assets')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font-dir',type=Path,default=Path('/usr/share/fonts/truetype/dejavu'))
    parser.add_argument('--raster',action='store_true')
    parser.add_argument('--readme-only', action='store_true', help='Only regenerate the standalone README logos')
    options=parser.parse_args()
    if options.readme_only:
        if options.raster:
            parser.error('--readme-only cannot be combined with --raster')
        build_readme_logo(options.font_dir)
    else:
        build_vectors(options.font_dir)
        if options.raster:build_native()
