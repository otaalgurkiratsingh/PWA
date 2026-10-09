import { expect, test, type Page } from '@playwright/test';

async function openFresh(page: Page, route = 'today') {
  await page.goto(`/#/${route}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('meal logging', () => {
  test('one tap logs a calibrated preset, saved locally, with undo', async ({ page }) => {
    await openFresh(page, 'meals');
    const tile = page.getByRole('button', { name: 'Log Dal katori, 1 katori' });
    await expect(tile).toBeEnabled();
    const t0 = Date.now();
    await tile.click();
    await expect(page.getByRole('status').getByText(/Saved on this device · Dal katori/)).toBeVisible();
    console.log(`automated tap-to-saved: ${Date.now() - t0} ms`);
    await expect(page.locator('.timeline').getByText('Dal katori')).toBeVisible();
    await expect(page.getByText('Demo values').first()).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('No meals logged today')).toBeVisible();
  });

  test('unknown-recipe item makes totals partial, never zero', async ({ page }) => {
    await openFresh(page, 'meals');
    await page.getByRole('button', { name: 'Log Sabzi, 1 katori' }).click();
    await expect(page.getByText('Some items unknown').first()).toBeVisible();
    await expect(page.locator('.meter .value').first()).toHaveText('Unknown');
    await page.getByRole('button', { name: 'Log Roti, 2 rotis' }).click();
    await expect(page.locator('.meter .value').first()).toHaveText(/^≥ [\d,]+ kcal$/);
  });

  test('amount sheet logs a chosen quantity and edits keep the logged revision', async ({ page }) => {
    await openFresh(page, 'meals');
    await page.getByRole('button', { name: 'Choose amount for Roti' }).click();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Log 3 rotis' }).click();
    await expect(page.locator('.timeline').getByText(/3 roti/)).toBeVisible();
    await page.getByRole('button', { name: 'Edit Roti' }).click();
    await expect(page.getByRole('dialog').getByText(/rev 1/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No meals logged today')).toBeVisible();
  });
});

test.describe('workout journal', () => {
  test('completed sets and rest timer survive a reload; planned stays distinct from actual', async ({ page }) => {
    await openFresh(page, 'train');
    await page.getByRole('button', { name: 'Start Push' }).click();
    const bench = page.getByRole('region', { name: 'Bench press' });
    await expect(bench.getByText(/Last time/)).toBeVisible();

    await bench.getByLabel('Set 1 reps', { exact: true }).fill('5');
    await bench.getByLabel(/Set 1 load/).fill('52.5');
    await bench.getByRole('button', { name: 'Complete Set 1' }).click();
    await expect(bench.getByRole('button', { name: 'Undo Set 1 completion' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rest-clock')).toBeVisible();
    // The planned prescription stays visible and separate from what was done.
    await expect(bench.getByText(/Planned: 6–8 reps @ 50 kg/).first()).toBeVisible();

    const before = await page.getByTestId('rest-clock').textContent();
    await page.reload();
    const benchAfter = page.getByRole('region', { name: 'Bench press' });
    await expect(benchAfter.getByRole('button', { name: 'Undo Set 1 completion' })).toHaveAttribute('aria-pressed', 'true');
    await expect(benchAfter.getByLabel('Set 1 reps', { exact: true })).toHaveValue('5');
    await expect(benchAfter.getByLabel(/Set 1 load/)).toHaveValue('52.5');
    await expect(page.getByTestId('rest-clock')).toBeVisible();
    const after = await page.getByTestId('rest-clock').textContent();
    expect(after! <= before!).toBe(true); // countdown continued from the stored end time

    // Exactly one active session after reload (no duplicate).
    await expect(page.getByText(/^In progress/)).toHaveCount(1);

    // Skipping is not a zero-rep set.
    await benchAfter.getByRole('button', { name: 'Skip set' }).first().click();
    await expect(benchAfter.getByText('Skipped')).toBeVisible();

    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start Push' })).toBeVisible();
  });
});

test.describe('offline and storage', () => {
  test('app shell loads offline after first visit and logging still saves', async ({ page, context }) => {
    await openFresh(page, 'today');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload(); // now controlled by the service worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await page.goto('/#/meals');
    await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible();
    await page.getByRole('button', { name: 'Log Chai, 1 cup' }).click();
    await expect(page.locator('.timeline').getByText('Chai')).toBeVisible();
    await page.reload();
    await expect(page.locator('.timeline').getByText('Chai')).toBeVisible();
    await page.goto('/#/settings');
    await expect(page.getByText(/offline — logging works either way/)).toBeVisible();
    await expect(page.getByText(/1 change waiting in the local outbox/)).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('separation and honesty', () => {
  test("switching profile shows none of the other profile's entries", async ({ page }) => {
    await openFresh(page, 'meals');
    await page.getByRole('button', { name: 'Log Whey shake, 1 scoop' }).click();
    await expect(page.locator('.timeline').getByText('Whey shake')).toBeVisible();
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Demo B' }).click();
    await expect(page.getByRole('button', { name: /settings for Demo B/ })).toBeVisible();
    await page.goto('/#/meals');
    await expect(page.getByText('No meals logged today')).toBeVisible();
    await expect(page.getByText('No target set').first()).toBeVisible();
  });

  test('missing steps and sleep are shown as unknown, not zero', async ({ page }) => {
    await openFresh(page, 'today');
    await expect(page.getByText('Not entered')).toBeVisible();
    await expect(page.getByText('Not tracked')).toBeVisible();
    await expect(page.getByText('Sleep · no source connected')).toBeVisible();
  });
});

test.describe('layout and accessibility', () => {
  for (const width of [320, 360]) {
    test(`no horizontal overflow at ${width}px, including 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      for (const zoom of ['100%', '200%']) {
        for (const r of ['today', 'meals', 'train', 'progress', 'settings']) {
          await page.goto(`/#/${r}`);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await page.addStyleTag({ content: `html{font-size:${zoom}}` });
          await page.waitForTimeout(150);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${r} at ${width}px / ${zoom}`).toBeLessThanOrEqual(0);
        }
      }
    });
  }

  test('controls have accessible names and tap targets >= 40px', async ({ page }) => {
    for (const r of ['today', 'meals', 'train', 'progress', 'settings']) {
      await page.goto(`/#/${r}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
      const problems = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href], select, input:not([type=checkbox])')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const b = el.getBoundingClientRect();
            const name =
              el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.closest('label')?.textContent || '';
            return { tag: el.tagName, name: name.trim().slice(0, 40), h: Math.round(b.height), w: Math.round(b.width) };
          })
          .filter((x) => !x.name || x.h < 40 || x.w < 40),
      );
      expect(problems, r).toEqual([]);
    }
  });

  test('a working set can be completed from the active workout screen with keyboard only', async ({ page }) => {
    await openFresh(page, 'train');
    await page.getByRole('button', { name: 'Start Pull' }).focus();
    await page.keyboard.press('Enter');
    const row = page.getByRole('region', { name: 'Pull-up' });
    await row.getByLabel('Set 1 reps', { exact: true }).focus();
    await page.keyboard.press('Tab'); // load
    await page.keyboard.press('Tab'); // complete
    await page.keyboard.press('Enter');
    await expect(row.getByRole('button', { name: 'Undo Set 1 completion' })).toHaveAttribute('aria-pressed', 'true');
  });
});
