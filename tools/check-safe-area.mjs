// Reports how close the text that matters gets to the cut, per layout, in card units.
// The card is 300 units to the inch, so the safety margin (⅛" inside the cut) and the ⅛" bleed are both 37.5 units.
//
// It measures the real drawing calls rather than diffing rendered pixels: every fillText and every
// square drawImage (a mana symbol is an image, not text) is recorded with the transform in force, so
// each string's true box is known. A pixel diff can't do this reliably, because clearing one field
// reflows its neighbours and the difference then includes text that did not move.
//
// The collector and artist line, and the layouts' own chrome (WRIST-COMP, PWR, PNL 12345), are allowed
// nearer the cut than the margin; they are listed separately instead of being counted as failures.
//
// Usage: node tools/check-safe-area.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const server = createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(ROOT, 'proxy-forge.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);

const report = await page.evaluate(async () => {
  const onCard = ctx => ctx.canvas.width === 750 && ctx.canvas.height === 1050;
  const drawn = [];
  let watching = false;
  const note = (ctx, pts, s) => {
    const t = ctx.getTransform();
    const q = pts.map(([x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]);
    drawn.push({
      s, l: Math.min(...q.map(p => p[0])), r: Math.max(...q.map(p => p[0])),
      t: Math.min(...q.map(p => p[1])), b: Math.max(...q.map(p => p[1])),
    });
  };
  const p = CanvasRenderingContext2D.prototype;
  const fillText = p.fillText, drawImage = p.drawImage;
  p.fillText = function (text, x, y, ...rest) {
    if (watching && onCard(this) && String(text).trim()) {
      const m = this.measureText(String(text));
      const fs = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 16])[1]);
      const asc = m.actualBoundingBoxAscent ?? fs * 0.78, dsc = m.actualBoundingBoxDescent ?? fs * 0.22;
      const w = m.width;
      const x0 = this.textAlign === 'center' ? x - w / 2 : (this.textAlign === 'right' || this.textAlign === 'end') ? x - w : x;
      const bl = this.textBaseline;
      const base = bl === 'middle' ? y + (asc - dsc) / 2 : (bl === 'top' || bl === 'hanging') ? y + asc : y;
      note(this, [[x0, base - asc], [x0 + w, base]], String(text));
    }
    return fillText.call(this, text, x, y, ...rest);
  };
  p.drawImage = function (img, x, y, w, h, ...rest) {
    if (watching && onCard(this) && w >= 20 && w <= 70 && Math.abs(w - h) < 0.01) note(this, [[x, y], [x + w, y + h]], '[mana symbol]');
    return drawImage.call(this, img, x, y, w, h, ...rest);
  };

  const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
  const ag = art.getContext('2d'); ag.fillStyle = '#9a9a9a'; ag.fillRect(0, 0, 750, 1050);
  const img = new Image(); img.src = art.toDataURL(); await img.decode();
  const form = {
    name: 'Safe Area Probe', cost: '{2}{B}{B}', type: 'Creature — Vampire Noble', rules: 'Flying, lifelink',
    flavor: '', pt: '3/3', artist: 'A. Painter', info: '001 · PRX · EN', note: 'Playtest card',
    border: 'none', color: 'B', titleFont: 'Spectral', shade: '0.78', size: '31', bleed: false, round: true,
    pipStyle: 'classic', pipColor: '#ffffff', rarity: '', setTint: true, artFx: 'none', wear: 'none',
    misprint: 'none', gloss: false, aiArt: false, aiModel: '', setCode: '', label: 'design', layers: [],
  };
  // Which measured strings are the text that has to survive the cut. Everything else on the card is the
  // collector line or the layout's decorative chrome, and is reported as "allowed".
  const MUST = /^(Safe Area Probe|Creature — Vampire Noble|Flying,|lifelink|3\/3|\[mana symbol\])$/i;
  const out = [];
  try {
    for (const layout of ['fade', 'panel', 'framed', 'console', 'wrist']) {
      drawn.length = 0; watching = true;
      __pf.cardCanvas({ kind: 'made', form: { ...form, layout }, img, zoom: 1, ox: 0, oy: 0 }, 1);
      watching = false;
      for (const d of drawn) {
        out.push({
          layout, s: d.s, must: MUST.test(d.s),
          l: Math.round(d.l), r: Math.round(750 - d.r), t: Math.round(d.t), b: Math.round(1050 - d.b),
          worst: Math.round(Math.min(d.l, 750 - d.r, d.t, 1050 - d.b)),
        });
      }
    }
  } finally { p.fillText = fillText; p.drawImage = drawImage; }
  return { out, safe: __pf.SAFE, bleed: __pf.BLEED };
});

console.log(`safety margin ${report.safe} units (⅛" inside the cut), bleed ${report.bleed} units (⅛")\n`);
console.log('   inset  layout   field                       verdict');
for (const r of report.out.sort((a, b) => a.worst - b.worst)) {
  const verdict = r.must
    ? (r.worst >= report.safe ? 'inside the margin' : '*** OUTSIDE THE MARGIN')
    : (r.worst >= report.safe ? 'inside the margin' : 'allowed nearer the cut');
  console.log(`  ${String(r.worst).padStart(5)}   ${r.layout.padEnd(8)} ${JSON.stringify(r.s.slice(0, 26)).padEnd(28)}${verdict}`);
}
const must = report.out.filter(r => r.must);
const bad = must.filter(r => r.worst < report.safe);
console.log(`\n${must.length} pieces of text that matter; ${bad.length} fall outside the safety margin.`);
if (bad.length) process.exitCode = 1;

await browser.close();
await new Promise(r => server.close(r));
