#!/usr/bin/env python3
"""Retain command output and expose actionable failures in Actions annotations."""
import argparse
from collections import deque
import os
from pathlib import Path
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--log", type=Path, required=True)
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ["--"] else args.command
tail = deque(maxlen=55)
with args.log.open("w", encoding="utf-8") as output:
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace")
    for line in child.stdout:
        print(line, end="", flush=True)
        output.write(line)
        tail.append(line)
    result = child.wait()
if result and os.environ.get("GITHUB_ACTIONS") == "true":
    detail = "".join(tail)
    escaped = detail.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title=Check failed::{escaped}", flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write("## Check failed\n\n<pre>" + detail.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + "</pre>\n")
sys.exit(result)
