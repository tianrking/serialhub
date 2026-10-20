#!/usr/bin/env python3
"""Check local Markdown links and current package version agreement (no network)."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent

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
    files.update(("DISPLAY.md", "DOCS.md"))
    failures = []
    for name in sorted(files):
        text = (ROOT / name).read_text(encoding="utf-8")
        # Ignore fenced examples; validate ordinary inline Markdown links/images.
        text = re.sub(r"```[\s\S]*?```", "", text)
        for target in re.findall(r"!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)", text):
            target = target.strip("<>").split("#", 1)[0].split("?", 1)[0]
            if not target or re.match(r"^[a-zA-Z][\w+.-]*:", target):
                continue
            path = ROOT / target.lstrip("/") if target.startswith("/") else ROOT / Path(name).parent / target
            if not path.exists():
                failures.append(f"{name}: missing link target {target}")
    for name in ("README.md", "README.zh-CN.md", "README.es.md", "DOCS.md", "DISPLAY.md", "RELEASE_NOTES.md", "POSITIONING.md"):
        if version not in (ROOT / name).read_text(encoding="utf-8"):
            failures.append(f"{name}: current version {version} missing")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"Documentation OK: {len(files)} Markdown files; local links; source/package version {version}")
    return 0

if __name__ == "__main__":
    raise SystemExit(check())
