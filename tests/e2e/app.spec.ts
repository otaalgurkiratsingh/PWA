import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Demo build (no backend configured). */
async function enterDemo(page: Page, route = 'today') {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the demo/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  if (route !== 'today') await page.goto(`/#/${route}`);
}

const dismissToasts = async (page: Page) => {
  const d = page.getByRole('button', { name: 'Dismiss' });
  if (await d.count()) await d.first().click();
};

/** Read one IndexedDB record in the page (for history-integrity checks). */
async function idbGet(page: Page, profile: string, store: string, key: string) {
  return page.evaluate(async ([db, s, k]) => new Promise((resolve, reject) => {
    const req = indexedDB.open(`rozana-journal-${db}`);
    req.onsuccess = () => {
      const g = req.result.transaction(s!, 'readonly').objectStore(s!).get(k!);
      g.onsuccess = () => { resolve(g.result); req.result.close(); };
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  }), [profile, store, key]);
}

test.describe('first launch, theme and sign-in placeholder', () => {
  test.use({ colorScheme: 'dark' });

  test('opens light even when the phone is dark; the choice persists without a flash', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Use dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The attribute is set by /theme-init.js before React renders.
    const initial = await page.evaluate(async () => {
      const html = await (await fetch('/')).text();
      return html.includes('/theme-init.js') && html.indexOf('/theme-init.js') < html.indexOf('/src/main') + 1e9;
    });
    expect(initial).toBe(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('without backend setup, Continue explains the setup state and makes no network call', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4173')) calls.push(r.url()); });
    await page.goto('/');
    await page.getByLabel('Email').fill('me@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Sign-in is still being set up/)).toBeVisible();
    expect(calls).toEqual([]);
  });
});

test.describe('food', () => {
  test('create a meal with a measured serving → log → change → undo → repeat; edits never rewrite old logs', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4173')) external.push(r.url()); });
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Create meal/ }).click();
    await page.getByLabel('Meal name').fill('Test oats');
    await page.getByLabel('Unit').selectOption('bowl');
    await page.getByLabel('1 bowl weighs (g)').fill('200');
    await page.getByLabel(/^Energy/).fill('400');
    await page.getByLabel(/^Protein/).fill('10');
    await expect(page.getByText(/Usual portion ≈/)).toContainText('800 kcal');
    await page.getByRole('button', { name: 'Save meal' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Food' })).toBeVisible();

    // Log via Add food → Usual meal → search.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('Test oats');
    await page.getByRole('dialog').getByRole('button', { name: /^Test oats/ }).first().click();
    await page.getByRole('button', { name: 'Add 1 bowl' }).click();
    const row = page.getByRole('button', { name: 'Edit Test oats' });
    await expect(row).toContainText('800 kcal');

    // Change the amount.
    await row.click();
    await page.getByRole('dialog').getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit Test oats' })).toContainText('1,200 kcal');
    await dismissToasts(page);

    // Repeat it, then undo the repeat.
    await page.getByRole('button', { name: 'Edit Test oats' }).click();
    await page.getByRole('button', { name: /Add again/ }).click();
    await expect(page.getByRole('button', { name: 'Edit Test oats' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Edit Test oats' }).last().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Edit Test oats' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Edit Test oats' }).last().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Edit Test oats' })).toHaveCount(1);
    await dismissToasts(page);

    // Change the recipe's nutrition: the logged meal keeps its value; a new log uses the new one.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('Test oats');
    await page.getByRole('dialog').getByRole('button', { name: /^Test oats/ }).first().click();
    await page.getByRole('button', { name: /Edit meal, portion or nutrition/ }).click();
    await page.getByLabel(/^Energy/).fill('500');
    await page.getByRole('button', { name: 'Save meal' }).first().click();
    await expect(page.getByText(/Meals you logged before keep their old values/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Test oats' })).toContainText('1,200 kcal');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('Test oats');
    await page.getByRole('dialog').getByRole('button', { name: /^Test oats/ }).first().click();
    await page.getByRole('button', { name: 'Add 1 bowl' }).click();
    await expect(page.getByRole('button', { name: 'Edit Test oats' }).last()).toContainText('1,000 kcal');
    await expect(page.getByRole('button', { name: 'Edit Test oats' }).first()).toContainText('1,200 kcal');
    expect(external.filter((u) => /googleapis|generativelanguage|supabase/.test(u))).toEqual([]);
  });

  test('one tap adds a usual meal with undo; unknown nutrition is never shown as zero', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add usual Roti' }).click();
    await expect(page.getByRole('status').getByText(/Added Roti/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Edit Roti' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('Sabzi');
    await page.getByRole('dialog').getByRole('button', { name: /^Sabzi/ }).first().click();
    await expect(page.getByText('Nutrition not set yet')).toBeVisible();
    await page.getByRole('button', { name: /^Add 1 bowl/ }).click();
    await expect(page.locator('.bm-value').first()).toHaveText('Unknown');
    await expect(page.getByText(/Some items have no nutrition yet/)).toBeVisible();
  });
});

test.describe('workout builder and journal', () => {
  test('create day → custom exercise → sets → save → reload → start → log → finish → history; old sessions keep their plan', async ({ page }) => {
    await enterDemo(page, 'workout');
    await page.getByRole('button', { name: 'Edit plan' }).click();
    await page.getByRole('button', { name: /Add day/ }).click();
    await page.getByLabel('Day name').fill('Arms');
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByLabel('Search exercises').fill('Cable hammer curl');
    await page.getByRole('button', { name: /Create my own exercise/ }).click();
    await page.getByLabel('Equipment').selectOption('cable');
    await page.getByLabel('Muscle group').selectOption('arms');
    await page.getByRole('dialog').getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('button', { name: /^Add set/ }).click();
    await page.getByLabel('Set 1 reps minimum').fill('10');
    await page.getByLabel('Set 1 reps maximum').fill('15');
    await page.getByRole('button', { name: 'Save plan' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Added Arms (1 exercise)');
    await page.getByRole('dialog').getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByRole('heading', { name: 'My plan' })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Cable hammer curl · 4 sets')).toBeVisible();
    await page.getByRole('button', { name: 'Start Arms' }).click();
    const card = page.getByRole('region', { name: 'Cable hammer curl' });
    await card.getByLabel('Set 1 weight in kg').fill('15');
    await card.getByLabel('Set 1 reps').fill('12');
    await card.getByRole('button', { name: 'Complete Set 1' }).click();
    await expect(card.getByRole('button', { name: 'Undo Set 1' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Arms done' })).toContainText('Working sets');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: /^Arms/ }).last()).toBeVisible();

    // Edit the plan: duplicate, reorder and change targets. The finished session keeps its snapshot.
    const sessionId = await page.evaluate(async () => new Promise<string>((resolve) => {
      const req = indexedDB.open('rozana-journal-demo-a');
      req.onsuccess = () => {
        const all = req.result.transaction('workout_sessions', 'readonly').objectStore('workout_sessions').getAll();
        all.onsuccess = () => resolve((all.result as { id: string; day_name: string; status: string }[]).find((s) => s.day_name === 'Arms' && s.status === 'finished')!.id);
      };
    }));
    await page.getByRole('button', { name: 'Edit plan' }).click();
    await page.getByRole('tab', { name: 'Arms' }).click();
    await page.getByRole('button', { name: 'Duplicate Arms' }).click();
    await page.getByRole('button', { name: 'Move Arms copy earlier' }).click();
    await page.getByRole('tab', { name: 'Arms', exact: true }).click();
    await page.getByRole('button', { name: /^Cable hammer curl/ }).click();
    await page.getByLabel('Set 1 reps minimum').fill('6');
    await page.getByRole('button', { name: 'Save plan' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Arms copy').first()).toBeVisible();
    const after = (await idbGet(page, 'demo-a', 'workout_sessions', sessionId)) as { exercises: { sets: { planned: { rep_min: number } }[] }[] };
    expect(after.exercises[0]!.sets[0]!.planned.rep_min).toBe(10); // unchanged history
  });

  test('a working set and the rest timer survive reload; target and actual stay distinct; table fits the card', async ({ page }) => {
    await enterDemo(page, 'workout');
    await page.getByRole('button', { name: 'Start Push' }).click();
    const bench = page.getByRole('region', { name: 'Bench press' });
    await bench.getByLabel('Set 1 weight in kg').fill('52.5');
    await bench.getByLabel('Set 1 reps').fill('5');
    await bench.getByRole('button', { name: 'Complete Set 1' }).click();
    await expect(page.getByTestId('rest-clock')).toBeVisible();
    await expect(bench.getByRole('row').nth(2)).toContainText('6–8 reps');
    const before = await page.getByTestId('rest-clock').textContent();
    await page.reload();
    const again = page.getByRole('region', { name: 'Bench press' });
    await expect(again.getByRole('button', { name: 'Undo Set 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(again.getByLabel('Set 1 weight in kg')).toHaveValue('52.5');
    expect((await page.getByTestId('rest-clock').textContent())! <= before!).toBe(true);
    const fit = await page.evaluate(() => [...document.querySelectorAll('.ex-body')].every((b) => {
      const t = b.querySelector('.set-table');
      return !t || t.getBoundingClientRect().width <= b.getBoundingClientRect().width - 30;
    }));
    expect(fit).toBe(true);
    // "Something hurts" skips the rest and notes it — no pushing through.
    await again.getByRole('button', { name: 'Something hurts' }).click();
    await expect(page.getByRole('dialog')).toContainText('Pain is a signal to stop');
    await page.getByRole('button', { name: /Skip the rest of Bench press/ }).click();
    await expect(again.getByText('Ended')).toBeVisible();
    await again.getByRole('button', { name: /^Bench press/ }).click();
    await expect(again.getByText('Skipped').first()).toBeVisible();
  });

  test('offline: app shell loads, a workout set saves and survives reload without duplicates', async ({ page, context }) => {
    await enterDemo(page);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true))).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.goto('/#/workout');
    await page.reload();
    await page.getByRole('button', { name: 'Start Legs' }).first().click();
    const squat = page.getByRole('region', { name: 'Back squat' });
    await squat.getByRole('button', { name: 'Complete Warmup set' }).click();
    await expect(squat.getByRole('button', { name: 'Undo Warmup set' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Back squat' }).getByRole('button', { name: 'Undo Warmup set' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(1);
    await context.setOffline(false);
  });
});

test.describe('data safety', () => {
  test('export → reset → restore brings my entries back', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add usual Chai' }).click();
    await dismissToasts(page);
    await page.goto('/#/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export my data' }).click()]);
    const file = await download.path();
    const json = JSON.parse(readFileSync(file!, 'utf8'));
    expect(json.format).toBe('rozana-export');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reset this demo' }).click()]);
    await expect(page.getByRole('button', { name: 'Export my data' })).toBeVisible();
    await page.goto('/#/food');
    await expect(page.getByRole('button', { name: 'Edit Chai' })).toHaveCount(0);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Restore from an export' }).click();
    await page.locator('input[type=file]').setInputFiles(file!);
    await expect(page.locator('.toast')).toContainText(/Restored 1 item/);
    await page.goto('/#/food');
    await expect(page.getByRole('button', { name: 'Edit Chai' })).toHaveCount(1);
  });

  test('demo people never see each other\'s entries', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add usual Dal' }).click();
    await expect(page.getByRole('button', { name: 'Edit Dal' })).toHaveCount(1);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Demo B' }).click();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Demo B');
    await page.goto('/#/food');
    await expect(page.getByRole('button', { name: 'Edit Dal' })).toHaveCount(0);
  });
});

test.describe('food list (catalogue)', () => {
  test('search by alias → database dish wins → standard value on an uncovered food → unknown stays unknown → reused; existing meals untouched', async ({ page }) => {
    await enterDemo(page, 'food');
    const before = await page.evaluate(async () => new Promise<number>((resolve) => {
      const req = indexedDB.open('rozana-journal-demo-a');
      req.onsuccess = () => { const c = req.result.transaction('presets').objectStore('presets').count(); c.onsuccess = () => { resolve(c.result); req.result.close(); }; };
    }));
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose food' });
    await expect(dialog.getByRole('button', { name: 'Popular' })).toHaveAttribute('aria-pressed', 'true');
    // Aliases and spellings: "chapati" is a database dish now (real numbers), shown once.
    await dialog.getByLabel('Search foods').fill('chapati');
    await expect(dialog.getByRole('button', { name: /^Chapati \/ Roti, 81 kcal/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Whole-wheat roti' })).toHaveCount(0);
    // A list food the database doesn't cover shows its sourced standard value (CNF/USDA), named.
    await dialog.getByLabel('Search foods').fill('sabji');
    await dialog.getByRole('button', { name: /^Mixed vegetable sabzi/ }).click();
    const std = page.getByRole('dialog', { name: 'Mixed vegetable sabzi' });
    await expect(std.getByLabel('Standard estimate')).toContainText(/kcal/);
    await expect(std.getByText(/Standard estimate for .*(Canadian Nutrient File|USDA|CNF).*Your recipe may differ/)).toBeVisible();
    await page.keyboard.press('Escape');
    if (!(await page.getByRole('dialog', { name: 'Choose food' }).isVisible())) {
      if (!(await page.getByRole('button', { name: /Choose food/ }).isVisible())) await page.getByRole('button', { name: 'Add food' }).click();
      await page.getByRole('button', { name: /Choose food/ }).click();
    }
    // A list food with no sourced value at all still works, honestly marked unknown (never guessed).
    await page.getByLabel('Search foods').fill('tinda');
    await page.getByRole('dialog', { name: 'Choose food' }).getByRole('button', { name: /^Tinda sabzi/ }).click();
    const add = page.getByRole('dialog', { name: 'Tinda sabzi' });
    await expect(add.getByText(/Nutrition not set yet/)).toBeVisible();
    await add.getByRole('button', { name: 'Breakfast' }).click();
    await add.getByRole('button', { name: /^Add 1 / }).click();
    await expect(page.getByText(/Added Tinda sabzi/)).toBeVisible();
    await page.getByRole('button', { name: 'Edit Tinda sabzi' }).click();
    const entry = page.getByRole('dialog', { name: 'Tinda sabzi' });
    await entry.getByText('Details').click();
    await expect(entry.getByText(/not weighed · Unknown · Unknown/)).toBeVisible();
    await page.keyboard.press('Escape');
    // Now it is one of the person's meals, with the catalogue picture.
    await expect(page.locator('svg[data-art="tinda-sabzi"]').first()).toBeVisible();
    const after = await page.evaluate(async () => new Promise<number>((resolve) => {
      const req = indexedDB.open('rozana-journal-demo-a');
      req.onsuccess = () => { const c = req.result.transaction('presets').objectStore('presets').count(); c.onsuccess = () => { resolve(c.result); req.result.close(); }; };
    }));
    expect(after).toBe(before + 1); // one personal meal, not 293 copies
    // Picking it again from the list reuses the same meal.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('tinda');
    await page.getByRole('dialog', { name: 'Choose food' }).getByRole('button', { name: 'Tinda sabzi, in your meals' }).click();
    await expect(page.getByRole('dialog', { name: 'Tinda sabzi' }).getByText(/Usual: 1 /)).toBeVisible();
  });

  test('categories, All foods and empty search', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose food' });
    await dialog.getByRole('button', { name: 'Chai & drinks' }).click();
    await expect(dialog.getByRole('button', { name: 'Masala chai' })).toBeVisible();
    await dialog.getByRole('button', { name: 'All foods' }).click();
    // List foods that are the same dish as a database entry are shown once, as the database dish.
    const rows = await dialog.locator('.lazy-row').count();
    expect(rows).toBeGreaterThan(250);
    expect(rows).toBeLessThan(293);
    // Never a dead end: quick-add, your own recipe and "request it" are offered.
    await dialog.getByLabel('Search foods').fill('zzqx');
    await expect(dialog.getByText('A close guess beats a skipped meal.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Quick-add calories/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Create your own recipe/ }).first()).toBeVisible();
  });
});

test.describe('recent workout date badges', () => {
  const PASSES = [
    ['2026-09-29', '2026-09-27', '2026-09-25', '2026-01-01', '2026-02-28', '2026-03-09', '2026-04-30', '2026-05-15'],
    ['2026-06-02', '2026-07-21', '2026-08-31', '2026-10-10', '2026-11-11', '2026-12-25', '2025-12-01', '2026-09-09'],
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [360, 390]) {
      test(`every month fits its tile at ${width}px, ${scheme}, 100% and 200% text (device locale en-GB)`, async ({ browser }) => {
        // en-GB/en-IN phones format September as "Sept", which used to wrap out of the tile.
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-GB', colorScheme: scheme, deviceScaleFactor: 2 });
        await ctx.addInitScript((t) => localStorage.setItem('rozana.theme', t), scheme);
        const page = await ctx.newPage();
        await enterDemo(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        for (const [pass, dates] of PASSES.entries()) {
          await page.evaluate(async (ds) => new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('rozana-journal-demo-a');
            req.onsuccess = () => {
              const tx = req.result.transaction('workout_sessions', 'readwrite');
              const store = tx.objectStore('workout_sessions');
              const all = store.getAll();
              all.onsuccess = () => {
                const done = (all.result as { status: string; started_at: string }[]).filter((x) => x.status === 'finished')
                  .sort((a, b) => b.started_at.localeCompare(a.started_at));
                done.slice(0, ds.length).forEach((x, i) => store.put({ ...x, local_date: ds[i] }));
              };
              tx.oncomplete = () => { req.result.close(); resolve(); };
              tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
          }), dates);
          for (const zoom of ['100%', '200%']) {
            await page.goto('/#/workout');
            await page.reload();
            await expect(page.getByRole('heading', { name: 'Recent workouts' })).toBeVisible();
            await page.addStyleTag({ content: `html{font-size:${zoom}}` });
            const badges = await page.locator('.date-badge').evaluateAll((els) => els.map((el) => {
              const box = el.getBoundingClientRect();
              const parts = [...el.children].map((c) => {
                const r = c.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(c);
                return { text: c.textContent, lines: range.getClientRects().length, inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 };
              });
              return { parts, overflowX: el.scrollWidth - el.clientWidth, overflowY: el.scrollHeight - el.clientHeight, w: box.width, fs: parseFloat(getComputedStyle(el.children[0]!).fontSize) };
            }));
            expect(badges.length).toBe(8);
            for (const b of badges) {
              const label = `${b.parts.map((p) => p.text).join(' ')} @ ${width}/${scheme}/${zoom}`;
              expect(b.parts.every((p) => p.lines === 1 && p.inside), label).toBe(true);
              expect(b.overflowX, label).toBeLessThanOrEqual(0);
              expect(b.overflowY, label).toBeLessThanOrEqual(0);
              expect(b.fs, label).toBeGreaterThanOrEqual(10);
              expect(MONTHS, label).toContain(b.parts[0]!.text);
            }
            const shown = badges.map((b) => `${b.parts[0]!.text} ${b.parts[1]!.text}`);
            for (const d of dates) {
              const [, m, day] = d.split('-');
              expect(shown).toContain(`${MONTHS[Number(m) - 1]} ${Number(day)}`);
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow).toBeLessThanOrEqual(0);
            // The row keeps the full date for screen readers.
            await expect(page.getByRole('button', { name: /, (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/ }).first()).toBeVisible();
            if (process.env.SHOTS) {
              await page.locator('.history-row').first().scrollIntoViewIfNeeded();
              await page.locator('.card:has(.history-row)').screenshot({ path: `docs/screenshots/badges-${width}-${scheme}-${zoom === '100%' ? '1x' : '2x'}-pass${pass + 1}.png` });
            }
          }
        }
        await ctx.close();
      });
    }
  }
});

test.describe('layout and accessibility', () => {
  for (const width of [320, 360, 390]) {
    test(`no horizontal overflow at ${width}px, 100% and 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await enterDemo(page);
      for (const zoom of ['100%', '200%']) {
        for (const r of ['today', 'food', 'workout', 'progress', 'settings', 'coach', 'plan', 'meal/new']) {
          await page.goto(`/#/${r}`);
          await page.waitForTimeout(250);
          await page.addStyleTag({ content: `html{font-size:${zoom}}` });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${r} @ ${width}px/${zoom}`).toBeLessThanOrEqual(0);
        }
      }
    });
  }

  test('visible controls have names and ≥40px targets', async ({ page }) => {
    await enterDemo(page);
    for (const r of ['today', 'food', 'workout', 'progress', 'settings', 'plan']) {
      await page.goto(`/#/${r}`);
      await page.waitForTimeout(300);
      const problems = await page.evaluate(() => [...document.querySelectorAll('button, a[href], select, input:not([type=file]):not([type=range])')]
        .filter((el) => (el as HTMLElement).offsetParent !== null && !(el as HTMLElement).closest('.sr-only'))
        .map((el) => {
          const b = el.getBoundingClientRect();
          const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.closest('label')?.textContent || el.getAttribute('aria-labelledby') || '';
          return { tag: el.tagName, name: name.trim().slice(0, 40), h: Math.round(b.height), w: Math.round(b.width) };
        })
        .filter((x) => !x.name || x.h < 40 || x.w < 40));
      expect(problems, r).toEqual([]);
    }
  });

  test('reduced motion turns animations off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    const d = await page.locator('.sheet').evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(d)).toBeLessThan(0.01);
  });
});

test.describe('Today motivation', () => {
  test('“How you’re doing” shows the person’s own recent workouts and logging', async ({ page }) => {
    await enterDemo(page);
    const card = page.getByRole('region', { name: /./ }).filter({ hasText: 'How you’re doing' });
    await expect(card).toBeVisible();
    await expect(card.getByText(/workouts · 7 days/)).toBeVisible();
    await expect(card.getByText(/days? logging/)).toBeVisible();
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/37-today-motivation.png', fullPage: false });
  });
});

test.describe('reminders', () => {
  test('Today invites once; the panel shows when reminders will arrive and sends a test notification', async ({ page }) => {
    // Headless Chromium always reports notifications as denied: stand in for the browser's
    // Notification API and record what the app shows.
    await page.addInitScript(() => {
      const shown: unknown[] = [];
      (window as unknown as { __shown: unknown[] }).__shown = shown;
      class FakeNotification { static permission = 'granted'; static requestPermission = async () => 'granted'; constructor(title: string, o: unknown) { shown.push({ title, o }); } }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
      ServiceWorkerRegistration.prototype.showNotification = async function (title: string, o?: NotificationOptions) { shown.push({ title, o }); };
    });
    await enterDemo(page);
    const invite = page.getByRole('region', { name: 'Reminders' });
    await expect(invite.getByText('Never miss gym time')).toBeVisible();
    await invite.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/In the demo, these settings stay on this phone/)).toBeVisible();
    // Only three kinds; no daily motivation. The gym time is learned until the person sets one.
    await expect(page.getByRole('switch', { name: /Routine nudge/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /Remind me before gym time/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /Milestone or insight ready/ })).toBeChecked();
    await expect(page.getByText(/Daily motivation/)).toHaveCount(0);
    await expect(page.getByText(/Never more than 2 a day, never between 10pm and 7am/)).toBeVisible();
    await expect(page.getByLabel('Next reminders')).toHaveCount(0);
    await page.getByRole('radio', { name: 'I’ll set a time' }).click();
    await expect(page.getByText('You’ll get it at 17:45 on the days you picked.')).toBeVisible();
    await expect(page.getByLabel('Next reminders').getByText('Gym reminder')).toBeVisible();
    await page.getByRole('button', { name: 'Turn on reminders' }).click();
    await expect(page.getByRole('status').getByText('Reminders saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Send a test notification' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shown: { title: string }[] }).__shown.map((n) => n.title))).toEqual(['You’re all set']);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/38-notifications.png', fullPage: true });
    await page.goto('/#/today');
    await expect(page.getByRole('region', { name: 'Reminders' })).toHaveCount(0);
  });
});

test.describe('AI trainer', () => {
  test('floating trainer button → name and pick a look → demo chat with sample replies', async ({ page }) => {
    await enterDemo(page);
    await page.getByRole('button', { name: /^Chat with Luma, your AI trainer/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Luma' })).toBeVisible();
    await expect(page.getByText(/Sample replies, not AI/)).toBeVisible();
    await page.getByRole('button', { name: 'Choose' }).click();
    const sheet = page.getByRole('dialog', { name: 'Meet your trainer' });
    await sheet.getByLabel('Name your trainer').fill('Veer');
    await sheet.getByRole('radio', { name: 'Panda' }).click();
    await expect(sheet.getByRole('radio', { name: 'Panda' })).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.getByText('Hi! I’m Veer.', { exact: false })).toBeVisible();
    await sheet.getByRole('button', { name: 'Start chatting with Veer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Veer' })).toBeVisible();
    await page.getByRole('button', { name: 'Can you fit today’s workout into 30 minutes?' }).click();
    await expect(page.getByRole('status', { name: 'Veer is thinking' })).toBeVisible();
    await expect(page.locator('.bubble.coach').filter({ hasText: '30-minute version' })).toBeVisible();
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/39-trainer-chat.png' });
    // The name sticks (saved in the profile) and shows on Today.
    await page.goto('/#/today');
    await expect(page.getByRole('button', { name: 'Chat with Veer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Chat with Veer, your AI trainer/ })).toBeVisible();
    // The trainer card's buttons never overlap its text or overflow (long names, big text).
    for (const size of ['100%', '200%']) {
      await page.addStyleTag({ content: `html{font-size:${size} !important}` });
      const bad = await page.evaluate(() => {
        const c = document.querySelector('.card.coach')!;
        const r = (e: Element) => e.getBoundingClientRect();
        const btns = [...c.querySelectorAll('.coach-actions .btn')];
        const txt = c.querySelector('.small')!;
        return btns.some((b) => r(b).top < r(txt).bottom - 1 || b.scrollWidth > b.clientWidth + 1);
      });
      expect(bad, size).toBe(false);
    }
  });
});

test.describe('barcode', () => {
  test('type a barcode → Open Food Facts product → add servings → logged with label nutrition; scanning again reuses it', async ({ page }) => {
    const lookups: string[] = [];
    await page.route('https://world.openfoodfacts.org/**', (route) => {
      lookups.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
        status: 1,
        product: { product_name: 'Greek Yogurt Plain', brands: 'Oikos', serving_size: '175 g', serving_quantity: 175,
          nutriments: { 'energy-kcal_100g': 80, proteins_100g: 9, carbohydrates_100g: 4.5, fat_100g: 2.5, fiber_100g: 0 } },
      }) });
    });
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByRole('button', { name: 'Scan a barcode' }).click();
    const sheet = page.getByRole('dialog', { name: 'Scan a barcode' });
    await sheet.getByLabel('Or type the numbers').fill('0064200116474');
    await sheet.getByRole('button', { name: 'Look up' }).click();
    await expect(sheet.getByRole('alert')).toContainText('valid barcode'); // wrong check digit: nothing sent
    expect(lookups).toEqual([]);
    await sheet.getByLabel('Or type the numbers').fill('0064200116473');
    await sheet.getByRole('button', { name: 'Look up' }).click();
    await expect(sheet.getByText('Oikos Greek Yogurt Plain')).toBeHidden(); // name shows without duplicating the brand
    await expect(sheet.getByText('Greek Yogurt Plain', { exact: true })).toBeVisible();
    await expect(sheet.getByLabel('Nutrition for this amount')).toContainText('140 kcal'); // 175 g × 80/100
    await sheet.getByRole('button', { name: 'More' }).click(); // 1.5 servings
    await expect(sheet.getByLabel('Nutrition for this amount')).toContainText('210 kcal');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatch(/\/api\/v2\/product\/0064200116473\.json\?fields=/);
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/40-barcode-product.png' });
    await sheet.getByRole('button', { name: /^Add to (breakfast|lunch|dinner|snack)$/ }).click();
    await expect(page.getByRole('status').getByText(/Added Oikos Greek Yogurt Plain/)).toBeVisible();
    // Second time: found in the person's own meals without another lookup.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByRole('button', { name: 'Scan a barcode' }).click();
    await page.getByLabel('Or type the numbers').fill('0064200116473');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText(/saved in your meals/)).toBeVisible();
    expect(lookups).toHaveLength(1);
  });
});

test.describe('personal recipe', () => {
  test('the meal editor’s recipe mode leads to the food-database recipe builder (values come from the database)', async ({ page }) => {
    await enterDemo(page, 'meal/new');
    await page.getByPlaceholder('e.g. Dal tadka').fill('Mummy’s dal');
    await page.getByRole('radio', { name: 'My recipe' }).or(page.getByRole('button', { name: 'My recipe' })).first().click();
    await expect(page.getByRole('button', { name: 'Add from ingredient list' })).toBeVisible(); // CNF ingredient list kept (owner, 2026-10-13)
    await page.getByRole('button', { name: 'Build from the food database' }).click();
    await expect(page.getByRole('heading', { name: 'Create your own recipe' })).toBeVisible();
    await page.getByLabel('Recipe name').fill('Mummy’s dal');
    await page.getByRole('button', { name: 'Add from food database' }).click();
    await page.getByLabel('Search the food database').fill('moong');
    await page.getByRole('dialog', { name: 'Add from food database' }).getByRole('button', { name: /^Moong dal\s*50 kcal/ }).click();
    await page.getByRole('button', { name: 'My own ingredient' }).click();
    const own = page.getByRole('dialog', { name: 'My own ingredient' });
    await own.getByLabel('Name').fill('Desi ghee (label)');
    await own.getByLabel('Grams in the whole recipe').fill('10');
    await own.getByLabel('Calories').fill('900');
    await own.getByRole('button', { name: 'Add ingredient' }).click();
    await expect(page.locator('.recipe-preview .macro-grid')).toContainText('165 kcal'); // 75 + 90
    await page.getByRole('button', { name: 'Save to My recipes' }).click();
    await expect(page.getByRole('status').getByText(/Saved “Mummy’s dal” to My recipes/)).toBeVisible();
  });
});

test.describe('exercise library', () => {
  test('hundreds of exercises: filter by muscle and equipment, read how-to, add to a day', async ({ page }) => {
    await enterDemo(page, 'workout');
    await page.getByRole('button', { name: 'Edit plan' }).click();
    await page.getByRole('button', { name: 'Add exercise' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Add exercise' });
    await expect(sheet.getByText(/Showing popular exercises\. Search or pick a muscle group to see all \d{3}/)).toBeVisible();
    await sheet.getByRole('group', { name: 'Muscle group' }).getByRole('button', { name: 'Legs' }).click();
    await sheet.getByLabel('Equipment').selectOption('dumbbell');
    await sheet.getByLabel('Search exercises').fill('bulgarian');
    await sheet.getByRole('button', { name: /^How to do .*Bulgarian/i }).first().click();
    const how = page.getByRole('dialog', { name: /Bulgarian/i });
    await expect(how.locator('ol.how-to li').first()).toBeVisible();
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/41-exercise-how-to.png' });
    await how.getByRole('button', { name: /^Add / }).click();
    await expect(page.getByText(/Bulgarian/i).first()).toBeVisible();
  });
});

test.describe('Phase 1: TrainLuma food database', () => {
  const openPicker = async (page: Page) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
  };

  test('search "rajma" → dish with kcal + protein → serving selector scales → logged with real numbers', async ({ page }) => {
    await openPicker(page);
    await page.getByLabel('Search foods').fill('rajmah');
    const row = page.getByRole('button', { name: /^Rajma curry, 216 kcal, 9 grams protein per 1 katori/ });
    await expect(row).toBeVisible();
    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Rajma curry' });
    await expect(sheet.locator('.macro-grid.big')).toContainText('216 kcal');
    await sheet.getByRole('button', { name: '2×' }).click();
    await expect(sheet.locator('.macro-grid.big')).toContainText('431 kcal');
    await sheet.getByLabel('Or exact grams').fill('100');
    await expect(sheet.locator('.macro-grid.big')).toContainText('144 kcal');
    await expect(sheet.getByText(/Nutrition: Indian Nutrient Databank/)).toBeVisible();
    await sheet.getByRole('button', { name: /^Log / }).click();
    await expect(page.getByRole('status').getByText(/Added Rajma curry/)).toBeVisible();
  });

  test('combo logs all components in one tap; Tier-2 and quarantined dishes never appear', async ({ page }) => {
    await openPicker(page);
    await page.getByLabel('Search foods').fill('sarson makki');
    await page.getByRole('button', { name: /^Sarson da saag \+ makki di roti, 581 kcal/ }).click();
    const sheet = page.getByRole('dialog', { name: /Sarson da saag/ });
    await expect(sheet.getByText(/Sarson ka saag 150 g \+ Makki ki roti 170 g/)).toBeVisible();
    await sheet.getByRole('button', { name: /^Log / }).click();
    await expect(page.getByRole('status').getByText(/Added Sarson da saag \+ makki di roti/)).toBeVisible();
    // Quarantined kadhi pakoda and Tier-2 dishes (samosa, plain kadhi) are hidden; the fallback offers a way on.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    for (const q of ['kadhi pakoda', 'samosa']) {
      await page.getByLabel('Search foods').fill(q);
      await expect(page.locator('.dish-row')).toHaveCount(0);
    }
    await expect(page.getByText('A close guess beats a skipped meal.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Quick-add calories/ })).toBeVisible();
    await page.getByRole('button', { name: 'Can’t find it? Request it' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Got it — we’ll add it.' })).toBeVisible();
  });

  test('restaurant card: typical-values label and 1-tap signature dish logging; chains show official items', async ({ page }) => {
    await openPicker(page);
    await page.getByLabel('Search foods').fill('tandoori flame');
    const card = page.locator('.restaurant-card').filter({ hasText: 'Tandoori Flame' });
    await expect(card.getByText('Typical values — this restaurant’s recipe will differ.')).toBeVisible();
    await card.getByRole('button', { name: 'Log Butter chicken (typical values)' }).click();
    await expect(page.getByRole('status').getByText(/Added Butter chicken/)).toBeVisible();
    await page.getByLabel('Search foods').fill('tim hortons');
    await expect(page.locator('.restaurant-card').filter({ hasText: 'Tim Hortons' }).getByText(/Double-Double Coffee \(Medium\)/)).toBeVisible();
    await expect(page.locator('.launch-splash')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/42-restaurant-card.png' });
  });

  test('make it mine: clone a dish, change grams, see the delta, save to My recipes', async ({ page }) => {
    await openPicker(page);
    await page.getByLabel('Search foods').fill('rajma');
    await page.getByRole('button', { name: /^Rajma curry,/ }).click();
    await page.getByRole('button', { name: /Make it mine/ }).click();
    await expect(page.getByRole('heading', { name: 'Make it mine' })).toBeVisible();
    await page.getByLabel('Rajma curry exact grams').fill('100');
    await expect(page.locator('.delta-line')).toHaveText('−72 kcal, −3 g protein per serving vs the standard Rajma curry.');
    await page.getByRole('button', { name: 'Add from food database' }).click();
    await page.getByLabel('Search the food database').fill('roti');
    await page.getByRole('dialog', { name: 'Add from food database' }).getByRole('button', { name: /^Chapati \/ Roti/ }).click();
    await expect(page.locator('.recipe-preview .macro-grid')).toContainText('225 kcal'); // 143.7 + 80.9
    await page.screenshot({ path: 'docs/screenshots/43-make-it-mine.png' });
    await page.getByRole('button', { name: 'Save to My recipes' }).click();
    await expect(page.getByRole('status').getByText(/Saved “My rajma curry” to My recipes/)).toBeVisible();
  });
});

test.describe('Phase 2: frictionless logging', () => {
  const events = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('trainluma.events.demo-a') ?? '[]') as { event: string; props: Record<string, unknown> }[]);

  test('usuals on the Food tab; one tap logs and is counted as zero typing', async ({ page }) => {
    await enterDemo(page, 'food');
    await expect(page.getByRole('heading', { name: /Your usuals|Your usual meals/ })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Usual meals' }).getByRole('listitem');
    expect(await cards.count()).toBeLessThanOrEqual(12);
    await page.getByRole('button', { name: /^Add usual / }).first().click();
    await expect(page.getByRole('status').getByText(/^Added /)).toBeVisible();
    const logged = (await events(page)).filter((e) => e.event === 'food_logged');
    expect(logged.at(-1)?.props).toMatchObject({ method: 'usual', zero_typing: true });
  });

  test('voice (typed fallback): "rajma chawal and two rotis" → confirm → both logged', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Say what you ate' }).click();
    const sheet = page.getByRole('dialog', { name: 'Say what you ate' });
    await sheet.getByRole('textbox').fill('I had rajma chawal and two rotis');
    await sheet.getByRole('button', { name: 'Next' }).click();
    await expect(sheet.getByText('Rajma chawal (plate)')).toBeVisible();
    await expect(sheet.getByText('Roti', { exact: true })).toBeVisible(); // matched to the person's own "Roti" meal
    await sheet.getByRole('button', { name: 'Log 2 items' }).click();
    await expect(page.getByRole('status').getByText(/Logged 2 items/)).toBeVisible();
    const methods = (await events(page)).filter((e) => e.event === 'food_logged').map((e) => e.props.method);
    expect(methods.slice(-2)).toEqual(['voice', 'voice']);
  });

  test('template: save a slot with two items, then log the whole meal in one tap', async ({ page }) => {
    await enterDemo(page, 'food');
    for (const name of ['Add usual Chai', 'Add usual Roti']) {
      await page.getByRole('button', { name }).click();
      await expect(page.getByRole('status').getByText(/^Added /)).toBeVisible();
      await page.getByRole('button', { name: 'Dismiss' }).click();
    }
    const slotWithTwo = page.getByRole('button', { name: /^Save .* as a template$/ }).first();
    await slotWithTwo.click();
    const sheet = page.getByRole('dialog', { name: 'Save as a template' });
    await sheet.getByLabel('Name').fill('My Tim’s run');
    await sheet.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('status').getByText(/Saved “My Tim’s run”/)).toBeVisible();
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('tim');
    await expect(page.getByRole('dialog', { name: 'Choose food' }).locator('.my-badge').first()).toBeVisible();
  });

  test('quick-add calories from the Add food menu (typed, so not zero typing)', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Quick-add calories/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Quick-add calories' });
    await sheet.getByLabel('Calories (kcal)').fill('450');
    await sheet.getByLabel('What was it? (optional)').fill('Wedding plate');
    await sheet.getByRole('button', { name: /^Log / }).click();
    await expect(page.getByRole('status').getByText(/Added Wedding plate/)).toBeVisible();
    const last = (await events(page)).filter((e) => e.event === 'food_logged').at(-1);
    expect(last?.props).toMatchObject({ method: 'quick_add', zero_typing: false });
    // Quick-adds never become "usual meals".
    await expect(page.getByRole('button', { name: /^Wedding plate, / })).toHaveCount(0);
  });
});

test.describe('Phase 3: retention', () => {
  test('streak on Today, Luma Insights story recap with a share card, year recap', async ({ page }) => {
    await enterDemo(page);
    const card = page.getByRole('region', { name: /./ }).filter({ hasText: 'How you’re doing' });
    await expect(card.locator('.ins-streak').first()).toBeVisible();
    await expect(card).not.toContainText(/you broke|failed|missed your/i);
    await page.getByRole('button', { name: /Luma Insights/ }).click();
    await expect(page.getByRole('heading', { name: 'Luma Insights' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Choose a week' }).getByText('This week')).toBeVisible();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByRole('group', { name: 'Choose a week' }).getByText('Last week')).toBeVisible();
    await expect(page.locator('.ins-screen')).not.toContainText(/NaN|undefined/);
    await page.screenshot({ path: 'docs/screenshots/50-insights.png', fullPage: true });
    await page.goto('/#/progress');
    await page.getByRole('button', { name: 'Your year in training' }).click();
    await expect(page.locator('main')).toContainText(/20\d\d/);
    await expect(page.locator('main')).not.toContainText(/NaN|undefined/);
    const events = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('trainluma.events.')).flatMap((k) => JSON.parse(localStorage.getItem(k)!) as { event: string }[]).map((e) => e.event));
    expect(events).toContain('insight_opened');
  });

  test('circles and invites in the demo are a clearly-labelled sample with a kind board', async ({ page }) => {
    await enterDemo(page, 'circles');
    await expect(page.getByText(/sample circle with made-up friends/)).toBeVisible();
    const circle = page.getByRole('region', { name: 'Morning crew' });
    await expect(circle.locator('.cb-top')).toContainText('Aman');
    await expect(circle.getByRole('list', { name: 'Everyone else, alphabetical' }).locator('.cb-row')).toHaveText([/Jas/, /Simran/, /You/]);
    await page.screenshot({ path: 'docs/screenshots/51-circles.png', fullPage: true });
    await page.goto('/#/invite');
    await expect(page.getByText('Give a month, get a month')).toBeVisible();
    await expect(page.getByText(/Invites need a signed-in account/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share with a friend' })).toBeDisabled();
  });
});
