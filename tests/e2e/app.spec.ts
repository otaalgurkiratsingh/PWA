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
    await expect(page.locator('.bm-value').first()).toHaveText('Not logged');
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
  test('search by alias → add a list food → logged with unknown nutrition → appears in usual meals; existing meals untouched', async ({ page }) => {
    await enterDemo(page, 'food');
    const before = await page.evaluate(async () => new Promise<number>((resolve) => {
      const req = indexedDB.open('rozana-journal-demo-a');
      req.onsuccess = () => { const c = req.result.transaction('presets').objectStore('presets').count(); c.onsuccess = () => { resolve(c.result); req.result.close(); }; };
    }));
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose food' });
    await expect(dialog.getByRole('button', { name: 'Popular' })).toHaveAttribute('aria-pressed', 'true');
    // Aliases and spellings
    await dialog.getByLabel('Search foods').fill('chapati');
    await expect(dialog.getByRole('button', { name: 'Whole-wheat roti' })).toBeVisible();
    await dialog.getByLabel('Search foods').fill('sabji');
    await expect(dialog.getByRole('button', { name: 'Mixed vegetable sabzi' })).toBeVisible();
    await dialog.getByLabel('Search foods').fill('daal makhani');
    await dialog.getByRole('button', { name: 'Dal makhani' }).click();
    const add = page.getByRole('dialog', { name: 'Dal makhani' });
    await expect(add.getByText(/Nutrition not set yet/)).toBeVisible();
    await add.getByRole('button', { name: 'Breakfast' }).click();
    await add.getByRole('button', { name: 'Add 1 bowl' }).click();
    await expect(page.getByText(/Added Dal makhani/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Dal makhani' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Dal makhani' }).click();
    const entry = page.getByRole('dialog', { name: 'Dal makhani' });
    await entry.getByText('Details').click();
    await expect(entry.getByText(/not weighed · Unknown · Unknown/)).toBeVisible();
    await page.keyboard.press('Escape');
    // Now it is one of the person's meals, with the catalogue picture.
    await expect(page.getByRole('button', { name: /^Dal makhani, 1 bowl/ })).toBeVisible();
    await expect(page.locator('svg[data-art="dal-makhani"]').first()).toBeVisible();
    const after = await page.evaluate(async () => new Promise<number>((resolve) => {
      const req = indexedDB.open('rozana-journal-demo-a');
      req.onsuccess = () => { const c = req.result.transaction('presets').objectStore('presets').count(); c.onsuccess = () => { resolve(c.result); req.result.close(); }; };
    }));
    expect(after).toBe(before + 1); // one personal meal, not 293 copies
    // Picking it again from the list reuses the same meal.
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    await page.getByLabel('Search foods').fill('makhani');
    await page.getByRole('dialog', { name: 'Choose food' }).getByRole('button', { name: 'Dal makhani, in your meals' }).click();
    await expect(page.getByRole('dialog', { name: 'Dal makhani' }).getByText(/Usual: 1 bowl/)).toBeVisible();
  });

  test('categories, All foods and empty search', async ({ page }) => {
    await enterDemo(page, 'food');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('button', { name: /Choose food/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose food' });
    await dialog.getByRole('button', { name: 'Chai & drinks' }).click();
    await expect(dialog.getByRole('button', { name: 'Masala chai' })).toBeVisible();
    await dialog.getByRole('button', { name: 'All foods' }).click();
    await expect(dialog.locator('.lazy-row')).toHaveCount(293);
    await dialog.getByLabel('Search foods').fill('zzqx');
    await expect(dialog.getByText(/No foods match/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create a meal' })).toBeVisible();
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
    await page.screenshot({ path: 'docs/screenshots/37-today-motivation.png', fullPage: false });
  });
});
