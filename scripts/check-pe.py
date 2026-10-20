#!/usr/bin/env python3
"""Inspect real PE imports without Visual Studio tools or executing the binary."""
import argparse
from pathlib import Path
import struct


def imports(data):
    assert data[:2] == b'MZ'
    pe = struct.unpack_from('<I', data, 60)[0]
    assert data[pe:pe + 4] == b'PE\0\0'
    optional = pe + 24
    assert struct.unpack_from('<H', data, optional)[0] == 0x20b, 'Expected PE32+'
    count = struct.unpack_from('<H', data, pe + 6)[0]
    section_start = optional + struct.unpack_from('<H', data, pe + 20)[0]
    def offset(rva):
        for index in range(count):
            start = section_start + 40 * index
            size, address, raw_size, raw = struct.unpack_from('<IIII', data, start + 8)
            if address <= rva < address + max(size, raw_size):
                result = raw + rva - address
                assert result < len(data)
                return result
        raise ValueError(f'Unmapped PE RVA {rva}')
    rva = struct.unpack_from('<I', data, optional + 120)[0]
    if not rva:
        return []
    start = offset(rva)
    names = []
    for _ in range(256):
        fields = struct.unpack_from('<IIIII', data, start)
        if not any(fields):
            return names
        name = offset(fields[3])
        end = data.index(b'\0', name, name + 256)
        names.append(data[name:end].decode('ascii').lower())
        start += 20
    raise ValueError('PE import descriptor limit exceeded')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary-dir', required=True, type=Path)
    args = parser.parse_args()
    for name in ('serialhub.exe', 'serialhub-desktop.exe', 'ohmyserial.exe'):
        libraries = imports((args.binary_dir / name).read_bytes())
        assert libraries, 'Expected native OS imports'
        forbidden = [lib for lib in libraries if lib != 'msvcp_win.dll' and lib.startswith(('vcruntime', 'msvcp', 'libgcc_', 'libstdc++', 'libwinpthread'))]
        assert not forbidden, f'{name} requires separately installed runtime DLLs: {forbidden}'
        print('PORTABLE_PE_IMPORTS_OK', name, len(libraries), 'system imports; no VC++/MinGW runtime DLL')


if __name__ == '__main__':
    main()
