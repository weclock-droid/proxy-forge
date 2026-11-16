// Opens proxy-forge.html in Chromium exactly like the tests do and prints whatever the page reports.
// Use when a test times out waiting for window.__pf: it means the page's script threw while loading.
// Usage: node tools/debug-load.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'proxy-forge.html');
const server = createServer(async (req, res) => {
  if (req.url.split('?')[0].startsWith('/proxy-forge.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(await readFile(PAGE));
  }
  res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/proxy-forge.html`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message, '\n', (e.stack || '').split('\n').slice(0, 6).join('\n')));
page.on('console', m => console.log(`CONSOLE ${m.type()}:`, m.text()));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){}; window.jspdf={jsPDF:function(){}};' }));
await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
console.log('__pf present:', await page.evaluate(() => !!window.__pf));
console.log('refData:    ', await page.evaluate(() => document.getElementById('refData')?.textContent.length ?? -1), 'chars');
console.log('refCount:   ', await page.textContent('#refCount').catch(() => '(missing)'));
await browser.close();
await new Promise(r => server.close(r));
