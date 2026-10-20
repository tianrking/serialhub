// Rasterize the original vector master; no runtime image/font dependencies.
const { chromium } = require('../web/node_modules/playwright');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'assets/brand');
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {});
  try {
    const page = await browser.newPage();
    const app = await readFile(path.join(directory, 'serialhub-app.svg'), 'utf8');
    for (const size of [16,24,32,48,64,128,256,512,1024]) {
      await page.setViewportSize({width:size,height:size});
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${app}`);
      await page.screenshot({path:path.join(directory, `icon-${size}.png`),omitBackground:true});
    }
    for (const name of ['serialhub-tray','serialhub-tray-template']) {
      await page.setViewportSize({width:32,height:32});
      await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${await readFile(path.join(directory,`${name}.svg`),'utf8')}`);
      await page.screenshot({path:path.join(directory,`${name}.png`),omitBackground:true});
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
