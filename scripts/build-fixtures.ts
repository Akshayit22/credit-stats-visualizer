/**
 * Turns the real PDFs in `samples/` into **redacted** text fixtures in
 * `fixtures/`, using the same line-reconstruction the browser runs and the same
 * redaction the server applies.
 *
 *   npm run fixtures:build
 *
 * `samples/` is gitignored and must stay that way. `fixtures/` is committed, so
 * this script refuses to write a file that still carries an email address, a
 * phone number, an IFSC code or an unmasked account number.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { itemsToLines, type TextItemLike } from '../src/client/lib/pdf-text';
import { formatStatementText, type StatementPage } from '../src/shared/statement-text';
import { findPiiLeaks, redactForStorage } from '../src/shared/redact';

const SAMPLES = resolve('samples');
const FIXTURES = resolve('fixtures');

async function extract(path: string): Promise<StatementPage[]> {
  const data = new Uint8Array(readFileSync(path));
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
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
        width: Number(item.width ?? 0),
      });
    }
    pages.push({ pageNumber, lines: itemsToLines(items) });
  }
  await document.destroy();
  return pages;
}

async function main(): Promise<void> {
  mkdirSync(FIXTURES, { recursive: true });

  const pdfs = readdirSync(SAMPLES).filter((name) => extname(name).toLowerCase() === '.pdf');
  if (pdfs.length === 0) {
    console.error(`No PDFs in ${SAMPLES}. Put the real statements there (it is gitignored).`);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const file of pdfs) {
    const name = basename(file, extname(file));
    const pages = await extract(resolve(SAMPLES, file));
    const raw = formatStatementText(pages);
    const { text, counts } = redactForStorage(raw);

    const leaks = findPiiLeaks(text);
    if (leaks.length > 0) {
      failed = true;
      console.error(`REFUSED ${name}: redaction left ${leaks.length} identifier(s) behind:`);
      for (const leak of leaks) console.error(`   ${leak.kind}: ${leak.sample}`);
      console.error('   Fix src/shared/redact.ts before committing a fixture.\n');
      continue;
    }

    const hash = createHash('sha256').update(text).digest('hex');
    writeFileSync(resolve(FIXTURES, `${name}.txt`), `${text}\n`);
    writeFileSync(
      resolve(FIXTURES, `${name}.meta.json`),
      `${JSON.stringify({ pageCount: pages.length, contentHash: hash, redacted: counts }, null, 2)}\n`,
    );

    const removed = Object.entries(counts)
      .map(([kind, n]) => `${kind}×${n}`)
      .join(' ');
    console.log(`wrote  fixtures/${name}.txt  (${pages.length} pages, removed ${removed})`);
  }

  if (failed) process.exitCode = 1;
  else console.log('\nEvery fixture is clean. Read the diff before committing it anyway.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
