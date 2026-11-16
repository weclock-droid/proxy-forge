// Screenshots the page so the preview can be eyeballed without opening a browser by hand.
// Usage: node tools/shot.mjs [outDir]   -> writes card.png, ref.png, full.png
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] || join(ROOT, 'shots'));
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const server = createServer(async (req, res) => {
  if (req.url.split('?')[0].startsWith('/proxy-forge.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(await readFile(join(ROOT, 'proxy-forge.html')));
  }
  res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const CARD = {
  object: 'card', id: 'f', name: 'Eager Trufflesnout', mana_cost: '{1}{G}', cmc: 2,
  type_line: 'Creature — Boar', oracle_text: 'Trample\nWhenever this creature deals combat damage to a player, create a Food token.',
  flavor_text: 'The forest keeps its own accounts.', power: '4', toughness: '3',
  colors: ['G'], rarity: 'common', set: 'fdn', set_name: 'Foundations', collector_number: '102', lang: 'en',
  artist: 'Peter Rabjohn',
  image_uris: { art_crop: 'https://art.test/art.jpg' },
};
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.route('**://api.scryfall.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CARD) }));

await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);
await page.evaluate(() => localStorage.setItem('proxyforge.bigPreview', ''));
await page.fill('#lookupName', 'Eager Trufflesnout');
await page.click('#lookupGo');
await page.waitForTimeout(700);

await page.locator('#card').screenshot({ path: join(outDir, 'card-plain.png') });
await page.check('#safeGuides');
await page.check('#guides');
await page.waitForTimeout(400);
await page.locator('#card').screenshot({ path: join(outDir, 'card-safe-guides.png') });
await page.uncheck('#safeGuides');
await page.waitForTimeout(200);

await page.locator('#ref').screenshot({ path: join(outDir, 'reference.png') });
await page.fill('#refQ', 'bleed');
await page.waitForTimeout(400);
await page.locator('#ref').screenshot({ path: join(outDir, 'reference-search.png') });
await page.fill('#refQ', '');
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, 'full.png'), fullPage: true });

console.log('wrote screenshots to', outDir);
await browser.close();
await new Promise(r => server.close(r));
