#!/usr/bin/env python3
"""Exercise an installed command: no display, fixed port, HTTP+WS, graceful stop."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    address = f'127.0.0.1:{port}'
    base = 'http://' + address

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        with urlopen(Request(base + path, data, {'Content-Type': 'application/json'}), timeout=3) as r:
            return json.load(r)

    with tempfile.TemporaryDirectory(prefix='serialhub-headless-') as temp:
        env = dict(os.environ, SERIALHUB_STATE_DIR=str(Path(temp) / 'state'))
        for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS'):
            env.pop(key, None)
        with (Path(temp) / 'service.log').open('w+b') as log:
            child = subprocess.Popen([binary, 'serve', '--bind', address], env=env, stdout=log, stderr=log)
            streams = []
            try:
                deadline = time.monotonic() + 15
                while True:
                    try:
                        info = request('/manager/info')
                        assert info['product'] == 'serialhub.desktop.v1'
                        assert not info['app']['tray'] and not info['app']['background']
                        break
                    except (URLError, OSError):
                        assert child.poll() is None and time.monotonic() < deadline, 'Headless startup failed'
                        time.sleep(.05)
                with urlopen(base, timeout=3) as r:
                    assert b'<div id="root">' in r.read()
                duplicate = subprocess.run([binary, 'serve', '--bind', address], env=env, capture_output=True, timeout=10)
                assert duplicate.returncode != 0, 'A fixed-port duplicate must fail'
                preview = subprocess.run([binary, 'service', 'install', '--dry-run', '--bind', address], env=env, capture_output=True, timeout=10)
                assert preview.returncode == 0 and b'serve' in preview.stdout
                settings = {'baud':115200, 'databits':8, 'parity':'none', 'stopbits':1, 'flow':'none'}
                a, b = [request('/manager/sessions', {'path':'mock:headless-' + name, 'settings':settings})['id'] for name in ('a', 'b')]
                # Two actual WebSocket readers of the same owner. No external SDK.
                for _ in range(2):
                    stream = socket.create_connection(('127.0.0.1', port), timeout=5)
                    streams.append(stream)
                    key = base64.b64encode(os.urandom(16)).decode()
                    stream.sendall((f'GET /sessions/{a}/v1/stream?live=true HTTP/1.1\r\nHost: {address}\r\nOrigin: {base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
                    response = b''
                    while not response.endswith(b'\r\n\r\n'):
                        response += stream.recv(1)
                    assert response.startswith(b'HTTP/1.1 101'), response
                    accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
                    assert accept in response
                payload = b'headless\x00\xff\r\n'
                assert request(f'/sessions/{a}/v1/write', {'hex':payload.hex()})['ok']

                def read_exact(stream, count):
                    data = b''
                    while len(data) < count:
                        chunk = stream.recv(count - len(data))
                        assert chunk, 'WebSocket closed before RX'
                        data += chunk
                    return data

                for stream in streams:
                    while True:
                        first, second = read_exact(stream, 2)
                        count = second & 127
                        if count == 126:
                            count = struct.unpack('!H', read_exact(stream, 2))[0]
                        elif count == 127:
                            count = struct.unpack('!Q', read_exact(stream, 8))[0]
                        data = read_exact(stream, count)
                        if first & 15 == 2:
                            assert data == payload, data
                            break
                assert request(f'/sessions/{b}/v1/status')['stats']['rx_bytes'] == 0
                # Stop with subscribers still connected, as happens when a user
                # quits from a live browser workspace. They must not hold exit open.
                stopped = subprocess.run([binary, 'stop', '--bind', address], env=env, capture_output=True, timeout=25)
                assert stopped.returncode == 0, stopped.stderr
                assert child.wait(timeout=10) == 0
                for stream in streams:
                    stream.close()
                streams.clear()
                assert not list((Path(temp) / 'state').glob('*.json')), 'Stale discovery after stop'
                with socket.socket() as listener:
                    listener.settimeout(2)
                    assert listener.connect_ex(('127.0.0.1', port)) != 0, 'Listener is still accepting connections'
                with socket.socket() as listener:
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    listener.bind(('127.0.0.1', port))
                started = subprocess.run([binary, 'start', '--no-browser', '--bind', address], env=env, capture_output=True, timeout=25)
                assert started.returncode == 0, started.stderr
                assert request('/manager/info')['app']['background'] is True
                subprocess.run([binary, 'stop', '--bind', address], env=env, check=True, capture_output=True, timeout=25)
                print('HEADLESS_SMOKE_OK: installed command, no display/tray, fixed port, two WS readers + HTTP binary TX, owner isolation, stop and discovery/listener cleanup')
            finally:
                for stream in streams:
                    stream.close()
                if child.poll() is None:
                    try:
                        request('/manager/quit', {})
                        child.wait(timeout=10)
                    except (OSError, subprocess.TimeoutExpired):
                        child.kill()
                        child.wait(timeout=5)
                # A failure in the detached-start check must not leak its owner.
                subprocess.run([binary, 'stop', '--bind', address], env=env, capture_output=True, timeout=25)
                if child.returncode != 0:
                    log.seek(0)
                    print(log.read().decode(errors='replace'))


if __name__ == '__main__':
    main()
