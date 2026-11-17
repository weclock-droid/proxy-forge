// Refreshes tests/fixtures/cards.json: a verbatim slice of Scryfall's API for the cards the tool has to
// handle, saved whole so the tests and probes read the real field names rather than a retyped idea of them.
//
// Scryfall asks for at most 10 requests a second and suggests batching, so the names go through
// /cards/collection 75 at a time (1 request per batch, not per card). Nothing here reaches the network
// during a test run: this script is run by hand, and its output is committed.
//
// Usage: node tools/fetch-fixtures.mjs [--check]
//   --check   fail (exit 1) if a card cannot be fetched or comes back empty, without writing the file
import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'fixtures', 'cards.json');
const HEADERS = { 'User-Agent': 'proxy-forge-dev-fixtures/1.0', Accept: 'application/json' };

// One card per shape the renderer and the lookup have to survive. Keep this list curated rather than
// long: each entry is a case, and the comments say which one.
const WANTED = [
  // --- planeswalkers: a single loyalty number where a creature has power and toughness ---
  'Chandra, Torch of Defiance',            // +1 / +1 / −3 / −7, four abilities, U+2212 minus
  'Nissa, Steward of Elements',            // loyalty "X", a 0: ability, nothing before the first colon
  'Sarkhan the Masterless',                // static ability first, then +1 and −3
  'Jace, the Mind Sculptor',               // loyalty 3, two −1 lines (duplicate ability costs)
  'Garruk, Apex Predator',                 // the longest oracle text of the lot; −8 ultimate
  'Wrenn and Six',                         // two colours, plus a two-digit loyalty ability
  'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', // transform: a planeswalker back face, P/T on the front
  'Nicol Bolas, Dragon-God',               // five abilities, two of them with the same cost
  'Oko, Thief of Crowns',                  // loyalty 4, a "0:" ability
  'Kaito, Bane of Nightmares',             // ninjutsu and a static ability before the abilities
  'Tyvar, Jubilant Brawler',               // one very long ability line
  'Basri Ket',                             // short abilities, loyalty 3
  'The Wandering Emperor',                 // flash, and abilities that can only be played at instant speed
  'Nissa, Who Shakes the World',           // no loyalty ability on the printed line but a static ability
  'Liliana of the Veil',                   // the classic −2 / −6
  'Karn Liberated',                        // loyalty 6, a −14 ultimate
  'Saheeli, Sublime Artificer',            // a "−2" that creates a token
  'Vivien, Champion of the Wilds',         // loyalty 4, and a keyword ability line
  'Mu Yanling, Sky Dancer',                // animate-a-land ability
  'Teferi, Time Raveler',                  // static + two abilities
  'Ugin, the Spirit Dragon',               // loyalty 7, a −X ability
  'Ashiok, Dream Render',                  // hybrid-ish cost, a −1 that mills
  'Dovin, Grand Arbiter',                  // "+1" that can only be used once per turn (a rider in the text)
  // --- battles: defense instead of loyalty, and a back face with P/T ---
  'Invasion of Ikoria // Zilortha, Apex of Ikoria',
  'Invasion of Fiora // Marchesa, Resolute Monarch',
  'Invasion of Gobakhan // Lightshield Array',
  'Battle of Frost and Fire',
  // --- sagas: chapter lines that already have badge support ---
  'The Mirari Conjecture',
  'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
  'Elspeth Conquers Death',                // three chapters, a long one
  'Urza Assembles the Titans',             // five chapters, mixed numerals
  'Kiora Bests the Sea God',               // chapters with reminder text
  // --- creatures: the ordinary case, including the awkward numbers ---
  'Eager Trufflesnout',
  'Questing Beast',                        // five keyword abilities in one line
  'Ulamog, the Ceaseless Hunger',          // indestructible, a very long ability
  'Luminous Broodmoth',                    // reminder text in italics
  'Warden of the First Tree',              // a level-up creature (three tiered stat rows)
  'Delver of Secrets // Insectile Aberration', // transform with different P/T per face
  'Brisela, Voice of Nightmares',          // meld: one face, two names in the type line's partner text
  // --- the edges of the text the layouts have to fit ---
  'Lightning Bolt',                        // the shortest card there is
  'Boseiju, Who Endures',                  // a channel land with a long keyword line
  'B.F.M. (Big Furry Monster)',            // the widest power/toughness ever printed (99/99)
  'Our Market Research Shows That Players Like Really Long Card Names So We Made this Card to Have the Absolute Longest Card Name Ever Elemental',
  'Asmoranomardicadaistinaculdacar',       // the longest single-word name
  'Fire // Ice',                           // a split card: two halves sharing one frame
  'Wear // Tear',                          // split card whose halves cost different colours
  'Mountain',                              // a basic land: color from the mana it makes, not the cost
  'Wastes',                                // a basic land with no colour at all
];

const batchOf = (arr, n) => arr.reduce((out, x) => (out[out.length - 1].length === n ? out.push([x]) : out[out.length - 1].push(x), out), [[]]);

async function post(path, body) {
  const r = await fetch('https://api.scryfall.com' + path, {
    method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 429) { await new Promise(s => setTimeout(s, 2000)); return post(path, body); }
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}
async function get(path) {
  const r = await fetch('https://api.scryfall.com' + path, { headers: HEADERS });
  if (r.status === 429) { await new Promise(s => setTimeout(s, 2000)); return get(path); }
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

// Scryfall's collection endpoint does not accept a full "Front // Back" name, so each entry is asked for
// by its front half and the reply comes back as the whole card. Index by the front name for lookup.
const front = name => name.split(' // ')[0].trim();
const found = new Map();
for (const batch of batchOf(WANTED, 75)) {
  const j = await post('/cards/collection', { identifiers: batch.map(name => ({ name: front(name) })) });
  for (const c of j.data) found.set(front(c.name), c);
  for (const nf of j.not_found || []) console.error('not found:', nf.name);
}

// Scryfall's collection endpoint answers with the front face's fields at the top level, which is what the
// page reads; keep the response as it came rather than reshaping it, so a fixture can never be tidier
// than the real thing. A couple of fields are dropped only because they are large and unused.
const DROP = ['prices', 'purchase_uris', 'related_uris', 'image_uris', 'legalities', 'rulings_uri', 'prints_search_uri', 'uri', 'scryfall_uri', 'purchase_uris', 'multiverse_ids', 'mtgo_id', 'arena_id', 'tcgplayer_id', 'cardmarket_id', 'set_id', 'oracle_id', 'id'];
const trim = c => Object.fromEntries(Object.entries(c).filter(([k]) => !DROP.includes(k)));

const cards = [];
const missing = [];
for (const name of WANTED) {
  const c = found.get(front(name));
  if (!c) { missing.push(name); continue; }
  cards.push(trim(c));
}
if (process.argv.includes('--check')) {
  if (missing.length) { console.error(`\n${missing.length} card(s) missing: ${missing.join(', ')}`); process.exit(1); }
  const empty = cards.filter(c => !c.name || !c.type_line);
  if (empty.length) { console.error(`\n${empty.length} card(s) came back empty`); process.exit(1); }
  console.log(`all ${cards.length} cards fetched`);
  process.exit(0);
}
await writeFile(OUT, JSON.stringify(cards, null, 1));
console.log(`wrote ${cards.length} cards to ${OUT}`);
if (missing.length) console.log(`${missing.length} missing: ${missing.join(', ')}`);
const shapes = cards.reduce((m, c) => m.set(c.layout, (m.get(c.layout) || 0) + 1), new Map());
console.log('layouts:', [...shapes].map(([k, v]) => `${k}×${v}`).join(' '));
