/**
 * Turns the real PDFs in `samples/` into **redacted** text fixtures in
 * `backend/fixtures/`, using the same line reconstruction the browser runs and
 * the same redaction the server applies.
 *
 *   npm run fixtures:build   (from the repository root)
 *
 * `samples/` is gitignored and must stay that way. The fixtures are committed,
 * so this refuses to write one that still carries an email address, a phone
 * number, an IFSC code or an unmasked account number. Read the diff anyway.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPiiLeaks,
  formatStatementText,
  itemsToLines,
  redactForStorage,
  type StatementPage,
  type TextItemLike,
} from '@cred-stats/shared';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

async function extract(path: string): Promise<StatementPage[]> {
  const data = new Uint8Array(readFileSync(path));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const document = await loadingTask.promise;
  const pages: StatementPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItemLike[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      items.push({
        str: item.str,
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
        width: Number(item.width),
      });
    }
    pages.push({ pageNumber, lines: itemsToLines(items) });
  }
  await loadingTask.destroy();
  return pages;
}

mkdirSync(FIXTURES, { recursive: true });

const pdfs = readdirSync(SAMPLES).filter((name) => extname(name).toLowerCase() === '.pdf');
if (pdfs.length === 0) {
  console.error(`No PDFs in ${SAMPLES}. Put the real statements there (it is gitignored).`);
  process.exitCode = 1;
}

let refused = false;
for (const file of pdfs) {
  const name = basename(file, extname(file));
  const pages = await extract(`${SAMPLES}${file}`);
  const { text, counts } = redactForStorage(formatStatementText(pages));

  const leaks = findPiiLeaks(text);
  if (leaks.length > 0) {
    refused = true;
    console.error(`REFUSED ${name}: redaction left ${leaks.length} identifier(s) behind:`);
    for (const leak of leaks) console.error(`   ${leak.kind}: ${leak.sample}`);
    console.error('   Fix shared/src/redact.ts before committing a fixture.\n');
    continue;
  }

  const hash = createHash('sha256').update(text).digest('hex');
  writeFileSync(`${FIXTURES}${name}.txt`, `${text}\n`);
  writeFileSync(
    `${FIXTURES}${name}.meta.json`,
    `${JSON.stringify({ pageCount: pages.length, contentHash: hash, redacted: counts }, null, 2)}\n`,
  );
  const removed = Object.entries(counts)
    .map(([kind, n]) => `${kind}×${n}`)
    .join(' ');
  console.log(`wrote  backend/fixtures/${name}.txt  (${pages.length} pages, removed ${removed})`);
}

if (refused) process.exitCode = 1;
else if (pdfs.length > 0)
  console.log('\nEvery fixture is clean. Read the diff before committing it anyway.');
