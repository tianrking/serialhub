#!/usr/bin/env python3
"""Verify shared RX and leased TX using an isolated mock Hub (stdlib only)."""

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def receive_exact(reader, expected):
    received = bytearray()
    deadline = time.monotonic() + 5
    while len(received) < len(expected):
        remaining = deadline - time.monotonic()
        require(remaining > 0, "RX deadline exceeded")
        reader.settimeout(remaining)
        chunk = reader.recv(len(expected) - len(received))
        require(chunk, "reader disconnected")
        received.extend(chunk)
    require(received == expected, "RX differs, or a rejected write reached the stream")


def run(binary, directory):
    # Reserve both ports together so they differ. Release immediately before launch.
    with socket.socket() as api_socket, socket.socket() as tcp_socket:
        api_socket.bind(("127.0.0.1", 0))
        tcp_socket.bind(("127.0.0.1", 0))
        api_port = api_socket.getsockname()[1]
        tcp_port = tcp_socket.getsockname()[1]
    profile = directory / "mock.toml"
    profile.write_text(f'''[real]
path = "mock:sharing-smoke"
[api]
bind = "127.0.0.1:{api_port}"
[fanout]
tcp_count = 1
tcp_base_port = {tcp_port}
tcp_raw = true
[tx]
mode = "queue_by_line"
write_lock_ms = 10000
[log]
mirror_console = false
''', encoding="utf-8")
    base = f"http://127.0.0.1:{api_port}"
    # These are strictly local test requests; no proxy or remote endpoint is used.
    opener = build_opener(ProxyHandler({}))

    def api(path, body=None, method=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(base + path, data=data, method=method,
                          headers={"Content-Type": "application/json"})
        try:
            response = opener.open(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            return json.load(response)

    with (directory / "hub.log").open("wb") as log:
        process = subprocess.Popen([str(binary), "run", "-c", str(profile)],
                                   cwd=directory, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 10
            while True:
                require(process.poll() is None, "Hub exited during startup")
                try:
                    status = api("/v1/status")
                    if status.get("port", {}).get("connected"):
                        break
                except (URLError, TimeoutError):
                    pass
                require(time.monotonic() < deadline, "Hub startup timed out")
                time.sleep(0.05)
            require(status["port"]["path"] == "mock:sharing-smoke", "expected mock device")
            print("PASS isolated mock Hub connected")

            with socket.create_connection(("127.0.0.1", tcp_port), timeout=5) as a, \
                    socket.create_connection(("127.0.0.1", tcp_port), timeout=5) as b:
                deadline = time.monotonic() + 5
                while len(api("/v1/clients")) < 2:
                    require(time.monotonic() < deadline, "two readers did not register")
                    time.sleep(0.02)
                lock = api("/v1/lock", {"as_client": "engineer"})
                require(lock.get("ok") is True, "lease acquisition failed")
                token = lock["lock"]["lease_token"]
                denied = api("/v1/write", {"text": "MUST-NOT-REACH-DEVICE",
                                           "as_client": "engineer", "newline": True})
                require(denied.get("ok") is False, "write without token was accepted")
                payload = bytes([0, 1, 127, 128, 255, 10])
                sent = api("/v1/write", {"hex": payload.hex(), "as_client": "engineer",
                                         "lease_token": token})
                require(sent.get("ok") is True, "leased write failed")
                receive_exact(a, payload)
                receive_exact(b, payload)
                print("PASS two simultaneous TCP readers received identical binary RX")
                print("PASS owner name alone cannot bypass the TX lease")
                released = api("/v1/lock", {"lease_token": token}, method="DELETE")
                require(released.get("ok") is True, "lease release failed")
                next_payload = b"from-second-program\n"
                b.sendall(next_payload)
                receive_exact(a, next_payload)
                receive_exact(b, next_payload)
                print("PASS TCP writer can send after lease release; both readers receive RX")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if process.returncode:
                print((directory / "hub.log").read_text(encoding="utf-8", errors="replace")[-4000:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path,
                        default=Path("target/release/serialhub.exe" if os.name == "nt"
                                     else "target/release/serialhub"))
    args = parser.parse_args()
    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error(f"binary not found: {binary}; build it first or pass --binary")
    with tempfile.TemporaryDirectory(prefix="serialhub-smoke-") as temporary:
        run(binary, Path(temporary))
    print("SHARING_SMOKE_OK (mock only; no hardware qualification)")


if __name__ == "__main__":
    main()
