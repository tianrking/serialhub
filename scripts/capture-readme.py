#!/usr/bin/env python3
"""Capture README screenshots using only isolated Mock devices. See BRAND.md."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent.parent

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,default=ROOT/'target/debug/serialhub')
    options=parser.parse_args()
    binary=options.binary.resolve()
    with tempfile.TemporaryDirectory(prefix='serialhub-readme-') as temporary:
        env=os.environ.copy()
        env['SERIALHUB_STATE_DIR']=str(Path(temporary)/'state')
        env['XDG_DATA_HOME']=str(Path(temporary)/'data')
        env['XDG_CACHE_HOME']=str(Path(temporary)/'cache')
        started=False
        try:
            subprocess.run([str(binary),'desktop','--background','--no-browser','--bind','127.0.0.1:0'],env=env,check=True,timeout=25)
            started=True
            identity=json.loads((Path(env['SERIALHUB_STATE_DIR'])/'127.0.0.1-0.json').read_text(encoding='utf-8'))
            env['SERIALHUB_CAPTURE_BASE']='http://'+identity['address']
            subprocess.run(['node',str(ROOT/'scripts/capture-readme.cjs')],cwd=ROOT,env=env,check=True,timeout=120)
        finally:
            if started:subprocess.run([str(binary),'quit','--bind','127.0.0.1:0'],env=env,check=True,timeout=25)

if __name__=='__main__':main()
