// Interaction tests for proxy-forge.html, run with `npm test`.
//
// Built-in node:test drives a real Chromium through Playwright. The page is loaded from a local HTTP
// server (file:// blocks IndexedDB and relative loads). Two things are stubbed before every run so the
// tests are deterministic and work offline:
//   - jspdf and jszip, which the page normally pulls from cdnjs
//   - the Google Fonts stylesheet (the family list and document.fonts still work, nothing downloads)
// Scryfall and the art sources are served from a small fake, so no test reaches the network.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'proxy-forge.html');

let server, browser, base;

before(async () => {
  server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/' || path === '/proxy-forge.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(PAGE));
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/proxy-forge.html`;
  browser = await chromium.launch({ headless: !process.env.PWHEADED });
});

after(async () => {
  await browser?.close();
  await new Promise(r => server.close(r));
});

// Polls a condition in Node (not in the page) until it holds. Route handlers record requests on the
// Node side, so a value read straight after a click can be a moment behind the request being made.
async function until(fn, ms = 5000) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > ms) return false;
    await new Promise(r => setTimeout(r, 25));
  }
}

// A Scryfall-shaped card, plus a search result, for the fake API.
const SCRYFALL_CARD = {
  object: 'card', id: 'fake-1', name: 'Test Golem', mana_cost: '{3}{G}', cmc: 4,
  type_line: 'Artifact Creature — Golem', oracle_text: 'Trample', flavor_text: 'It walks.',
  power: '4', toughness: '4', colors: ['G'], rarity: 'rare', set: 'tst', set_name: 'Test Set',
  collector_number: '42', lang: 'en', artist: 'A. Painter',
  image_uris: { art_crop: 'https://scryfall.test/art.jpg', normal: 'https://scryfall.test/card.jpg' },
};
// The art fetches the page makes have to resolve to a real image, or the card is drawn with no artwork
// behind it and the guide colours depend on whatever the fallback happens to be. This is an 8x8 opaque
// mid-grey PNG: the colour is deliberately neutral, so the 16%-opacity green tint the safety guide paints
// over it is unambiguous. (The previous one-pixel PNG had a corrupt IDAT and failed to decode, which made
// the pixel assertions below flaky.)
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR42mPIwwEYhpYEADyoUoFZDU7TAAAAAElFTkSuQmCC',
  'base64',
);

async function newPage(opts = {}) {
  // No shared storage: IndexedDB and localStorage from an earlier test would otherwise leak in
  // (a cached Scryfall reply, a saved print sheet), and the tests would stop being independent.
  const context = await browser.newContext({ acceptDownloads: true, storageState: undefined });
  const page = await context.newPage();
  const pageErrors = [], dialogs = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  // The app asks for confirmation before replacing a card or saving without an artist credit.
  // Accept, and keep the wording so a test can assert on it.
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  // Playwright checks routes newest-first, so the catch-all goes on first: anything registered after it
  // takes precedence. Get this backwards and the fakes below are shadowed by the catch-all.
  await page.route('**://**', route => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1') return route.continue();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
  });
  await page.route('**://cdnjs.cloudflare.com/**', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.JSZip = window.JSZip || function(){ this.file=()=>{}; this.generateAsync=async()=>(new Blob([])); };'
      + 'window.jspdf = window.jspdf || { jsPDF: function(){ this.text=()=>{}; this.addImage=()=>{}; this.output=()=>new Blob([]); this.save=()=>{}; } };',
  }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts stubbed in tests */' }));

  const scryfallHits = [];
  await page.route('**://api.scryfall.com/**', async route => {
    const url = route.request().url();
    scryfallHits.push(url);
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/cards/named')) return json(SCRYFALL_CARD);
    if (url.includes('/cards/autocomplete')) return json({ object: 'catalog', data: ['Test Golem'] });
    if (url.includes('/cards/search')) return json({ object: 'list', total_cards: 1, has_more: false, data: [SCRYFALL_CARD] });
    if (url.includes('/cards/random')) return json(SCRYFALL_CARD);
    if (url.includes('/sets/')) return json({ object: 'set', icon_svg_uri: 'https://scryfall.test/set.svg' });
    return json({ object: 'list', data: [SCRYFALL_CARD], not_found: [] });
  });

  await page.goto(opts.url || base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__pf);
  if (pageErrors.length) throw new Error(`the page reported errors on load:\n  ${pageErrors.join('\n  ')}`);
  return { page, context, scryfallHits, pageErrors, dialogs };
}

describe('page boots', () => {
  test('exposes the test surface and starts on an example card', async () => {
    const { page, context } = await newPage();
    const info = await page.evaluate(() => ({ w: __pf.W, h: __pf.H, bleed: __pf.BLEED }));
    assert.deepEqual(info, { w: 750, h: 1050, bleed: 37.5 });

    const name = await page.inputValue('#name');
    assert.ok(name.length > 0, 'the example card should have a name');
    const src = await page.getAttribute('#card', 'width');
    assert.equal(Number(src), 1500, 'the preview canvas is 2x card size');

    const docs = await page.evaluate(() => __pf.refDocs().length);
    assert.equal(docs, 0, 'the published page must not carry the private reference data');
    await context.close();
  });
});

describe('fileBase', () => {
  test('strips characters that are awkward in a filename', async () => {
    const { page, context } = await newPage();
    const cases = [
      ['Lightning Bolt', 'Lightning Bolt'],
      ['Godzilla, King of the Monsters', 'Godzilla King of the Monsters'],
      ['"Tamiyo\'s Journal"', 'Tamiyos Journal'],
      ['A/B: C?', 'AB C'],
      ['  spaced  ', 'spaced'],
      ['', 'card'],
      [null, 'card'],
      ['///', 'card'],
    ];
    for (const [input, want] of cases) {
      const got = await page.evaluate(s => __pf.fileBase(s), input);
      assert.equal(got, want, `fileBase(${JSON.stringify(input)})`);
    }
    await context.close();
  });

  test('never leaves a path separator or colon in the result', async () => {
    const { page, context } = await newPage();
    const nasty = await page.evaluate(() => __pf.fileBase('../../etc/passwd:evil\\name'));
    assert.ok(!/[\\/:]/.test(nasty), `got ${nasty}`);
    await context.close();
  });
});

describe('parseDeck', () => {
  test('reads counts, sets, collector numbers and deck-site noise', async () => {
    const { page, context } = await newPage();
    const out = await page.evaluate(() => {
      const text = [
        '// a comment',
        'Deck',
        '4 Lightning Bolt',
        '2x Counterspell',
        '1 Sol Ring (C21) 263',
        'SB: 3 Negate',
        '1 Test Golem *F*',
        '1 Ragavan, Nimble Pilferer # tag',
        '',
        'Lightning Bolt',
      ].join('\n');
      return __pf.parseDeck(text).map(e => ({ id: e.id, n: e.n, label: e.label }));
    });
    const by = label => out.filter(e => e.label === label);
    assert.equal(by('Lightning Bolt').length, 1, 'duplicate names should merge into one entry');
    assert.equal(by('Lightning Bolt')[0].n, 5, '4 + 1 copy without a count');
    assert.equal(by('Counterspell')[0].n, 2);
    assert.deepEqual(by('Sol Ring')[0].id, { set: 'c21', collector_number: '263' });
    assert.equal(by('Negate')[0].n, 3, 'sideboard prefix is dropped');
    assert.equal(by('Test Golem')[0].n, 1, 'foil marker is dropped');
    assert.ok(by('Ragavan, Nimble Pilferer'), 'inline tag comments are dropped');
    assert.ok(!out.some(e => /comment|^Deck$/i.test(e.label)), 'comments and headers are skipped');
    await context.close();
  });

  test('returns nothing for an empty list', async () => {
    const { page, context } = await newPage();
    assert.deepEqual(await page.evaluate(() => __pf.parseDeck('\n \n// x')), []);
    await context.close();
  });
});

describe('Scryfall response cache', () => {
  test('decides what may be stored', async () => {
    const { page, context } = await newPage();
    const cases = [
      ['/cards/named?fuzzy=Test%20Golem', true],
      ['/cards/search?q=x', true],
      ['/sets/iko', true],
      ['/cards/0000f1b2-1234-4abc-8def-000000000001', true],
      ['/cards/random?q=x', false],
      ['/cards/collection', false],
      ['/cards/search', false],
      ['/bulk-data', false],
      ['/symbology', false],
    ];
    for (const [path, want] of cases) {
      assert.equal(await page.evaluate(p => __pf.sfCacheable(p), path), want, path);
    }
    await context.close();
  });

  test('a second lookup of the same card is served from IndexedDB', async () => {
    const { page, context, scryfallHits } = await newPage();
    const count = () => scryfallHits.filter(u => u.includes('/cards/named')).length;

    await page.fill('#lookupName', 'Test Golem');
    await page.click('#lookupGo');
    await page.waitForFunction(() => document.getElementById('name').value === 'Test Golem');
    assert.equal(await page.inputValue('#type'), 'Artifact Creature — Golem');
    assert.equal(await page.inputValue('#pt'), '4/4');
    assert.ok(await until(() => count() === 1), `the lookup should have asked Scryfall once, saw ${count()}`);
    // The artist is deliberately not filled unless the official art is used too, so that the
    // reminder to credit the art you actually chose still fires.
    assert.equal(await page.inputValue('#artist'), '');

    // Clear the in-memory memo and the form, then look the same card up again: it should not re-request.
    await page.evaluate(() => { document.getElementById('name').value = ''; });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__pf);
    await page.fill('#lookupName', 'Test Golem');
    await page.click('#lookupGo');
    await page.waitForFunction(() => document.getElementById('name').value === 'Test Golem');
    await page.waitForTimeout(400); // give a stray request time to reach Node before asserting it didn't happen
    assert.equal(count(), 1, 'the cached reply should be reused after a reload');

    const stored = await page.evaluate(async () => (await __pf.idb.apiAll()).map(r => r.k));
    assert.ok(stored.some(k => k.startsWith('sf:/cards/named')), 'the reply should be in the "api" store');
    assert.ok(!stored.some(k => k.includes('random')), 'random cards must never be cached');
    await context.close();
  });

  test('a failed lookup still reports the error to the reader', async () => {
    const { page, context } = await newPage();
    await page.route('**://api.scryfall.com/cards/named**', route => route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ object: 'error', details: 'No card found.' }),
    }));
    await page.fill('#lookupName', 'Nothing At All');
    await page.click('#lookupGo');
    await page.waitForFunction(() => /No card found/.test(document.getElementById('status').textContent));
    assert.match(await page.textContent('#status'), /No card found/);
    await context.close();
  });
});

describe('safety margin guide', () => {
  test('draws a line an eighth of an inch inside the cut, and only when asked', async () => {
    const { page, context } = await newPage();
    const sample = () => page.evaluate(() => {
      const g = document.getElementById('card').getContext('2d');
      // The preview draws at 2x card units, so the safety line (37.5 units) lands at y = 75px.
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
      // "Green" has to be judged against a level, not a bare hue. The guide's line is a solid #2fd07f, so
      // it measures a green excess (g - max(r, b)) of 81. The strip outside it is only a 16%-opacity wash
      // over the card, which lands at 22 or less — but that is *over the artwork*, and over pale art the
      // same wash reads 187,208,186: green-looking, and over the 40 the old threshold allowed, which is
      // what made this test flaky. 65 sits in the gap between the wash and the line.
      const GEX = 65, ex = d => d[1] - Math.max(d[0], d[2]);
      let onLine = 0, outside = 0;
      for (let i = 0; i < 40; i++) {
        const x = 300 + i * 20;
        if (ex(at(x, 75)) > GEX) onLine++;
        if (ex(at(x, 20)) > GEX) outside++;
      }
      return { onLine, outside };
    });
    assert.deepEqual(await sample(), { onLine: 0, outside: 0 }, 'no safety line until it is switched on');

    // The preview redraws on the next animation frame, so wait for the line rather than guessing.
    await page.check('#safeGuides');
    assert.ok(await until(async () => (await sample()).onLine > 16), 'the safety line should appear when switched on');
    const on = await sample();
    // The line is dashed (10 on, 7 off), so about 60% of samples along it should land on a dash.
    assert.ok(on.onLine > 16, `a line should run along the safety margin, got ${on.onLine}/40 samples`);
    // Outside the margin there is a wash, never a line, so nothing there should reach the line's level.
    assert.equal(on.outside, 0,
      `the area outside the margin should be washed, not lined, but ${on.outside}/40 samples there are as green as the line`);

    await page.uncheck('#safeGuides');
    await page.waitForFunction(() => !document.getElementById('safeGuides').checked);
    await page.waitForTimeout(250);
    assert.deepEqual(await sample(), { onLine: 0, outside: 0 }, 'switching it off clears it again');
    await context.close();
  });

  test('the margin is an eighth of an inch inside the cut, a quarter inch from the bleed edge', async () => {
    const { page, context } = await newPage();
    const s = await page.evaluate(() => ({ bleed: __pf.BLEED, safe: __pf.SAFE, w: __pf.W, h: __pf.H }));
    assert.equal(s.bleed, 37.5, '⅛″ at 300 units to the inch');
    assert.equal(s.safe, 37.5, '⅛″ inside the cut at 300 units to the inch');
    assert.equal(s.safe + s.bleed, 75, '¼″ in from the edge of the bleed file, twice the bleed');
    assert.ok(s.safe < s.w / 4 && s.safe < s.h / 4, 'the margin must be smaller than the card');
    await context.close();
  });

  // The margin only means something if the text that matters is actually inside it, so measure where the
  // layouts really put their strings rather than trusting the constants above. Mana symbols are images,
  // not text, so drawImage is tapped as well; both are filtered to the card canvas, since the app also
  // fills text into offscreen canvases (every pip is drawn in its own box first).
  test('every layout keeps the name, cost, type, rules and P/T inside the margin', async () => {
    const { page, context } = await newPage();
    const measured = await page.evaluate(async () => {
      const onCard = ctx => ctx.canvas.width === 750 && ctx.canvas.height === 1050;
      const drawn = [];
      let watching = false;
      const box = (ctx, pts, s) => {
        const t = ctx.getTransform();
        const q = pts.map(([x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]);
        drawn.push({
          s,
          l: Math.min(...q.map(p => p[0])), r: Math.max(...q.map(p => p[0])),
          t: Math.min(...q.map(p => p[1])), b: Math.max(...q.map(p => p[1])),
        });
      };
      const p = CanvasRenderingContext2D.prototype;
      const fillText = p.fillText, drawImage = p.drawImage;
      // The prototypes are shared by every context in the page, so they must be put back: leaving them
      // wrapped would slow down and perturb everything drawn afterwards, including other tests.
      const restore = () => { p.fillText = fillText; p.drawImage = drawImage; };
      p.fillText = function (text, x, y, ...rest) {
        if (watching && onCard(this) && String(text).trim()) {
          const m = this.measureText(String(text));
          const fs = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 16])[1]);
          const asc = m.actualBoundingBoxAscent ?? fs * 0.78, dsc = m.actualBoundingBoxDescent ?? fs * 0.22;
          const w = m.width;
          const x0 = this.textAlign === 'center' ? x - w / 2 : (this.textAlign === 'right' || this.textAlign === 'end') ? x - w : x;
          const bl = this.textBaseline;
          const base = bl === 'middle' ? y + (asc - dsc) / 2 : (bl === 'top' || bl === 'hanging') ? y + asc : y;
          box(this, [[x0, base - asc], [x0 + w, base]], String(text));
        }
        return fillText.call(this, text, x, y, ...rest);
      };
      p.drawImage = function (img, x, y, w, h, ...rest) {
        // a mana symbol is a square image roughly 20-70 units across, drawn straight onto the card
        if (watching && onCard(this) && w >= 20 && w <= 70 && Math.abs(w - h) < 0.01) box(this, [[x, y], [x + w, y + h]], '[pip]');
        return drawImage.call(this, img, x, y, w, h, ...rest);
      };

      const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
      const ag = art.getContext('2d'); ag.fillStyle = '#9a9a9a'; ag.fillRect(0, 0, 750, 1050);
      const img = new Image(); img.src = art.toDataURL(); await img.decode();
      // Deliberately worst-case: a name long enough to hit fitText's minimum size, a long type line, rules
      // and flavor text that force the text box to grow. Short values would hide a layout that only clears
      // the margin when nothing has to shrink.
      const form = {
        name: 'A Very Long Legendary Card Name That Has To Shrink', cost: '{2}{B}{B}{B}',
        type: 'Legendary Creature — Vampire Noble Soldier', rules: 'Flying, vigilance, trample, haste. Whenever this creature attacks, draw a card and you gain 2 life.',
        flavor: 'Some debts are paid in memories, and others in blood.', pt: '3/3', artist: 'A. Painter',
        info: '001 · PRX · EN', note: 'Playtest card',
        border: 'none', color: 'B', titleFont: 'Spectral', shade: '0.78', size: '31', bleed: false, round: true,
        pipStyle: 'classic', pipColor: '#ffffff', rarity: 'mythic', setTint: true, artFx: 'none', wear: 'none',
        misprint: 'none', gloss: false, aiArt: false, aiModel: '', setCode: '', label: 'design', layers: [],
      };
      const out = {};
      try {
        for (const layout of ['fade', 'panel', 'framed', 'console', 'wrist']) {
          drawn.length = 0; watching = true;
          __pf.cardCanvas({ kind: 'made', form: { ...form, layout }, img, zoom: 1, ox: 0, oy: 0 }, 1);
          watching = false;
          // The collector and artist line is deliberately allowed nearer the cut than the margin, and the
          // layouts sprinkle small id numbers and labels (WRIST-COMP, PWR, PNL 12345) around their chrome.
          // Both are excluded by what the string is, not by where it happened to land.
          // Console uppercases its text, so match without case.
          const GUARDED = /^(A Very Long|Legendary Creature|Flying,|Some debts|3\/3)$/i;
          const guarded = drawn.filter(d => d.s === '[pip]' || GUARDED.test(d.s));
          out[layout] = {
            worst: Math.min(...guarded.map(d => Math.min(d.l, 750 - d.r, d.t, 1050 - d.b))),
            found: guarded.length, total: drawn.length,
          };
        }
      } finally { restore(); }
      return { out, safe: __pf.SAFE };
    });

    for (const [layout, m] of Object.entries(measured.out)) {
      assert.ok(m.found >= 6, `${layout}: expected the name, cost, type, rules and P/T, found ${m.found} of ${m.total} strings`);
      assert.ok(Number.isFinite(m.worst), `${layout}: nothing was measured`);
      assert.ok(m.worst >= measured.safe,
        `${layout}: text that matters comes within ${m.worst.toFixed(1)} units of the cut, but the safety margin is ${measured.safe}`);
    }
    await context.close();
  });

  // The test above measures one ASCII string and one power/toughness, which is exactly the blind spot
  // that let a real defect through: the wrist layout drew its P/T without using fitText's truncation, so
  // an over-long value ran 25 units from the cut while the tidy "3/3" case passed. So the same
  // measurement is repeated across inputs that stress different parts of the geometry.
  //
  // Title *font* is deliberately not one of the variables. The harness stubs the Google Fonts stylesheet
  // so the run stays offline, which means a family like Bungee never loads and silently falls back to the
  // serif — a font case here would look like coverage and prove nothing. The baseline is measured from the
  // glyphs actually drawn (see safeTitleBase in proxy-forge.html) so tall faces clear the line, but that
  // has to be confirmed against the real font, not in this suite.
  test('the margin holds for accented names, an over-long P/T and an exotic cost', async () => {
    const { page, context } = await newPage();
    const cases = [
      { why: 'accented capitals in the default serif', form: { name: 'Èowyn the Bold Ñameless' } },
      { why: 'a power/toughness far too wide for its plate', form: { pt: '1234567890/1234567890' } },
      { why: 'a cost with every symbol', form: { cost: '{W}{U}{B}{R}{G}{C}{X}{2}{W/U}' } },
    ];
    const measured = await page.evaluate(async (cases) => {
      const onCard = ctx => ctx.canvas.width === 750 && ctx.canvas.height === 1050;
      const drawn = [];
      let watching = false;
      const p = CanvasRenderingContext2D.prototype;
      const fillText = p.fillText, drawImage = p.drawImage;
      const restore = () => { p.fillText = fillText; p.drawImage = drawImage; };
      p.fillText = function (text, x, y, ...rest) {
        if (watching && onCard(this) && String(text).trim()) {
          const m = this.measureText(String(text));
          const fs = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 16])[1]);
          const asc = m.actualBoundingBoxAscent ?? fs * 0.78, dsc = m.actualBoundingBoxDescent ?? fs * 0.22;
          const t = this.getTransform();
          const w = m.width;
          const x0 = this.textAlign === 'center' ? x - w / 2 : (this.textAlign === 'right' || this.textAlign === 'end') ? x - w : x;
          const bl = this.textBaseline;
          const base = bl === 'middle' ? y + (asc - dsc) / 2 : (bl === 'top' || bl === 'hanging') ? y + asc : y;
          const q = [[x0, base - asc], [x0 + w, base]].map(([X, Y]) => [t.a * X + t.c * Y + t.e, t.b * X + t.d * Y + t.f]);
          drawn.push({ s: String(text), l: Math.min(...q.map(v => v[0])), r: Math.max(...q.map(v => v[0])),
                       t: Math.min(...q.map(v => v[1])), b: Math.max(...q.map(v => v[1])) });
        }
        return fillText.call(this, text, x, y, ...rest);
      };
      p.drawImage = function (img, x, y, w, h, ...rest) {
        if (watching && onCard(this) && w >= 20 && w <= 70 && Math.abs(w - h) < 0.01) {
          const t = this.getTransform();
          const q = [[x, y], [x + w, y + h]].map(([X, Y]) => [t.a * X + t.c * Y + t.e, t.b * X + t.d * Y + t.f]);
          drawn.push({ s: '[pip]', l: Math.min(...q.map(v => v[0])), r: Math.max(...q.map(v => v[0])),
                       t: Math.min(...q.map(v => v[1])), b: Math.max(...q.map(v => v[1])) });
        }
        return drawImage.call(this, img, x, y, w, h, ...rest);
      };

      const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
      const ag = art.getContext('2d'); ag.fillStyle = '#9a9a9a'; ag.fillRect(0, 0, 750, 1050);
      const img = new Image(); img.src = art.toDataURL(); await img.decode();

      const form = {
        name: 'A Very Long Legendary Card Name That Has To Shrink', cost: '{2}{B}{B}{B}',
        type: 'Legendary Creature — Vampire Noble Soldier', rules: 'Flying, vigilance, trample, haste. Whenever this creature attacks, draw a card and you gain 2 life.',
        flavor: 'Some debts are paid in memories, and others in blood.', pt: '3/3', artist: 'A. Painter',
        info: '001 · PRX · EN', note: 'Playtest card',
        border: 'none', color: 'B', titleFont: 'Spectral', shade: '0.78', size: '31', bleed: false, round: true,
        pipStyle: 'classic', pipColor: '#ffffff', rarity: 'mythic', setTint: true, artFx: 'none', wear: 'none',
        misprint: 'none', gloss: false, aiArt: false, aiModel: '', setCode: '', label: 'design', layers: [],
      };
      // Anything on the card counts here: unlike the test above this is a cross-check on *every* string,
      // so a font that pushes some piece of chrome slightly wide is a failure too, not something to filter.
      const out = [];
      try {
        for (const c of cases) {
          const f = { ...form, ...c.form };
          for (const layout of ['fade', 'panel', 'framed', 'console', 'wrist']) {
            drawn.length = 0; watching = true;
            __pf.cardCanvas({ kind: 'made', form: { ...f, layout }, img, zoom: 1, ox: 0, oy: 0 }, 1);
            watching = false;
            // Chrome is allowed in the bleed strip; only the strings that have to survive the cut are
            // judged, which is the same set the README promises and the other test checks.
            const GUARDED = /^(A Very Long|Èowyn|Legendary Creature|Flying,|Some debts|3\/3|1234567890)/i;
            const guarded = drawn.filter(d => d.s === '[pip]' || GUARDED.test(d.s));
            const worst = guarded.length
              ? guarded.reduce((a, d) => Math.min(a, d.l, 750 - d.r, d.t, 1050 - d.b), Infinity)
              : NaN;
            out.push({ why: c.why, layout, worst, found: guarded.length, total: drawn.length });
          }
        }
      } finally { restore(); }
      return { out, safe: __pf.SAFE };
    }, cases);

    for (const m of measured.out) {
      assert.ok(m.found >= 5, `${m.layout} / ${m.why}: expected the name, cost, type, rules and P/T, found ${m.found} of ${m.total}`);
      assert.ok(Number.isFinite(m.worst), `${m.layout} / ${m.why}: nothing was measured`);
      assert.ok(m.worst >= measured.safe,
        `${m.layout} / ${m.why}: text that matters comes within ${m.worst.toFixed(1)} units of the cut, but the safety margin is ${measured.safe}`);
    }
    await context.close();
  });
});

describe('playtest footer note', () => {
  test('prints one note per style, clear of footer text, P/T and card edges', async () => {
    const { page, context } = await newPage();
    const result = await page.evaluate(async () => {
      const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
      const ag = art.getContext('2d'); ag.fillStyle = '#777777'; ag.fillRect(0, 0, 750, 1050);
      const img = new Image(); img.src = art.toDataURL(); await img.decode();
      const p = CanvasRenderingContext2D.prototype;
      const fillText = p.fillText;
      const measurements = [], empty = [];
      const noteTexts = ['Playtest card — not for sale', 'Proxy — not for sale'];
      const bounds = (g, text, x, y) => {
        const m = g.measureText(text), a = g.getTransform();
        const left = x - (g.textAlign === 'center' ? m.width / 2 : g.textAlign === 'right' || g.textAlign === 'end' ? m.width : 0);
        const top = y - (m.actualBoundingBoxAscent || parseFloat(g.font) || 18);
        const right = left + m.width, bottom = y + (m.actualBoundingBoxDescent || 0);
        const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([px, py]) => [
          a.a * px + a.c * py + a.e, a.b * px + a.d * py + a.f,
        ]);
        return {
          left: Math.min(...points.map(q => q[0])), right: Math.max(...points.map(q => q[0])),
          top: Math.min(...points.map(q => q[1])), bottom: Math.max(...points.map(q => q[1])),
        };
      };
      p.fillText = function (text, x, y, ...rest) {
        if (this.canvas.width === 750 && this.canvas.height === 1050) {
          const s = String(text), box = bounds(this, s, x, y);
          // every other piece of text counts, not just the credit: a style's own captions, a credit that wraps
          // onto a second line, the P/T and the rules all have to stay clear of the note
          if (noteTexts.includes(s)) measurements.push({ kind: 'note', box });
          else if (s.trim()) measurements.push({ kind: 'text', box, text: s });
        }
        return fillText.call(this, text, x, y, ...rest);
      };
      try {
        // a short credit, and one long enough to wrap onto a second line in most styles
        for (const artist of ['A. Painter', 'Johannes Vermeer van Delft and Workshop Assistants'])
        for (const sty of __pf.styles()) {
          measurements.length = 0;
          const form = {
            name: 'Test Golem', cost: '{3}{G}', type: 'Artifact Creature — Golem', rules: 'Trample',
            flavor: '', pt: '4/4', artist, info: '001 · PRX · EN',
            note: 'Playtest card — not for sale', border: '#0b0b0c', color: 'G', titleFont: 'Spectral',
            shade: '0.78', size: '31', bleed: false, round: true, pipStyle: 'classic', pipColor: '#ffffff',
            rarity: 'rare', setTint: true, artFx: 'none', fxDark: '#0b2545', fxLight: '#ff8fd8', fxAmt: '0.5',
            wear: 'none', misprint: 'none', gloss: false, aiArt: false, aiModel: '', setCode: '',
            label: 'design', layout: sty.f.layout, layers: sty.layers, ...sty.f,
          };
          __pf.cardCanvas({ kind: 'made', form, img, zoom: 1, ox: 0, oy: 0 }, 1);
          const drawn = [...measurements], notes = drawn.filter(m => m.kind === 'note');
          if (notes.length !== 1) empty.push({ id: sty.id, artist, count: notes.length, why: 'nonempty' });
          for (const { box } of notes) {
            const note = { left: box.left - 10, right: box.right + 10, top: box.top - 4, bottom: box.bottom + 4 };
            if (note.left < 0 || note.top < 0 || note.right > 750 || note.bottom > 1050)
              empty.push({ id: sty.id, why: 'note outside card', box: note });
            for (const other of drawn.filter(m => m.kind === 'text')) {
              if (note.left < other.box.right && note.right > other.box.left &&
                  note.top < other.box.bottom && note.bottom > other.box.top)
                empty.push({ id: sty.id, artist, why: 'note overlaps text', text: other.text, note, other: other.box });
            }
          }

          measurements.length = 0;
          __pf.cardCanvas({ kind: 'made', form: { ...form, note: '', label: 'design' }, img, zoom: 1, ox: 0, oy: 0 }, 1);
          if (measurements.some(m => m.kind === 'note')) empty.push({ id: sty.id, why: 'empty', count: measurements.filter(m => m.kind === 'note').length });

          measurements.length = 0;
          __pf.cardCanvas({ kind: 'made', form: { ...form, label: 'proxy' }, img, zoom: 1, ox: 0, oy: 0 }, 1);
          if (measurements.filter(m => m.kind === 'note').length !== 1) empty.push({ id: sty.id, why: 'proxy-label', count: measurements.filter(m => m.kind === 'note').length });
        }
      } finally {
        p.fillText = fillText;
      }
      return { styleCount: __pf.styles().length, failures: empty };
    });
    assert.equal(result.styleCount, 62);
    assert.deepEqual(result.failures, []);
    await context.close();
  });
});

describe('fantasy album layout', () => {
  test('shows creature P/T and Jace’s loyalty shield', async () => {
    const fixtures = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'cards.json'), 'utf8'));
    const jace = fixtures.find(card => card.name === 'Jace, the Mind Sculptor');
    assert.ok(jace, 'Jace fixture is present');
    const { page, context } = await newPage();
    const drawn = await page.evaluate(async jaceCard => {
      const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
      const ag = art.getContext('2d'); ag.fillStyle = '#9a9a9a'; ag.fillRect(0, 0, 750, 1050);
      const img = new Image(); img.src = art.toDataURL(); await img.decode();
      const style = __pf.styles().find(s => s.id === 'album');
      const p = CanvasRenderingContext2D.prototype, fillText = p.fillText;
      const output = {};
      try {
        for (const [label, card] of [
          ['creature', { name: 'Test Golem', mana_cost: '{3}{G}', type_line: 'Artifact Creature — Golem', power: '3', toughness: '3' }],
          ['jace', jaceCard],
        ]) {
          const texts = [];
          p.fillText = function (text, x, y, ...rest) {
            if (this.canvas.width === 750 && this.canvas.height === 1050) texts.push(String(text));
            return fillText.call(this, text, x, y, ...rest);
          };
          const pt = card.power && card.toughness ? `${card.power}/${card.toughness}` : card.loyalty || '';
          const form = {
            name: card.name, cost: card.mana_cost, type: card.type_line, type_line: card.type_line,
            rules: card.oracle_text || '', flavor: '', pt, artist: card.artist || 'A. Painter',
            info: '001 · PRX · EN', note: '', border: 'none', color: 'U', titleFont: 'Spectral',
            shade: '0.78', size: '31', bleed: false, round: true, pipStyle: 'classic',
            pipColor: '#ffffff', rarity: 'rare', setTint: true, artFx: 'none', wear: 'none',
            misprint: 'none', gloss: false, aiArt: false, aiModel: '', setCode: '', label: 'design',
            layout: style.f.layout, layers: style.layers, ...style.f,
          };
          const rendered = __pf.cardCanvas({ kind: 'made', form, img, zoom: 1, ox: 0, oy: 0 }, 1);
          let shieldSide = 0;
          if (label === 'jace') {
            const pixels = rendered.getContext('2d').getImageData(598, 620, 12, 100).data;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 110) shieldSide++;
            }
          }
          output[label] = { texts, shieldSide };
        }
      } finally { p.fillText = fillText; }
      return output;
    }, jace);
    assert.ok(drawn.creature.texts.includes('3/3'), 'creature P/T is rendered');
    assert.ok(drawn.jace.texts.includes('3'), 'Jace’s loyalty number is rendered');
    assert.ok(drawn.jace.shieldSide >= 3,
      'Jace’s loyalty number has a visible shield outline');
    await context.close();
  });
});

describe('reference panel', () => {
  test('is hidden on the published page, which has no reference data', async () => {
    const { page, context } = await newPage();
    assert.equal(await page.locator('#ref').isHidden(), true);
    await context.close();
  });
});

describe('print sheet and export', () => {
  test('a card added to the sheet is saved to IndexedDB and survives a reload', async () => {
    const { page, context } = await newPage();
    await page.fill('#name', 'Cache Test');
    await page.click('#addSheet');
    await page.waitForFunction(() => document.querySelectorAll('#thumbs li').length === 1);
    assert.match(await page.textContent('#sheetCount'), /1 card/);

    const rows = await page.evaluate(async () => (await __pf.idb.all()).map(r => r.form.name));
    assert.ok(rows.includes('Cache Test'), `expected the card in the "cards" store, got ${rows.join()}`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__pf);
    await page.waitForFunction(() => document.querySelectorAll('#thumbs li').length === 1);
    assert.match(await page.textContent('#sheetCount'), /1 card/);
    await context.close();
  });

  test('Save PNG produces a 600 dpi image of the whole card', async () => {
    const { page, context } = await newPage();
    await page.fill('#name', 'Export Test');
    await page.fill('#artist', 'A. Painter');
    const download = page.waitForEvent('download');
    await page.click('#save');
    const file = await download;
    assert.match(file.suggestedFilename(), /^Export Test \d+dpi\.png$/);

    // The card is 2.5 x 3.5 in. Everything an export does is scaled from these, so check them.
    const geom = await page.evaluate(() => [__pf.W, __pf.H, __pf.BLEED]);
    assert.deepEqual(geom, [750, 1050, 37.5]);
    await context.close();
  });

  test('print-shop export adds the eighth-inch bleed on every side', async () => {
    const { page, context } = await newPage();
    const geom = await page.evaluate(() => ({ w: __pf.W, h: __pf.H, b: __pf.BLEED }));
    // The card canvas at 2x is 1500x2100; with bleed it is 1575x2175 (2.75 x 3.75 in at 600 dpi).
    assert.equal(geom.w + geom.b * 2, 825);
    assert.equal(geom.h + geom.b * 2, 1125);

    const seams = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 150; c.height = 210;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 150, 210);
      g.fillStyle = '#000000'; g.fillRect(7, 7, 136, 196);
      return __pf.bleedSeam(c, 7).map(v => Math.round(v));
    });
    assert.equal(seams.length, 4);
    for (const v of seams) assert.ok(v > 200, `a white bleed against a black card should read as a seam, got ${seams.join()}`);
    await context.close();
  });

  test('an image with a bleed is trimmed to the card when saved without one', async () => {
    const { page, context } = await newPage();
    // A print-shop render at 800 dpi: 2200x3000 is 2.75 x 3.75 in, so the bleed is 100px all round
    // and the card underneath is the middle 2000x2800 (2.5 x 3.5 in).
    const px = await page.evaluate(async () => {
      const src = document.createElement('canvas');
      src.width = 2200; src.height = 3000;
      const sg = src.getContext('2d');
      sg.fillStyle = '#00ff00'; sg.fillRect(0, 0, 2200, 3000);      // 1/8" bleed
      sg.fillStyle = '#ff0000'; sg.fillRect(100, 100, 2000, 2800);  // the card
      sg.fillStyle = '#ff00ff'; sg.fillRect(1000, 1400, 200, 200);  // 200px marker at the card's centre
      const img = new Image();
      img.src = src.toDataURL('image/png');
      await img.decode();
      const out = __pf.cardCanvas({ kind: 'image', img, hasBleed: true }, 1);
      const g = out.getContext('2d');
      const d = g.getImageData(0, 0, out.width, out.height).data;
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
      // How wide is the marker? A true crop keeps its scale (200 * 750/2000 = 75px); stretching the
      // whole 2200px image down to 750 would shrink it to 68px.
      const row = 525; let first = -1, last = -1;
      for (let x = 0; x < out.width; x++) {
        const i = (row * out.width + x) * 4;
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) { if (first < 0) first = x; last = x; }
      }
      let green = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] > 200 && d[i + 2] < 60) green++;
      return {
        size: [out.width, out.height],
        corner: at(0, 0), centre: at(375, 525),
        markerWidth: last - first + 1, markerMiddle: (first + last) / 2,
        greenPixels: green,
      };
    });
    assert.deepEqual(px.size, [750, 1050]);
    assert.deepEqual(px.corner, [255, 0, 0], 'the corner must be card, not bleed');
    assert.equal(px.greenPixels, 0, 'no bleed may survive the trim');
    assert.ok(Math.abs(px.markerWidth - 75) <= 2, `the crop must keep the card's scale: marker is ${px.markerWidth}px, expected 75`);
    assert.ok(Math.abs(px.markerMiddle - 375) <= 2, `the card should be centred, marker at ${px.markerMiddle}`);
    assert.deepEqual(px.centre, [255, 0, 255], 'the card’s own pixels should be untouched');
    await context.close();
  });
});
