#!/usr/bin/env python3
"""Exercise native login-service install/start/stop/uninstall on an ephemeral runner."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--allow-login-service', action='store_true')
    args = parser.parse_args()
    assert args.allow_login_service, 'This test changes the current user login service; use an ephemeral CI runner'
    binary = args.binary.resolve()
    env = dict(os.environ)
    env.pop('SERIALHUB_STATE_DIR', None)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        bind = '127.0.0.1:' + str(listener.getsockname()[1])
    base = 'http://' + bind

    def command(*action, check=True):
        return subprocess.run([str(binary), 'service', *action], env=env, check=check, capture_output=True, text=True, timeout=60)

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        with urlopen(Request(base + path, data, {'Content-Type':'application/json'}), timeout=3) as response:
            return json.load(response)

    installed = False
    try:
        result = command('install', '--bind', bind, check=False)
        installed = result.returncode == 0
        assert installed, result.stdout + result.stderr
        assert not request('/manager/info')['app']['tray']
        command('status')
        session = request('/manager/sessions', {'path':'mock:login-service', 'settings':{'baud':115200,'databits':8,'parity':'none','stopbits':1,'flow':'none'}})['id']
        assert request('/sessions/' + session + '/v1/write', {'text':'service-check'})['ok']
        command('logs')
        command('stop')
        deadline = time.monotonic() + 10
        while command('status', check=False).returncode == 0:
            assert time.monotonic() < deadline, 'Service still reported running after stop'
            time.sleep(.1)
        command('start')
        assert request('/manager/info')['sessions'] == [], 'Service restart unexpectedly replayed sessions'
        command('uninstall')
        installed = False
        try:
            request('/manager/identity')
            raise AssertionError('Service listener survived uninstall')
        except OSError:
            pass
        print('LOGIN_SERVICE_SMOKE_OK: native registration, readiness, mock TX, logs/status, stop, restart, uninstall and released listener')
    finally:
        if installed:
            result = command('uninstall', check=False)
            if result.returncode:
                print(result.stdout + result.stderr)


if __name__ == '__main__':
    main()
