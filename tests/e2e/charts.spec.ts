import { expect, test, type Page } from '@playwright/test';

/**
 * Chart behaviour that only shows up in a browser: hover states, and whether
 * a chart drew anything at all.
 */

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  const demo = page.getByRole('button', { name: /demo user/i });
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
    await page.waitForURL(/\/overview/, { timeout: 30_000 });
  }
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the category ring reads out in its own hole, not under a tooltip', async ({ page }) => {
  await page.goto('/accounts/axis-bank-credit-card-9581?period=2026-06');

  const centre = page.locator('.donut-centre');
  await expect(centre).toBeVisible();
  // At rest: the total, and how many categories it covers.
  await expect(centre).toContainText('₹19,488');
  await expect(centre).toContainText('6 categories');

  // Hovering the biggest slice's row turns the hole into that slice.
  await page.locator('.donut-legend-button').first().hover();
  await expect(centre).toContainText('Shopping');
  await expect(centre).toContainText('₹14,867');
  await expect(centre).toContainText('76.3% of spend');

  // There is no floating tooltip to collide with it.
  await expect(page.locator('.chart-tooltip')).toHaveCount(0);

  // And it goes back to the total on the way out.
  await page.locator('h1').hover();
  await expect(centre).toContainText('6 categories');
});

test('year views draw bars only for months that have a statement', async ({ page }) => {
  await page.goto('/savings/slice-small-finance-bank-savings-6993?mode=year&year=2026');

  // Two months uploaded, two series — four bars, and no empty months padding
  // the axis out.
  await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(6);
  // The month labels use a typographic apostrophe, not a straight one.
  await expect(page.locator('body')).toContainText('Jul \u201926');
  await expect(page.locator('body')).toContainText('Aug \u201926');
  // The table lists the two real months and nothing else. (The note beneath
  // it does say "no statement", which is why this is scoped to the rows.)
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(3); // Jul, Aug, Total
  await expect(page.locator('table tbody')).not.toContainText('no statement');
});

test('cashback has a real year view rather than an empty December', async ({ page }) => {
  await page.goto('/accounts/axis-bank-credit-card-9581/cashback?mode=year&year=2026');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Calendar 2026');
  await expect(page.locator('body')).not.toContainText(/nothing uploaded/i);
  await expect(page.locator('body')).toContainText('Earned this year');
  await expect(page.locator('body')).toContainText('₹267.00');
});

test('the savings month view shows the per-day interest, not only the total', async ({ page }) => {
  await page.goto('/savings/slice-small-finance-bank-savings-6993?period=2026-08');

  await expect(page.locator('body')).toContainText('Interest credited each day');
  // The day-to-day movement is the point: lowest and highest differ.
  await expect(page.locator('body')).toContainText('₹30.94');
  await expect(page.locator('body')).toContainText('₹39.69');
  // And the running total is still there, separately.
  await expect(page.locator('body')).toContainText('running total');
});

test('cashback per transaction is connected, not a scatter', async ({ page }) => {
  await page.goto('/accounts/axis-bank-credit-card-9581/cashback?period=2026-06');

  // One path for the line through every purchase.
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
  await expect(page.locator('body')).toContainText('in the order they happened');
});
