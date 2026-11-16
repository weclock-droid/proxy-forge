// Builds the Reference panel's data into proxy-forge.html.
//
// Reads the project's own markdown, turns it into one JSON block, and writes that block between the
// <!-- refs:start --> and <!-- refs:end --> markers. The page never fetches anything: the data is baked in,
// so the single file still works from disk, from a web server, and offline.
//
// The reference files are private and are not in the repository, so the published page carries no
// reference data and hides the panel. Two modes:
//   node tools/build.mjs           empties the block in proxy-forge.html (add --check to fail instead of writing)
//   node tools/build.mjs --local   reads the local files below and writes proxy-forge.local.html, which is
//                                  git-ignored, so the private data can never end up in the published page
//
// Local sources:
//   references/proxy-guidelines.md  - the community's posting rules  -> obligation tags (MUST / SHOULD / ...)
//   references/print-pipeline.md    - tools and methods               -> grouped links and steps
//   godzilla-series.md              - the Godzilla Series card list   -> real card text, loadable into the editor
//
// A source that doesn't exist yet is skipped with a warning; the others still build.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'proxy-forge.html');
const LOCAL_PAGE = join(ROOT, 'proxy-forge.local.html');
const START = '<!-- refs:start';
const END = '<!-- refs:end -->';
const TAGS = ['MUST NOT', 'SHOULD NOT', 'MUST', 'SHOULD', 'MAY'];

const read = async p => (existsSync(p) ? readFile(p, 'utf8') : null);
const tidy = s => String(s).replace(/^[-*•]\s+/, '').replace(/\s+/g, ' ').trim();

// Split a markdown file into `## ` sections of bullets and short prose lines.
// Returns { title, items: [{ tag?, text }] }.
function parseSections(md) {
  const out = [];
  let cur = null;
  const push = () => { if (cur && (cur.title || cur.items.length)) out.push(cur); };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+(.+?)\s*$/m);
    if (h) { push(); cur = { title: h[1], items: [] }; continue; }
    if (/^#\s+/.test(line)) continue;              // the document's own title
    if (!cur) continue;                            // prose before the first heading: skip
    if (!line.trim()) continue;
    const text = tidy(line);
    if (!text) continue;
    const m = text.match(new RegExp(`^(${TAGS.join('|')})\\s*:\\s*(.+)$`, 'i'));
    const item = m ? { tag: m[1].toUpperCase(), text: tidy(m[2]) } : { text };
    if (!item.text) continue;
    // A wrapped bullet continues on the next line without a marker; glue it to the item before it.
    const prev = cur.items[cur.items.length - 1];
    if (prev && !m && !/^[-*•]/.test(line.trimStart()) && prev.text.length < 160 && !/[.:;]$/.test(prev.text)) {
      prev.text = tidy(`${prev.text} ${text}`);
      continue;
    }
    cur.items.push(item);
  }
  push();
  return out.filter(s => s.title && s.items.length);
}

// godzilla-series.md: one `## 275 · Godzilla, King of the Monsters` section per card, with
// `- **Field:** value` bullets and a `> quote` block for the rules text.
function parseGodzilla(md) {
  const sections = [];
  for (const chunk of md.replace(/\r\n?/g, '\n').split(/\n(?=##\s)/).slice(1)) {
    const title = (chunk.match(/^##\s+(.+?)\s*$/m) || [])[1];
    if (!title) continue;
    const field = label => {
      const m = chunk.match(new RegExp(`^-\\s*\\*\\*${label}:\\*\\*\\s*(.+)$`, 'mi'));
      return m ? tidy(m[1].replace(/`/g, '')) : '';
    };
    const quotes = chunk.split('\n').filter(l => /^>\s?/.test(l.trim())).map(l => l.trim().replace(/^>\s?/, ''));
    const items = [];
    const iko = field('Ikoria name');
    if (iko) items.push({ tag: 'PLAYS AS', text: `Plays exactly like ${iko}.` });
    if (field('Mana cost')) items.push({ text: `Mana cost ${field('Mana cost')}` });
    if (field('Type')) items.push({ text: `Type line ${field('Type')}` });
    if (field('P/T')) items.push({ text: `Power and toughness ${field('P/T')}` });
    if (field('Godzilla Series artist')) items.push({ tag: 'ARTIST', text: `Art by ${field('Godzilla Series artist')}.` });
    if (field('Where it came from')) items.push({ text: `Printing: ${field('Where it came from')}.` });
    if (quotes.length) items.push({ tag: 'RULES', text: quotes.join('\n') });
    const page = field('Card page');
    if (page) items.push({ text: page });
    if (!items.length) continue;
    const num = (title.match(/^(\d+)/) || [])[1] || '';
    sections.push({
      title,
      items,
      card: {
        cost: field('Mana cost'), type: field('Type'), rules: quotes.join('\n'),
        pt: field('P/T'), artist: field('Godzilla Series artist'), iko,
        info: num ? `${num} · IKO · EN` : '',
      },
    });
  }
  return sections;
}

function buildDoc({ id, name, source, sections }) {
  return sections.length ? { id, name, source, sections } : null;
}

async function main() {
  const local = process.argv.includes('--local');
  const jobs = !local ? [] : [
    { id: 'guidelines', name: 'Posting guidelines', file: 'references/proxy-guidelines.md', parse: parseSections },
    { id: 'pipeline', name: 'Tools and print pipeline', file: 'references/print-pipeline.md', parse: parseSections },
    { id: 'cards', name: 'Godzilla Series cards', file: 'godzilla-series.md', parse: parseGodzilla },
  ];
  const docs = [];
  for (const job of jobs) {
    const md = await read(join(ROOT, job.file));
    if (md == null) { console.warn(`- skip ${job.file} (not found)`); continue; }
    const sections = job.parse(md);
    if (!sections.length) { console.warn(`- skip ${job.file} (no sections found)`); continue; }
    docs.push(buildDoc({ id: job.id, name: job.name, source: job.file, sections }));
    console.log(`- ${job.file}: ${sections.length} sections, ${sections.reduce((n, s) => n + s.items.length, 0)} lines`);
  }
  if (local && !docs.length) { console.error('Nothing to build: no readable source files.'); process.exit(1); }

  // JSON goes inside a <script> element, so the only sequence that must not appear is a literal `</script`.
  const json = JSON.stringify({ built: local ? new Date().toISOString().slice(0, 10) : '', docs })
    .replace(/<\//g, '<\\/');
  const block = `${START} — built from the project's markdown by tools/build.mjs; edit the markdown, not this block -->\n`
    + `<script type="application/json" id="refData">${json}</script>\n${END}`;
  const page = await readFile(PAGE, 'utf8');
  const a = page.indexOf(START), b = page.indexOf(END);
  if (a < 0 || b < 0 || b < a) { console.error(`Couldn't find the ${START} --> … ${END} markers in proxy-forge.html`); process.exit(1); }
  const next = page.slice(0, a) + block + page.slice(b + END.length);

  if (process.argv.includes('--check')) {
    if (next !== page) { console.error('proxy-forge.html is out of date: run `node tools/build.mjs`.'); process.exit(1); }
    console.log('proxy-forge.html is up to date.');
    return;
  }
  await writeFile(local ? LOCAL_PAGE : PAGE, next);
  const kb = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
  console.log(local ? `Wrote ${docs.length} documents (${kb} KB of JSON) into proxy-forge.local.html (not published).`
    : 'Emptied the reference block in proxy-forge.html.');
}

main().catch(err => { console.error(err); process.exit(1); });
