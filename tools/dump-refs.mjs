// Prints the Reference data baked into proxy-forge.html, so it can be eyeballed without opening the page.
// Usage: node tools/dump-refs.mjs [docId] [sectionIndex]
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(join(ROOT, 'proxy-forge.html'), 'utf8');
const m = html.match(/<script type="application\/json" id="refData">([\s\S]*?)<\/script>/);
if (!m) { console.error('No refData block found in proxy-forge.html'); process.exit(1); }
const data = JSON.parse(m[1].replaceAll('<\\/', '</'));

console.log(`built ${data.built}`);
for (const d of data.docs) console.log(`  ${d.id.padEnd(11)} ${String(d.sections.length).padStart(3)} sections  ${d.source}`);
const [id, idx] = process.argv.slice(2);
if (!id) process.exit(0);
const doc = data.docs.find(d => d.id === id);
if (!doc) { console.error(`no document "${id}"`); process.exit(1); }
const show = idx == null ? doc.sections : [doc.sections[+idx]];
for (const s of show) {
  console.log(`\n## ${s.title}`);
  for (const it of s.items) console.log(`  ${it.tag ? `[${it.tag}] ` : ''}${it.text}`);
  if (s.card) console.log(`  card: ${JSON.stringify(s.card)}`);
}
