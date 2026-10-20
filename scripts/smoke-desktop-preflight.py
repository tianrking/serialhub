#!/usr/bin/env python3
"""Linux package preflight using real OS serial handles over isolated PTYs.

Checks the browser opener callback, repeated launches, exact binary I/O,
device loss, reopening and synchronous quit. Never opens physical hardware.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import errno
import json
import os
from pathlib import Path
import select
import shlex
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen


def until(check, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for device state")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("This OS serial-handle check requires Linux PTYs")
    import pty

    binary = str(args.binary.resolve())
    settings = {"baud": 115200, "databits": 8, "parity": "none", "stopbits": 1, "flow": "none"}
    with tempfile.TemporaryDirectory(prefix="serialhub-real-io-") as directory:
        root = Path(directory)
        env = os.environ.copy()
        # Route the browser opener to our callback instead of opening test pages
        # in a user's desktop. The actual HTTP UI is checked by package/browser tests.
        env.update(SERIALHUB_STATE_DIR=str(root / "state"), XDG_DATA_HOME=str(root / "data"),
                   DISPLAY="", WAYLAND_DISPLAY="", XDG_CURRENT_DESKTOP="", DESKTOP_SESSION="",
                   KDE_FULL_SESSION="", GNOME_DESKTOP_SESSION_ID="")
        browser = root / "browser"
        browser.write_text('#!/bin/sh\nprintf "%s\\n" "$@" >> '
                           + shlex.quote(str(root / "browser-urls")) + "\n", encoding="utf-8")
        browser.chmod(0o700)
        env["BROWSER"] = str(browser)
        base = None
        masters = []
        slaves = []

        def run(*options):
            result = subprocess.run([binary, *options], env=env, capture_output=True,
                                    text=True, timeout=25)
            assert result.returncode == 0, result
            return result

        def request(path, body=None, method=None):
            data = None if body is None else json.dumps(body).encode()
            with urlopen(Request(base + path, data, {"Content-Type": "application/json"},
                                 method=method), timeout=4) as response:
                return json.load(response)

        def new_pty():
            master, slave = pty.openpty()
            masters.append(master)
            # Keep the slave reference until its owner stops. After master loss
            # this pins the PTY index so a reconnect cannot open another user's
            # newly allocated terminal under a recycled /dev/pts name.
            slaves.append(slave)
            device = os.ttyname(slave)
            return master, device

        def open_device(device):
            session = request("/manager/sessions", {"path": device, "settings": settings})["id"]
            status = f"/sessions/{session}/v1/status"
            until(lambda: request(status)["port"]["connected"])
            return session, status

        def probe(device):
            descriptor = os.open(device, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            os.close(descriptor)

        try:
            run("desktop", "--background", "--bind", "127.0.0.1:0")
            registry = root / "state/127.0.0.1-0.json"
            base = "http://" + json.loads(registry.read_text())["address"]
            nonce = request("/manager/identity")["instance"]
            urls = root / "browser-urls"
            until(urls.exists)
            assert urls.read_text().splitlines() == [base + "/"]
            with ThreadPoolExecutor(max_workers=5) as pool:
                list(pool.map(lambda _: run("desktop", "--background", "--bind", "127.0.0.1:0"), range(5)))
            until(lambda: len(urls.read_text().splitlines()) == 6)
            assert set(urls.read_text().splitlines()) == {base + "/"}
            assert request("/manager/identity")["instance"] == nonce
            print("PASS auto-browser URL and five simultaneous launches reuse one owner", flush=True)

            master, device = new_pty()
            session, status = open_device(device)
            other = request("/manager/sessions", {"path": "mock:unaffected", "settings": settings})["id"]
            try:
                probe(device)
                raise AssertionError("Device owner did not take an exclusive OS handle")
            except OSError as error:
                assert error.errno == errno.EBUSY, error
            rx = bytes([0, 1, 2, 10, 13, 127, 128, 254, 255])
            os.write(master, rx)
            until(lambda: request(status)["stats"]["rx_bytes"] == len(rx))
            tx = bytes([255, 0, 10, 13, 128, 85, 170])
            assert request(f"/sessions/{session}/v1/write", {"hex": tx.hex(), "newline": False})["ok"]
            received = b""
            deadline = time.monotonic() + 3
            while len(received) < len(tx) and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    received += os.read(master, 1024)
            assert received == tx, (received, tx)
            assert request(f"/sessions/{other}/v1/status")["stats"]["rx_bytes"] == 0
            print("PASS exclusive OS ownership, exact binary RX/TX and second-owner isolation", flush=True)

            os.close(master)
            masters.remove(master)
            until(lambda: not request(status)["port"]["connected"])
            assert request(f"/sessions/{other}/v1/status")["port"]["connected"]
            print("PASS device loss is reported while the other owner stays connected", flush=True)
            # Stop the lost owner before allowing its PTY index to be reused.
            # USB auto-reconnect acceptance remains a separate hardware check.
            request(f"/manager/sessions/{session}", method="DELETE")
            os.close(slaves.pop())
            master, device = new_pty()
            session, status = open_device(device)
            before = request(status)["stats"]["rx_bytes"]
            os.write(master, rx)
            until(lambda: request(status)["stats"]["rx_bytes"] == before + len(rx))
            assert not select.select([master], [], [], 0.1)[0], "Unexpected output after reopening"
            request(f"/manager/sessions/{session}", method="DELETE")
            probe(device)
            assert request(f"/sessions/{other}/v1/status")["port"]["connected"]
            open_device(device)
            print("PASS reopening resumes RX; closing one device releases it and preserves the other", flush=True)

            run("quit", "--bind", "127.0.0.1:0")
            # No polling here: success must already follow OS handle cleanup.
            probe(device)
            assert not registry.exists(), "Quit returned before worker registry cleanup"
            print("PREFLIGHT_SMOKE_OK: Quit returned after the OS handle and worker registry were released", flush=True)
        except BaseException:
            for log in (root / "state").glob("*.log"):
                print(log.read_text(errors="replace")[-8192:], file=sys.stderr)
            raise
        finally:
            if base:
                try:
                    run("quit", "--bind", "127.0.0.1:0")
                except Exception:
                    pass
            for master in masters:
                os.close(master)
            for slave in slaves:
                os.close(slave)


if __name__ == "__main__":
    main()
