#!/usr/bin/env python3
"""Verify the extracted desktop executable and its embedded manager without hardware."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"

    def request(path, body=None, method=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None if body is None else json.dumps(body).encode()
        with urlopen(Request(base + path, data, headers, method=method), timeout=3) as response:
            return json.load(response)

    with tempfile.TemporaryDirectory(prefix="serialhub-desktop-smoke-") as directory:
        completed = False
        with (Path(directory) / "desktop.log").open("w+b") as log:
            process = subprocess.Popen([str(binary), "desktop", "--bind", f"127.0.0.1:{port}", "--no-browser"], cwd=directory, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        info = request("/manager/info")
                        if info.get("product") != "serialhub.desktop.v1":
                            raise AssertionError("Unexpected application on manager port")
                        break
                    except (URLError, ConnectionError):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise AssertionError("Desktop manager failed to become ready")
                        time.sleep(0.05)
                with urlopen(base, timeout=3) as response:
                    assert b'<div id="root">' in response.read(), "Missing embedded UI"
                settings = {"baud": 115200, "databits": 8, "parity": "none", "stopbits": 1, "flow": "none"}
                sessions = [request("/manager/sessions", {"path": f"mock:package-{name}", "settings": settings})["id"] for name in ("a", "b")]
                a, b = sessions
                result = request(f"/sessions/{a}/v1/write", {"text": "desktop-package-smoke"})
                assert result["ok"], result
                for _ in range(50):
                    state_a = request(f"/sessions/{a}/v1/status")
                    if state_a["stats"]["rx_bytes"]:
                        break
                    time.sleep(0.02)
                assert state_a["stats"]["rx_bytes"] > 0
                assert request(f"/sessions/{b}/v1/status")["stats"]["rx_bytes"] == 0, "Cross-device RX contamination"
                request(f"/manager/sessions/{a}", method="DELETE")
                assert request(f"/sessions/{b}/v1/status")["port"]["connected"]
                request("/manager/quit", {})
                assert process.wait(timeout=10) == 0, "Desktop did not stop cleanly"
                completed = True
                print("DESKTOP_SMOKE_OK: embedded UI, two owners, isolated RX, independent close, graceful quit")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                if not completed:
                    log.seek(0)
                    print(log.read().decode("utf-8", errors="replace"), file=sys.stderr)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    main()
