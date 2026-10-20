#!/usr/bin/env python3
"""Build small, theme-aware README badges without network or font downloads."""
from html import escape
import math
from pathlib import Path
import tomllib
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
COLORS = {
    'neutral': ('f5f7f9', 'd9dfe5', '475569', '64748b', '20262d', '3c4652', 'c9d1d9', '94a3b8'),
    'blue': ('edf4ff', 'cbdcf4', '1d4a7d', '377ac4', '1a2a3f', '304b69', 'a2c6f2', '74a8e9'),
    'mint': ('eaf5f1', 'c8e0d7', '286556', '397a70', '1c302b', '35534b', 'a9d7c9', '91c8be'),
    'rust': ('fff1e7', 'eed3bf', '8c4b25', 'b46b37', '352a22', '634835', 'e9ba95', 'ce986a'),
    'violet': ('f1eefb', 'd9d0ee', '615084', '8270ad', '2d263b', '4c3e65', 'ccbde9', 'a491c8'),
    'rose': ('fceff2', 'edced7', '8c4257', 'b9768b', '38242c', '5d3c4a', 'e6b5c4', 'c98ca0'),
}


def badge(label, family):
    def advance(char):
        if unicodedata.east_asian_width(char) in ('W', 'F'):
            return 12
        if char in 'ilft .,:|·':
            return 3.6
        return 7.5 if char.isupper() else 6.5
    width = math.ceil(sum(advance(c) for c in label)) + 26
    bg, border, text, dot, dark_bg, dark_border, dark_text, dark_dot = COLORS[family]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" '
        f'viewBox="0 0 {width} 20" role="img" aria-label="{escape(label)}">'
        f'<title>{escape(label)}</title><style>'
        f'.bg{{fill:#{bg};stroke:#{border}}}.label{{fill:#{text}}}.dot{{fill:#{dot}}}'
        f'@media(prefers-color-scheme:dark){{.bg{{fill:#{dark_bg};stroke:#{dark_border}}}'
        f'.label{{fill:#{dark_text}}}.dot{{fill:#{dark_dot}}}'
        '}</style>'
        f'<rect class="bg" x=".5" y=".5" width="{width-1}" height="19" rx="4"/>'
        '<circle class="dot" cx="9" cy="10" r="2"/>'
        '<text class="label" x="17" y="13.5" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,Noto Sans,sans-serif" '
        f'font-size="11" font-weight="500">{escape(label)}</text></svg>\n')


def main():
    version = tomllib.loads((ROOT / 'Cargo.toml').read_text())['package']['version']
    badges = {
        'source': ('source ' + version, 'mint'), 'license': ('MIT', 'neutral'),
        'platforms': ('Windows · macOS · Linux', 'neutral'),
        'rust': ('Rust 2021', 'rust'), 'typescript': ('TypeScript', 'blue'),
        'react': ('React', 'mint'), 'tokio': ('Tokio', 'violet'),
        'axum': ('Axum', 'violet'), 'serial': ('UART / COM / tty', 'mint'),
        'api': ('HTTP + WebSocket', 'blue'), 'tcp': ('TCP', 'blue'),
        'pty': ('PTY', 'mint'), 'toml': ('TOML', 'neutral'),
        'english': ('English', 'blue'), 'chinese': ('简体中文', 'rose'),
        'spanish': ('Español', 'mint'),
    }
    output = ROOT / 'assets/badges'
    output.mkdir(parents=True, exist_ok=True)
    for name, (label, family) in badges.items():
        (output / (name + '.svg')).write_text(badge(label, family), encoding='utf-8')
    print('README_BADGES_BUILT', len(badges), version)


if __name__ == '__main__':
    main()
