// Renders one Look style and writes a magnified crop, so small details can be judged by eye.
// Usage: node tools/scratch-crop.mjs <styleId> <l> <t> <r> <b> [out.png] [zoom]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [id, l, t, r, b] = process.argv.slice(2, 7);
const out = resolve(process.argv[7] || join(ROOT, 'shots', 'styles', `${id}-crop.png`));
const zoom = +(process.argv[8] || 2);
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const server = createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(ROOT, 'proxy-forge.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(dirname(out), { recursive: true });

const CARD = {
  object: 'card', id: 'f', name: 'Eager Trufflesnout', mana_cost: '{1}{G}{G}', cmc: 3,
  type_line: 'Legendary Creature — Sliver', oracle_text: 'Trample\nWhenever this creature deals combat damage to a player, create a Food token.',
  flavor_text: 'The forest keeps its own accounts.', power: '4', toughness: '3',
  colors: ['G'], rarity: 'rare', set: 'fdn', set_name: 'Foundations', collector_number: '102', lang: 'en',
  artist: 'Peter Rabjohn', image_uris: { art_crop: 'https://art.test/art.jpg' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.route('**://**', rq => (new URL(rq.request().url()).hostname === '127.0.0.1' ? rq.continue() : rq.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', rq => rq.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.route('**://api.scryfall.com/**', rq => rq.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CARD) }));

await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);
await page.fill('#lookupName', 'Eager Trufflesnout');
await page.click('#lookupGo');
await page.waitForTimeout(900);

const b64 = await page.evaluate(async ([id, l, t, r, b, zoom]) => {
  document.querySelector(`#styles button[data-style="${id}"]`).click();
  await new Promise(res => setTimeout(res, 800));
  const src = document.getElementById('card');
  const s = src.width / 750;
  const c = document.createElement('canvas');
  c.width = Math.round((r - l) * s * zoom); c.height = Math.round((b - t) * s * zoom);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, l * s, t * s, (r - l) * s, (b - t) * s, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
}, [id, +l, +t, +r, +b, zoom]);

await writeFile(out, Buffer.from(b64, 'base64'));
await browser.close();
await new Promise(res => server.close(res));
console.log('wrote', out);
