#!/usr/bin/env python3
"""Check local Markdown links and current package version agreement (no network)."""
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import struct
import subprocess
import sys
import tomllib
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent

class LocalReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in ("src", "href"):
                self.targets.append(value)
            elif value and key == "srcset":
                self.targets.extend(item.strip().split()[0] for item in value.split(",") if item.strip())


def check():
    version = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    lock = tomllib.loads((ROOT / "Cargo.lock").read_text(encoding="utf-8"))
    assert next(p["version"] for p in lock["package"] if p["name"] == "serialhub") == version
    for name in ("web/package.json", "web/package-lock.json"):
        data = json.loads((ROOT / name).read_text(encoding="utf-8"))
        assert data["version"] == version, name
        if "packages" in data:
            assert data["packages"][""]["version"] == version, name
    files = set(subprocess.check_output(["git", "ls-files", "--", "*.md"], cwd=ROOT, text=True).splitlines())
    files.update(("DISPLAY.md", "DOCS.md", "BRAND.md", "INSTALLATION.md", "docs/screenshots/README.md"))
    failures = []
    badge = ROOT / "assets/badges/source.svg"
    if f"source {version}" not in badge.read_text(encoding="utf-8"):
        failures.append("README source badge is stale; run scripts/build-readme-badges.py")
    for name in sorted(files):
        text = (ROOT / name).read_text(encoding="utf-8")
        # Ignore fenced examples; validate ordinary inline Markdown links/images.
        text = re.sub(r"```[\s\S]*?```", "", text)
        html = LocalReferences()
        html.feed(text)
        targets = re.findall(r"!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)", text) + html.targets
        for target in targets:
            target = target.strip("<>").split("#", 1)[0].split("?", 1)[0]
            if not target or re.match(r"^[a-zA-Z][\w+.-]*:", target):
                continue
            target = unquote(target)
            path = ROOT / target.lstrip("/") if target.startswith("/") else ROOT / Path(name).parent / target
            if not path.exists():
                failures.append(f"{name}: missing link target {target}")
    for name in ("README.md", "README.zh-CN.md", "README.es.md", "DOCS.md", "DISPLAY.md", "RELEASE_NOTES.md", "POSITIONING.md"):
        if version not in (ROOT / name).read_text(encoding="utf-8"):
            failures.append(f"{name}: current version {version} missing")
    capture = json.loads((ROOT / "docs/screenshots/capture.json").read_text(encoding="utf-8"))
    if capture["version"] != version:
        failures.append("README screenshot metadata does not match current source version")
    for name in capture["files"]:
        path = ROOT / "docs/screenshots" / name
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", data[16:24]) != (capture["viewport"]["width"], capture["viewport"]["height"]):
            failures.append(f"{path.name}: screenshot format/dimensions disagree with metadata")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"Documentation OK: {len(files)} Markdown files; Markdown/HTML links and screenshot metadata; source/package version {version}")
    return 0

if __name__ == "__main__":
    raise SystemExit(check())
