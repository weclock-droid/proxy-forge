// Measures where each Look style draws its mana pips and text rows, and writes a crop of the card to look at.
// Usage: node tools/scratch-stylestrip.mjs [outDir] [styleId ...]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] || join(ROOT, 'shots', 'styles'));
const IDS = process.argv.slice(3).length ? process.argv.slice(3)
  : ['retroposter', 'album', 'altered', 'linocut', 'bronze', 'scales', 'handdrawn', 'desktop'];
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const server = createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(ROOT, 'proxy-forge.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(outDir, { recursive: true });

const CARD = {
  object: 'card', id: 'f', name: 'Eager Trufflesnout', mana_cost: '{1}{G}{G}', cmc: 3,
  type_line: 'Legendary Creature — Sliver', oracle_text: 'Trample\nWhenever this creature deals combat damage to a player, create a Food token.',
  flavor_text: 'The forest keeps its own accounts.', power: '4', toughness: '3',
  colors: ['G'], rarity: 'rare', set: 'fdn', set_name: 'Foundations', collector_number: '102', lang: 'en',
  artist: 'Peter Rabjohn', image_uris: { art_crop: 'https://art.test/art.jpg' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.route('**://api.scryfall.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CARD) }));

await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);
await page.fill('#lookupName', 'Eager Trufflesnout');
await page.click('#lookupGo');
await page.waitForTimeout(900);

await page.evaluate(() => {
  // Tapping the prototypes the way the safety-margin suites do. `draw()` is not exported, so a redraw is
  // forced by firing the same `input` event the text fields listen for.
  window.__probe = async id => {
    const btn = document.querySelector(`#styles button[data-style="${id}"]`);
    if (!btn) return { id, missing: true };
    btn.click();
    await new Promise(r => setTimeout(r, 800));
    const c = document.getElementById('card');
    const s = c.width / 750;
    const rows = [], pips = [];
    const p = CanvasRenderingContext2D.prototype;
    const fillText = p.fillText, drawImage = p.drawImage;
    const box = (ctx, pts, kind, label) => {
      const t = ctx.getTransform();
      const q = pts.map(([x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]);
      const xs = q.map(v => v[0] / s), ys = q.map(v => v[1] / s);
      (kind === 'pip' ? pips : rows).push({
        label, w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)),
        l: Math.round(Math.min(...xs)), t: Math.round(Math.min(...ys)),
        r: Math.round(Math.max(...xs)), b: Math.round(Math.max(...ys)),
      });
    };
    p.fillText = function (text, x, y, ...rest) {
      if (this.canvas === c && String(text).trim()) {
        const m = this.measureText(String(text));
        const fs = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 16])[1]);
        const asc = m.actualBoundingBoxAscent ?? fs * 0.78, dsc = m.actualBoundingBoxDescent ?? fs * 0.22;
        const w = m.width;
        const x0 = this.textAlign === 'center' ? x - w / 2 : (this.textAlign === 'right' || this.textAlign === 'end') ? x - w : x;
        const bl = this.textBaseline;
        const base = bl === 'middle' ? y + (asc - dsc) / 2 : (bl === 'top' || bl === 'hanging') ? y + asc : y;
        box(this, [[x0, base - asc], [x0 + w, base]], 'text', String(text).slice(0, 34));
      }
      return fillText.call(this, text, x, y, ...rest);
    };
    p.drawImage = function (img, x, y, w, h, ...rest) {
      if (this.canvas === c && w >= 6 && w <= 200 && Math.abs(w - h) < 0.01) box(this, [[x, y], [x + w, y + h]], 'pip', '[pip]');
      return drawImage.call(this, img, x, y, w, h, ...rest);
    };
    const f = document.getElementById('name');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    p.fillText = fillText; p.drawImage = drawImage;
    return { id, safe: window.__pf.SAFE, pips, rows };
  };
});

for (const id of IDS) {
  const r = await page.evaluate(id => window.__probe(id), id);
  console.log(`\n=== ${id} (safe=${r.safe}) ===`);
  if (r.missing) { console.log('  no such style'); continue; }
  const ps = r.pips;
  if (ps.length) { console.log(`  pips: ${ps.length}`); for (const p of ps) console.log(`    ${String(p.w).padStart(4)}x${String(p.h).padStart(3)} L${String(p.l).padStart(4)} T${String(p.t).padStart(4)} R${String(p.r).padStart(4)} B${String(p.b).padStart(4)}`); }
  else console.log('  pips: none drawn as images');
  for (const row of r.rows) console.log(`  ${String(row.w).padStart(4)}x${String(row.h).padStart(3)} L${String(row.l).padStart(4)} T${String(row.t).padStart(4)} R${String(row.r).padStart(4)} B${String(row.b).padStart(4)}  ${row.label}`);
  await page.locator('#card').screenshot({ path: join(outDir, `${id}.png`) });
}

await browser.close();
await new Promise(r => server.close(r));
console.log('\nwrote', outDir);
