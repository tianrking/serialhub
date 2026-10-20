// Capture unretouched UI images from an isolated, real Mock manager.
const { chromium } = require('../web/node_modules/playwright');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERIALHUB_CAPTURE_BASE;
if (!base) throw Error('Run via scripts/capture-readme.py');
(async () => {
  const output = path.resolve(__dirname, '../docs/screenshots');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {});
  const context = await browser.newContext({ viewport: {width:1440,height:900}, locale:'en-US', colorScheme:'dark' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('serialhub.ui.locale.v1','en');
    localStorage.setItem('serialhub.ui.display.v1',JSON.stringify({uiScale:110,logSize:14}));
  });
  try {
    const settings = {baud:115200,databits:8,parity:'none',stopbits:1,flow:'none'};
    const names = ['Gateway','Sensor','Motor','GNSS'];
    const devices = [];
    for (const name of names) {
      const response = await page.request.post(`${base}/manager/sessions`,{data:{path:`mock:readme-${name.toLowerCase()}`,name,settings}});
      assert(response.ok()); devices.push(await response.json());
    }
    await page.goto(base);
    const version = (await(await page.request.get(`${base}/manager/identity`)).json()).version;
    assert.equal(version,require('../web/package.json').version);
    await page.getByRole('tab',{name:'Multi-port workspace',exact:true}).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.port-state')].filter(node => node.textContent==='Receiving').length===4);
    for (let sequence=184;sequence<196;sequence++) {
      const messages = [
        `[DEMO] gateway seq=${sequence} frame=01 03 00 20 crc=OK`,
        `[DEMO] sensor seq=${sequence} temp=24.56C pressure=101.3kPa`,
        `[DEMO] motor seq=${sequence} rpm=1489 current=0.42A mode=IDLE`,
        `[DEMO] gnss seq=${sequence} fix=3D sats=12 hdop=0.8`,
      ];
      for (let index=0;index<devices.length;index++) {
        const response = await page.request.post(`${base}/sessions/${devices[index].id}/v1/write`,{data:{text:messages[index],newline:true}});
        assert((await response.json()).ok);
      }
      await page.waitForTimeout(75); // Let the real Mock RX owner produce distinct packets.
    }
    for (const panel of await page.locator('.port-panel:visible').all()) await expectPayload(panel, 'seq=195');
    await page.locator('.port-panel').first().locator('textarea').fill('status --verbose');
    await page.screenshot({path:path.join(output,'multi-port.png')});
    await page.locator('.port-panel').first().getByRole('button',{name:'Open full workspace',exact:true}).click();
    const workspace = page.locator('.managed-workspace:visible');
    await workspace.locator('.lamp').filter({hasText:'HTTP + WS'}).waitFor();
    await workspace.getByLabel('Display',{exact:true}).selectOption('text');
    await workspace.getByRole('button',{name:'Clear',exact:true}).click();
    for (const text of ['[DEMO] firmware ready; protocol v1','[DEMO] transport opened at 115200 baud','[DEMO] monitoring 4 independent device owners','[DEMO] frame seq=196 len=16 crc=OK','[DEMO] frame seq=197 len=16 crc=OK','[DEMO] frame seq=198 len=16 crc=OK']) {
      const response = await page.request.post(`${base}/sessions/${devices[0].id}/v1/write`,{data:{text,newline:true}});
      assert((await response.json()).ok);await page.waitForTimeout(90);
    }
    await workspace.locator('.composer-panel textarea').first().fill('status --verbose');
    await workspace.getByRole('button',{name:'Send text',exact:true}).click();
    await workspace.locator('.line.rx').filter({hasText:'status --verbose'}).waitFor();
    await page.screenshot({path:path.join(output,'console.png')});
    await workspace.getByRole('navigation').getByRole('button',{name:'Signal studio',exact:true}).click();
    await workspace.getByLabel('Signal parser protocol',{exact:true}).selectOption('firewater');
    await workspace.getByLabel('Device sample rate',{exact:true}).fill('1024');
    const text = Array.from({length:2048},(_,index)=>`demo:${Math.sin(2*Math.PI*64*index/1024).toFixed(5)},${Math.cos(2*Math.PI*64*index/1024).toFixed(5)},${(24.5+.2*Math.sin(index/80)).toFixed(3)}\n`).join('');
    const response = await page.request.post(`${base}/sessions/${devices[0].id}/v1/write`,{data:{text,newline:false}});assert((await response.json()).ok);
    await workspace.getByTestId('spectrum-peak').filter({hasText:'64 Hz'}).waitFor();
    await page.screenshot({path:path.join(output,'signal-studio.png')});
    await workspace.locator('.workspace-device-switch select').selectOption('');
    await page.locator('.manager-session').first().waitFor();
    await page.screenshot({path:path.join(output,'devices.png')});
    assert.deepEqual(errors,[]);
    await writeFile(path.join(output,'capture.json'),JSON.stringify({version,viewport:{width:1440,height:900},uiScale:110,logSize:14,locale:'en',source:'Four real backend Mock loopback owners; synthetic [DEMO] payloads; no physical hardware',retouched:false,files:['multi-port.png','console.png','signal-studio.png','devices.png']},null,2)+'\n');
    console.log(`README_CAPTURE_OK ${version}: four Mock owners, acknowledged HTTP writes / real WS RX, 64 Hz spectrum, no page exceptions`);
  } finally { await context.close();await browser.close(); }
})();
async function expectPayload(panel,text) { await panel.locator('.port-entry.rx').filter({hasText:text}).first().waitFor(); }
