#!/usr/bin/env python3
"""Exercise a detached launcher; optionally drive the real Linux D-Bus tray menu.
Use dbus-run-session -- python scripts/smoke-launcher.py --binary PATH --check-tray.
All owners are mock devices and all state is isolated in a temporary directory.
"""
import argparse,json,os,re,signal,subprocess,tempfile,time
from pathlib import Path
from urllib.request import Request,urlopen

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True,type=Path);parser.add_argument('--check-tray',action='store_true');args=parser.parse_args()
 binary=args.binary.resolve()
 with tempfile.TemporaryDirectory(prefix='serialhub-launcher-') as temporary:
  root=Path(temporary);env=os.environ.copy();env['SERIALHUB_STATE_DIR']=str(root/'state');env['XDG_DATA_HOME']=str(root/'data')
  if args.check_tray:
   import shlex
   browser=root/'browser.sh';browser.write_text('#!/bin/sh\nprintf "%s\\n" "$@" >> '+shlex.quote(str(root/'browser-calls'))+'\n');browser.chmod(0o700);env['BROWSER']=str(browser)
  def command(*options):return subprocess.run([str(binary),*options],env=env,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25,check=True)
  def request(path,body=None):
   data=None if body is None else json.dumps(body).encode()
   with urlopen(Request(base+path,data,{'Content-Type':'application/json'}),timeout=3) as r:return json.load(r)
  def until(check,seconds=8):
   deadline=time.monotonic()+seconds
   while time.monotonic()<deadline:
    result=check()
    if result:return result
    time.sleep(.05)
   raise AssertionError('Timed out waiting for native desktop state')
  bind='127.0.0.1:0';base=None
  try:
   command('desktop','--background','--no-browser','--bind',bind)
   record=json.loads((root/'state/127.0.0.1-0.json').read_text());base='http://'+record['address']
   first=request('/manager/identity')['instance'];assert request('/manager/info')['app']['background']
   command('desktop','--background','--no-browser','--bind',bind)
   assert request('/manager/identity')['instance']==first
   settings={'baud':115200,'databits':8,'parity':'none','stopbits':1,'flow':'none'}
   for suffix in ('a','b'):request('/manager/sessions',{'path':'mock:launcher-'+suffix,'settings':settings})
   assert len(request('/manager/info')['sessions'])==2
   print('PASS detached parent exited; repeated launch reused the same owner; two mock devices are live',flush=True)
   if args.check_tray:
    def names():
     text=subprocess.check_output(['gdbus','call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.ListNames'],text=True,env=env)
     return re.findall(r"'(org\.kde\.StatusNotifierItem[^']*)'",text)
    service=until(lambda:names())[0]
    def bus(*options):return json.loads(subprocess.check_output(['busctl','--user','--json=short','--',*options],text=True,env=env))
    menu=bus('get-property',service,'/StatusNotifierItem','org.kde.StatusNotifierItem','Menu')['data']
    pixmaps=bus('get-property',service,'/StatusNotifierItem','org.kde.StatusNotifierItem','IconPixmap')['data']
    assert pixmaps and pixmaps[0][0:2]==[32,32] and len(pixmaps[0][2])==4096
    def entries():
     layout=bus('call',service,menu,'com.canonical.dbusmenu','GetLayout','iias','0','-1','0')
     result={}
     def walk(value):
      if isinstance(value,list):
       if len(value)==3 and isinstance(value[0],int) and isinstance(value[1],dict) and 'label' in value[1]:result[value[1]['label']['data']]=value[0]
       for child in value:walk(child)
      elif isinstance(value,dict):
       for child in value.values():walk(child)
     walk(layout);return result
    until(lambda:'Quit SerialHub' in entries())
    request('/manager/app/locale',{'locale':'es'})
    current=until(lambda:entries() if 'Salir de SerialHub' in entries() else None)
    def click(item):
     subprocess.run(['busctl','--user','call',service,menu,'com.canonical.dbusmenu','Event','isvu',str(item),'clicked','s','','0'],check=True,env=env,stdout=subprocess.PIPE)
    click(current['Abrir espacio de trabajo'])
    until(lambda:(root/'browser-calls').exists() and base+'/' in (root/'browser-calls').read_text())
    click(current['Salir de SerialHub'])
    print('PASS actual native tray icon, localized D-Bus menu, Open workspace and Quit actions',flush=True)
   else:command('quit','--bind',bind)
   def stopped():
    try:request('/manager/identity');return False
    except OSError:return True
   until(stopped,18)
   command('quit','--bind',bind)
   print('LAUNCHER_SMOKE_OK: background lifetime, singleton, explicit exit and released listener',flush=True)
  finally:
   if base:
    try:command('quit','--bind',bind)
    except Exception:pass
if __name__=='__main__':main()
