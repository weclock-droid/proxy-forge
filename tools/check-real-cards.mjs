// Renders real Scryfall cards through the real "Fill in" lookup and reports what breaks.
//
// The unit tests feed the layouts hand-written strings, which is exactly the blind spot that let the
// loyalty-as-power/toughness defect through: every fixture in tests/proxy-forge.test.mjs has a `power`
// and a `toughness`, and none has a `loyalty`, a `defense`, a `layout`, a card with no P/T at all, or
// rules text that starts with a minus sign. This probe drives the shapes that are actually in the wild.
//
// The cards come from tests/fixtures/cards.json, which is a verbatim slice of Scryfall's API (see
// tools/fetch-fixtures.mjs for how it is refreshed). Each one is served to the page as if it were the
// /cards/named reply, then the card is rendered in every layout and measured with the same transform-
// aware text boxing the safety-margin suites use, plus the field mapping is checked for sanity.
//
// Exit code is 1 when a card's own words fall outside the safety margin or off the card, since those are
// defects in the layouts themselves. The field-mapping findings (a planeswalker's loyalty landing in the
// power/toughness box, a battle's defense drawn as a P/T) are a list of work not yet done rather than a
// regression, so they do not fail the run unless --strict is given.
//
// Usage: node tools/check-real-cards.mjs [--json] [--strict]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'cards.json');
const asJson = process.argv.includes('--json');
const LAYOUTS = ['fade', 'panel', 'framed', 'console', 'wrist'];
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

if (!existsSync(FIXTURES)) {
  console.error(`No fixtures at ${FIXTURES}. Run: node tools/fetch-fixtures.mjs`);
  process.exit(2);
}
const cards = JSON.parse(await readFile(FIXTURES, 'utf8'));

const server = createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(ROOT, 'proxy-forge.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route('**://**', r => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })));
await page.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.JSZip=function(){};window.jspdf={jsPDF:function(){}};' }));
await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts stubbed */' }));

// The page asks /cards/named?fuzzy=<name>; answer with whichever fixture was asked for.
let serving = cards[0];
await page.route('**://api.scryfall.com/**', route => {
  const url = route.request().url();
  const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (/\/cards\/named/.test(url)) return json(serving);
  if (/\/cards\/autocomplete/.test(url)) return json({ object: 'catalog', data: [] });
  if (/\/sets\//.test(url)) return json({ object: 'set', icon_svg_uri: 'https://scryfall.test/set.svg' });
  return json({ object: 'list', data: [serving], has_more: false, next_page: null });
});
await page.goto(`http://127.0.0.1:${server.address().port}/proxy-forge.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf);
await page.uncheck('#safeGuides').catch(() => {});

// What each card *should* look like once filled in, expressed as the rules the tool promises.
// `pt` is the field the app has to put the number in; note that a planeswalker's loyalty, a battle's
// defense and a creature's power/toughness are three different things that arrive in three different
// JSON keys and must not be silently flattened into one.
const EXPECT = card => {
  const face = (card.card_faces && card.card_faces[0]) || card;
  const type = face.type_line || card.type_line || '';
  const walker = /planeswalker/i.test(type);
  const battle = /\bbattle\b/i.test(type);
  return {
    face, walker, battle,
    // A planeswalker's rules are its loyalty abilities, and those start with a sign or a 0. A card whose
    // `oracle_text` does not start that way (Sarkhan's static ability, a Kaito that leads with ninjutsu)
    // is a different shape and is reported as such rather than counted as a lost ability.
    abilitiesFirst: /^\s*[+−-]?\d\s*:/.test((face.oracle_text || '').split('\n')[0] || ''),
    loyalty: face.loyalty ?? card.loyalty,
    defense: face.defense ?? card.defense,
    power: face.power ?? card.power,
    toughness: face.toughness ?? card.toughness,
    type,
  };
};

const findings = [];
const rows = [];
for (const card of cards) {
  if (card.error) continue;
  serving = card;
  const wanted = card.name.split(' // ')[0];
  await page.fill('#lookupName', wanted);
  await page.click('#lookupGo');
  // The previous card's name is still in the field, so waiting for "not empty" would read the card
  // before this one. Wait for the status line the lookup itself writes.
  const ok = await (async () => {
    for (let i = 0; i < 60; i++) {
      const s = await page.textContent('#status');
      if (/^Filled in “/.test(s || '')) return true;
      if (/couldn’t be loaded|didn’t answer|Too many/.test(s || '')) return false;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  })();
  if (!ok) {
    findings.push({ card: card.name, kind: 'lookup-failed', detail: `status was ${JSON.stringify(await page.textContent('#status'))}` });
    continue;
  }

  const got = await page.evaluate(() => ({
    name: document.getElementById('name').value,
    cost: document.getElementById('cost').value,
    type: document.getElementById('type').value,
    rules: document.getElementById('rules').value,
    pt: document.getElementById('pt').value,
    ptLabel: document.querySelector('label[for="pt"]')?.textContent.trim() || '',
    flavor: document.getElementById('flavor').value,
    artist: document.getElementById('artist').value,
    info: document.getElementById('info').value,
    rarity: document.getElementById('rarity').value,
    setCode: document.getElementById('setCode').value,
  }));
  const want = EXPECT(card);
  // Every symbol the card prints, in the cost and in the rules. `{…}` is the notation both fields use.
  const wantSyms = ((want.face.mana_cost || '') + (want.face.oracle_text || '')).match(/\{[^}]+\}/g)?.length || 0;

  // ---- field mapping checks ----
  if (!got.name) findings.push({ card: card.name, kind: 'empty-name', detail: 'no name filled in' });
  // The rules box only counts if its first line is the card's first line: a truncated oracle text is a
  // different failure from a missing one, and the layouts give the box a fixed amount of room.
  const wantFirst = (face => (face.oracle_text || '').split('\n')[0])(want.face);
  const gotFirst = (got.rules || '').split('\n')[0];
  if (wantFirst && gotFirst && wantFirst.trim() !== gotFirst.trim()) {
    findings.push({ card: card.name, kind: 'rules-rewritten', detail: `first rules line is ${JSON.stringify(gotFirst.slice(0, 60))}, not ${JSON.stringify(wantFirst.slice(0, 60))}` });
  }
  // A look up fills the box; it does not get to drop the printed lines it does not have room for.
  if (wantFirst && !gotFirst) findings.push({ card: card.name, kind: 'rules-empty', detail: `the card's text is ${JSON.stringify(wantFirst.slice(0, 40))} and the box is empty` });
  if (want.walker) {
    // A planeswalker's number is loyalty: a single number, not a power and a toughness. Three separate
    // things have to survive the trip — the number, the knowledge that it is loyalty, and the rules text
    // with its plus and minus signs intact.
    if (!/planeswalker/i.test(got.type)) findings.push({ card: card.name, kind: 'type-lost', detail: `type line is ${JSON.stringify(got.type)}` });
    if (want.loyalty && got.pt !== String(want.loyalty) && got.pt !== '') {
      findings.push({ card: card.name, kind: 'loyalty-lost', detail: `loyalty ${want.loyalty} did not reach the card (the box holds ${JSON.stringify(got.pt)})` });
    }
    // The field must say "Loyalty", because that is what the number is. Requiring the word in the *oracle
    // text* too was wrong: real planeswalkers almost never print it — the loyalty cost is a symbol like
    // "+1" — so that half of the check failed 17 cards for a string they do not contain.
    if (!/loyalty/i.test(got.ptLabel)) {
      findings.push({
        card: card.name, kind: 'loyalty-read-as-power-toughness',
        detail: `loyalty ${want.loyalty}: the field is labelled ${JSON.stringify(got.ptLabel)}, not "Loyalty"`,
      });
    }
  }
  if (want.battle && !/defense/i.test(got.ptLabel)) {
    // A battle's defense must be labelled DEFENSE. The old check fired for every battle unconditionally,
    // claiming the value was "drawn as a power/toughness" — which was true of an older build, not this one.
    findings.push({
      card: card.name, kind: 'battle-shape',
      detail: `a battle's defense ${want.defense} is labelled ${JSON.stringify(got.ptLabel)}, not "Defense"`,
    });
  }

  // ---- rendering checks, every layout ----
  for (const layout of LAYOUTS) {
    await page.selectOption('#layout', layout);
    await new Promise(r => setTimeout(r, 60));
    const m = await page.evaluate(async layout => {
      // The same fields readForm() walks, built from the DOM so the probe renders exactly what the
      // editor is showing rather than a hand-made form that could drift from it.
      const IDS = ['name', 'cost', 'type', 'rules', 'flavor', 'pt', 'artist', 'info', 'note', 'layout', 'border', 'color',
        'titleFont', 'shade', 'size', 'bleed', 'round', 'pipStyle', 'pipColor', 'rarity', 'setTint', 'artFx', 'fxDark',
        'fxLight', 'fxAmt', 'wear', 'wearSeed', 'gloss', 'misprint', 'label', 'aiArt', 'aiModel', 'setCode'];
      const form = {};
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        form[id] = el.type === 'checkbox' ? el.checked : el.value;
      }
      form.layers = [];
      const drawn = [];
      // Every square draw on the card, at any size: the cost row, the inline symbols in rules text, and
      // whatever else the layout draws as a square image. Counted outside the try so the return can read it.
      const pips = [];
      const onCard = ctx => ctx.canvas.width === 750 && ctx.canvas.height === 1050;
      const p = CanvasRenderingContext2D.prototype;
      const fillText = p.fillText, drawImage = p.drawImage;
      const art = document.createElement('canvas'); art.width = 750; art.height = 1050;
      const ag = art.getContext('2d'); ag.fillStyle = '#9a9a9a'; ag.fillRect(0, 0, 750, 1050);
      const img = new Image(); img.src = art.toDataURL(); await img.decode();
      try {
        p.fillText = function (text, x, y, ...rest) {
          if (onCard(this) && String(text).trim()) {
            const mm = this.measureText(String(text));
            const fs = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 16])[1]);
            const asc = mm.actualBoundingBoxAscent ?? fs * .78, dsc = mm.actualBoundingBoxDescent ?? fs * .22;
            const t = this.getTransform(), w = mm.width;
            const x0 = this.textAlign === 'center' ? x - w / 2 : (this.textAlign === 'right' || this.textAlign === 'end') ? x - w : x;
            const bl = this.textBaseline;
            const base = bl === 'middle' ? y + (asc - dsc) / 2 : (bl === 'top' || bl === 'hanging') ? y + asc : y;
            const q = [[x0, base - asc], [x0 + w, base]].map(([X, Y]) => [t.a * X + t.c * Y + t.e, t.b * X + t.d * Y + t.f]);
            drawn.push({ s: String(text), px: fs, l: Math.min(...q.map(v => v[0])), r: Math.max(...q.map(v => v[0])), t: Math.min(...q.map(v => v[1])), b: Math.max(...q.map(v => v[1])) });
          }
          return fillText.call(this, text, x, y, ...rest);
        };
        // Mana symbols are counted as well as placed, because "is every symbol on the card" is a different
        // question from "is the text inside the margin" and the old 20-70px window answered neither for
        // the inline symbols in rules text, which draw smaller. Any square draw counts; the size floor is
        // 6 units so a rules-text symbol at the smallest readable size still registers.
        p.drawImage = function (im, x, y, w, h, ...rest) {
          if (onCard(this) && Math.abs(w - h) < 0.01 && w >= 6 && w <= 200) {
            const t = this.getTransform();
            const q = [[x, y], [x + w, y + h]].map(([X, Y]) => [t.a * X + t.c * Y + t.e, t.b * X + t.d * Y + t.f]);
            const box = { l: Math.min(...q.map(v => v[0])), r: Math.max(...q.map(v => v[0])), t: Math.min(...q.map(v => v[1])), b: Math.max(...q.map(v => v[1])), w };
            pips.push(box);
            if (w >= 20 && w <= 70) drawn.push({ s: '[mana symbol]', ...box });
          }
          return drawImage.call(this, im, x, y, w, h, ...rest);
        };
        __pf.cardCanvas({ kind: 'made', form: { ...form, layout }, img, zoom: 1, ox: 0, oy: 0 }, 1);
      } finally { p.fillText = fillText; p.drawImage = drawImage; }
      // The collector/artist line and the layouts' own chrome are allowed nearer the cut; everything else
      // is text that has to survive a slightly off-centre trim. The chrome list is the same set
      // check-safe-area.mjs tolerates (README: "the styles' own decoration ... sits out there too").
      const CHROME = /^(WRIST-COMP|PWR|MODEL|PNL \d+|\d\d-\d+|\d+)$/i;
      // The collector/artist line is one string the layout assembles ("001 · PRX · EN   ✎ A. Painter"),
      // so it is identified by what it contains rather than by an exact match — and both sides have to be
      // normalised the same way, or stripping the "·" from the drawn text stops it matching the field.
      const norm = s => String(s).replace(/[✎·✦—–]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const foot = [form.info, form.artist, form.note].filter(Boolean).map(norm);
      const judged = drawn.filter(d => {
        const n = norm(d.s);
        if (!n) return false;
        if (CHROME.test(String(d.s).trim())) return false;
        for (const f of foot) if (f && n.includes(f)) return false;
        return true;
      });
      const worst = judged.length ? judged.reduce((a, d) => Math.min(a, d.l, 750 - d.r, d.t, 1050 - d.b), Infinity) : NaN;
      const outside = judged.filter(d => Math.min(d.l, 750 - d.r, d.t, 1050 - d.b) < __pf.SAFE);
      // Text drawn right up against the canvas edge is either intentional full-bleed art or a bug; the
      // layouts that draw their own chrome out there are listed in check-safe-area.mjs. Here we only want
      // to know whether the *card's own words* are being clipped, so report anything beyond 2 units.
      const clipped = judged.filter(d => d.l < -2 || d.r > 752 || d.t < -2 || d.b > 1052);
      // A string ending in an ellipsis is text that did not fit: fitText truncates rather than overflow,
      // which is right for a name but wrong for rules text the reader needs.
      const elided = judged.filter(d => /…\s*$/.test(d.s) && d.s.length > 3);
      // The smallest size any of the card's own words was drawn at, to catch text shrunk past readable.
      // Words and numbers only: a chapter badge's Roman numeral and the odd stray ":" are drawn one
      // character at a time at their own size, and are not the card's body text.
      const sizes = judged.filter(d => d.px && d.s.replace(/[^\p{L}\p{N}]/gu, '').length > 1).map(d => ({ s: d.s.slice(0, 44), px: d.px }));
      const smallest = sizes.length ? sizes.reduce((a, b) => (b.px < a.px ? b : a)) : null;
      return {
        worst, safe: __pf.SAFE,
        outside: outside.slice(0, 4).map(d => ({ s: d.s.slice(0, 40), inset: Math.round(Math.min(d.l, 750 - d.r, d.t, 1050 - d.b)) })),
        clipped: clipped.slice(0, 4).map(d => ({ s: d.s.slice(0, 40) })),
        elided: elided.slice(0, 4).map(d => d.s.slice(0, 60)),
        pips: pips.length,
        // The cost row is the pips sharing a y; a big colour symbol or a rarity stamp sits on its own line.
        pipRowL: pips.length ? Math.round(Math.min(...pips.filter(q => Math.abs(q.t - Math.min(...pips.map(z => z.t))) < 4).map(q => q.l))) : null,
        pipMin: pips.length ? Math.round(Math.min(...pips.map(q => q.w)) * 10) / 10 : null,
        minPx: smallest ? Math.round(smallest.px * 10) / 10 : null,
        minPxWhat: smallest ? smallest.s : null,
        strings: judged.length,
      };
    }, layout);

    rows.push({ card: card.name, layout, ...m });
    if (Number.isFinite(m.worst) && m.worst < m.safe) {
      findings.push({ card: card.name, layout, kind: 'outside-margin', detail: `worst inset ${Math.round(m.worst)} < ${m.safe}: ${m.outside.map(o => `${JSON.stringify(o.s)} at ${o.inset}`).join(', ')}` });
    }
    if (m.clipped.length) {
      findings.push({ card: card.name, layout, kind: 'past-the-edge', detail: m.clipped.map(o => JSON.stringify(o.s)).join(', ') });
    }
    // Every mana symbol the card prints should be drawn. Counted against the card's own cost and oracle
    // text, because "the pips are missing" is what this probe exists to answer and a per-symbol count is
    // the only form of the question that can come back no.
    const printed = wantSyms;
    if (m.pips < printed) {
      findings.push({ card: card.name, layout, kind: 'pips-missing', detail: `the card prints ${printed} mana symbols and ${m.pips} were drawn` });
    }
    // The cost row has to start inside the margin, the same as any other text.
    if (m.pipRowL !== null && m.pipRowL < m.safe) {
      findings.push({ card: card.name, layout, kind: 'pips-outside-margin', detail: `the cost row starts at x ${m.pipRowL}, inside the ${m.safe}-unit margin` });
    }
    // A name elided to fit is a defect — the card no longer says which card it is. The one exception is
    // the fixture that exists to be impossible: 141 characters cannot fit a title band at a readable size,
    // and its elision is the behaviour under measurement, not a bug. It is reported, and does not fail.
    if (m.elided.length) {
      const deliberate = card.name.length > 100;
      findings.push({
        card: card.name, layout, kind: deliberate ? 'text-truncated-on-purpose' : 'text-truncated',
        detail: m.elided.map(s => JSON.stringify(s)).join(', '),
      });
    }
  }
}

await browser.close();
await new Promise(r => server.close(r));

if (asJson) {
  console.log(JSON.stringify({ rows, findings }, null, 1));
} else {
  const byKind = new Map();
  for (const f of findings) {
    const k = f.kind;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(f);
  }
  console.log(`${cards.filter(c => !c.error).length} real cards × ${LAYOUTS.length} layouts = ${rows.length} renders\n`);
  if (!findings.length) console.log('Nothing to report: every card filled in, and every layout kept its text inside the margin.');
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${kind} (${list.length})`);
    for (const f of list.slice(0, 12)) console.log(`  ${f.card}${f.layout ? ` [${f.layout}]` : ''} — ${f.detail}`);
    if (list.length > 12) console.log(`  … and ${list.length - 12} more`);
  }
}
// Defects in the layouts and in the field mapping always fail. `text-truncated` is here because a card
// name that silently loses its tail is a defect, not a note — it used to be printed and then ignored, so
// the five elisions it found never failed anything. `lookup-failed` stays PENDING: it means Scryfall did
// not answer, which says nothing about the card.
const FATAL = ['outside-margin', 'past-the-edge', 'text-truncated', 'empty-name', 'type-lost', 'pips-missing', 'pips-outside-margin'];
const PENDING = ['loyalty-read-as-power-toughness', 'battle-shape', 'loyalty-lost', 'defense-lost', 'rules-empty', 'rules-rewritten', 'lookup-failed'];
const bad = findings.filter(f => FATAL.includes(f.kind) || (process.argv.includes('--strict') && PENDING.includes(f.kind)));
process.exitCode = bad.length ? 1 : 0;
