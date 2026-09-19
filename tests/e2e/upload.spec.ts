import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The upload flow, in a real browser, with the real PDFs.
 *
 * This is the only test that covers the browser half of the pipeline: pdf.js
 * fetching its worker, opening the file, extracting text with positions,
 * redacting it, hashing it with `crypto.subtle`, and posting it. The vitest
 * parser suites run on committed fixtures and prove none of that — they start
 * from text that something else already produced.
 *
 * It needs `samples/`, which is gitignored. Absent, every case skips with a
 * message rather than failing.
 */

const SAMPLES = resolve('samples');

function samplePdf(match: RegExp): string | null {
  if (!existsSync(SAMPLES)) return null;
  const file = readdirSync(SAMPLES).find((name) => match.test(name) && name.endsWith('.pdf'));
  return file ? resolve(SAMPLES, file) : null;
}

const CARD_PDF = samplePdf(/supermoney|axis/i);
const SAVINGS_PDF = samplePdf(/slice.*aug/i);

/** The dev-login bypass, so the browser lands inside the app. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  const demo = page.getByRole('button', { name: /demo user/i });
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
    await page.waitForURL(/\/overview/, { timeout: 30_000 });
  }
}

async function uploadAndParse(page: Page, pdfPath: string): Promise<void> {
  // The upload trigger is worded for where it sits: "Upload" in the sticky
  // header, "Add statement" on the library, "Upload statement" in an empty
  // state. Any of them opens the same dialog.
  await page
    .getByRole('button', { name: /^upload$|add statement|upload statement/i })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The file input is visually hidden behind the drop zone, which is what a
  // real user clicks; setInputFiles drives it the same way the click would.
  await page.locator('input[type="file"]').setInputFiles(pdfPath);

  await page.getByRole('button', { name: /^parse$/i }).click();

  // pdf.js has to fetch its worker and open the document — give it room.
  await expect(page.getByRole('heading', { name: /check the figures/i })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe('uploading a statement in a browser', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    // These tests upload the very statements the seed loads, so a seeded
    // database would make every one of them a duplicate. Start from nothing;
    // the uploads themselves put the data back.
    await page.request.post('/api/account/delete', {
      data: { confirm: 'delete my data' },
    });
  });

  test('parses a credit card PDF and reconciles it', async ({ page }) => {
    test.skip(CARD_PDF === null, 'No card PDF in samples/ — it is gitignored.');
    if (!CARD_PDF) return;

    await page.goto('/library');
    await uploadAndParse(page, CARD_PDF);

    const dialog = page.getByRole('dialog');

    // The figures the statement actually prints. If pdf.js read the file
    // correctly, these are what come back.
    await expect(dialog).toContainText('Axis Bank');
    await expect(dialog).toContainText('2026-05-17');
    await expect(dialog).toContainText('2026-06-15');
    await expect(dialog).toContainText('15');
    await expect(dialog).toContainText('₹19,392.38');

    // Reconciled, not merely parsed.
    await expect(dialog).toContainText(/totals reconciled/i);

    // And the browser removed identifiers before anything was sent.
    await expect(dialog).toContainText(/identifiers/i);
  });

  test('parses a savings PDF and reconciles it', async ({ page }) => {
    test.skip(SAVINGS_PDF === null, 'No savings PDF in samples/ — it is gitignored.');
    if (!SAVINGS_PDF) return;

    await page.goto('/library');
    await uploadAndParse(page, SAVINGS_PDF);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('slice small finance bank');
    await expect(dialog).toContainText('2026-08-01');
    await expect(dialog).toContainText('2026-08-31');
    await expect(dialog).toContainText('49');
    await expect(dialog).toContainText('₹3,17,691.27');
    await expect(dialog).toContainText(/totals reconciled/i);
  });

  test('recognises the same file uploaded twice', async ({ page }) => {
    test.skip(CARD_PDF === null, 'No card PDF in samples/ — it is gitignored.');
    if (!CARD_PDF) return;

    await page.goto('/library');
    await uploadAndParse(page, CARD_PDF);
    await page.getByRole('button', { name: /looks right|keep with/i }).click();

    await uploadAndParse(page, CARD_PDF);
    await expect(page.getByRole('dialog')).toContainText(/already uploaded/i);
  });

  test('never sends the PDF itself — only extracted text', async ({ page }) => {
    test.skip(CARD_PDF === null, 'No card PDF in samples/ — it is gitignored.');
    if (!CARD_PDF) return;

    const uploads: Array<{ contentType: string; body: string }> = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (!request.url().includes('/api/statements')) return;
      uploads.push({
        contentType: request.headers()['content-type'] ?? '',
        body: request.postData() ?? '',
      });
    });

    await page.goto('/library');
    await uploadAndParse(page, CARD_PDF);

    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) {
      // JSON, never multipart — a PDF cannot travel this way.
      expect(upload.contentType).toContain('application/json');
      expect(upload.contentType).not.toContain('multipart');

      const payload = JSON.parse(upload.body) as { text: string; contentHash: string };
      // A PDF's own header. Its absence is the claim this test exists to make.
      expect(payload.text).not.toContain('%PDF');
      expect(payload.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // And the personal details are already gone at this point, before the
      // server has had any chance to remove them.
      expect(payload.text).not.toMatch(/AKSHAY|TELAN|LUMAN|PUSHPANJALI|VADAPALANI/i);
      expect(payload.text).not.toMatch(/652984|033325225226993/);
      expect(payload.text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    }
  });

  test('shows the parsed statement on the dashboards afterwards', async ({ page }) => {
    test.skip(SAVINGS_PDF === null, 'No savings PDF in samples/ — it is gitignored.');
    if (!SAVINGS_PDF) return;

    await page.goto('/library');
    await uploadAndParse(page, SAVINGS_PDF);
    await page.getByRole('button', { name: /looks right|keep with|close/i }).first().click();

    // The sidebar is account-first: the account is there, and its statement
    // view shows the figures the upload produced.
    await page.getByRole('link', { name: /slice savings/i }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Aug 2026/);
    await expect(page.locator('body')).toContainText('₹3,17,691');
    await expect(page.locator('body')).toContainText('₹1,048.09');
  });
});
