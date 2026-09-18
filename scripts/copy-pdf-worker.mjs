/**
 * pdf.js needs its worker served from our own origin, and its version must match
 * the library exactly — a stale worker fails with "The API version does not
 * match the Worker version". Copying it on postinstall keeps the two in step
 * without committing a build artefact.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const entry = require.resolve('pdfjs-dist/package.json');
const source = resolve(dirname(entry), 'build', 'pdf.worker.min.mjs');
const target = resolve('public', 'pdf.worker.min.mjs');

mkdirSync(resolve('public'), { recursive: true });
copyFileSync(source, target);
console.log(`pdf worker -> ${target}`);
