// Drives the "Fill in" lookup and prints what the page is doing, for when a test hangs waiting on it.
// Usage: node tools/debug-lookup.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  if (req.url.split('?')[0].startsWith('/proxy-forge.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(await readFile(join(ROOT, 'proxy-forge.html')));
  }
  res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const CARD = {
  object: 'card', id: 'fake-1', name: 'Test Golem', mana_cost: '{3}{G}', cmc: 4,
  type_line: 'Artifact Creature — Golem', oracle_text: 'Trample', flavor_text: 'It walks.',
  power: '4', toughness: '4', colors: ['G'], rarity: 'rare', set: 'tst', set_name: 'Test Set',
  collector_number: '42', lang: 'en', artist: 'A. Painter',
  image_uris: { art_crop: 'https://scryfall.test/art.jpg', normal: 'https://scryfall.test/card.jpg' },
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message, '\n ', (e.stack || '').split('\n').slice(0, 4).join('\n ')));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE error:', m.text()); });
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){}; window.jspdf={jsPDF:function(){}};' }));
await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('**://api.scryfall.com/**', r => {
  const url = r.request().url();
  console.log('  scryfall <-', url.replace('https://api.scryfall.com', ''));
  const json = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/cards/named')) return json(CARD);
  if (url.includes('/cards/autocomplete')) return json({ object: 'catalog', data: ['Test Golem'] });
  if (url.includes('/cards/search')) return json({ object: 'list', total_cards: 1, has_more: false, data: [CARD] });
  if (url.includes('/cards/random')) return json(CARD);
  if (url.includes('/sets/')) return json({ object: 'set', icon_svg_uri: 'https://scryfall.test/set.svg' });
  return json({ object: 'list', data: [CARD], not_found: [] });
});
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));

await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);
await page.waitForTimeout(800);

console.log('\n-- lookup: click, no typing --');
await page.fill('#lookupName', 'Test Golem');
await page.click('#lookupGo');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(500);
  console.log(`  t=${(i + 1) * 0.5}s status=${JSON.stringify(await page.textContent('#status'))} name=${JSON.stringify(await page.inputValue('#name'))} more=${await page.isVisible('#lookupMore')}`);
  if ((await page.inputValue('#name')) === 'Test Golem') break;
}
console.log('\n-- reference: search --');
await page.fill('#refQ', 'zzzznotarealthing');
await page.waitForTimeout(500);
console.log('  refCount:', JSON.stringify(await page.textContent('#refCount')));
console.log('  list:    ', JSON.stringify((await page.textContent('#refList')).slice(0, 160)));
await browser.close();
await new Promise(r => server.close(r));
