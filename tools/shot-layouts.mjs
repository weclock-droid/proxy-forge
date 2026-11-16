// Renders one card per layout with the safety-margin guide on, so the margin can be checked by eye.
// Usage: node tools/shot-layouts.mjs [outDir]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] || join(ROOT, 'shots'));
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const server = createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(ROOT, 'proxy-forge.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.route('**://api.scryfall.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'error', details: 'offline' }) }));

await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);

const LAYOUTS = [['fade', 'Full art · fade'], ['framed', 'Classic frame'], ['console', 'Starship console'], ['wrist', 'Wrist computer']];
for (const [layout] of LAYOUTS) {
  await page.selectOption('#layout', layout);
  await page.fill('#name', 'Safety Margin Probe');
  await page.fill('#cost', '{2}{B}{B}');
  await page.fill('#type', 'Creature — Vampire Noble');
  await page.fill('#rules', 'Flying, lifelink');
  await page.fill('#pt', '3/3');
  await page.fill('#artist', 'A. Painter');
  await page.fill('#info', '001 · PRX · EN');
  await page.uncheck('#safeGuides');
  await page.waitForTimeout(350);
  await page.locator('#card').screenshot({ path: join(outDir, `layout-${layout}-plain.png`) });
  await page.check('#safeGuides');
  await page.waitForTimeout(350);
  await page.locator('#card').screenshot({ path: join(outDir, `layout-${layout}-safe.png`) });
}
console.log('wrote layout screenshots to', outDir);
await browser.close();
await new Promise(r => server.close(r));
