import { expect, test, type Page } from '@playwright/test';
import { MockSupabase, type MockUser } from './mockSupabase';

/** With SHOTS=1, also save review screenshots of auth/coach states to docs/screenshots. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `docs/screenshots/390-${name}.png` });
};

/** Auth harness build (fake Supabase URL; all backend calls answered by MockSupabase). */
const OWNER: MockUser = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', membership: 'active' };
const PENDING: MockUser = { id: '22222222-2222-4222-8222-222222222222', email: 'pending@example.com', membership: 'none' };

async function signIn(page: Page, email: string, code = '123456') {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function onboard(page: Page, opts: { ai?: boolean } = {}) {
  await page.getByLabel('What should we call you?').fill('Gurkirat');
  await page.getByRole('checkbox', { name: /18 or older/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // basics
  await page.getByLabel('Energy (kcal/day)').fill('2300');
  await page.getByLabel('Protein (g/day)').fill('130');
  await page.getByRole('button', { name: 'Continue' }).click(); // targets
  await page.getByRole('button', { name: /^Dal/ }).click();
  await page.getByRole('button', { name: /^Roti/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // meals
  await page.getByRole('button', { name: /Start from a simple 2-day plan/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // workouts
  await page.getByRole('button', { name: /Back up to my private cloud/ }).click();
  if (opts.ai) await page.getByRole('switch', { name: /AI help/ }).click();
  await page.getByRole('button', { name: 'Start using Rozana' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
}

test('email code sign-in: wrong code, correct code, onboarding, backup, session restore, sign-out', async ({ page }) => {
  const sb = new MockSupabase([OWNER, PENDING]);
  await sb.install(page);
  const provider: string[] = [];
  page.on('request', (r) => { if (/googleapis|generativelanguage/.test(r.url())) provider.push(r.url()); });

  await page.goto('/');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(`We sent a code to ${OWNER.email}`)).toBeVisible();
  expect(sb.requests.find((r) => r.path === '/auth/v1/otp')!.body).toMatchObject({ email: OWNER.email, create_user: false });
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();

  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('didn’t work or has expired');
  await shot(page, '20-signin-code-error');

  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible(); // onboarding, not demo data
  await shot(page, '21-onboarding');
  await onboard(page);

  // Starter meals exist with nutrition unknown, the template plan exists, nothing from the demo leaked in.
  await page.goto('/#/food');
  await expect(page.getByRole('button', { name: /^Dal, 1 bowl/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Boiled eggs/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add usual Dal' }).click();
  await page.goto('/#/workout');
  await expect(page.getByText('Full body A').first()).toBeVisible();

  // Backup happened through sync_push with this user as owner, and consent was recorded.
  await expect.poll(() => sb.docs.size, { timeout: 10_000 }).toBeGreaterThan(3);
  for (const [k, d] of sb.docs) {
    expect(k.startsWith(OWNER.id)).toBe(true);
    expect((d.body as { owner_id: string }).owner_id).toBe(OWNER.id);
  }
  expect(sb.consent).toEqual(expect.arrayContaining([{ consent_type: 'cloud_backup', granted: true, notice_version: expect.any(String) }]));
  await page.goto('/#/settings');
  await expect(page.getByText(/Backed up/).first()).toBeVisible({ timeout: 10_000 });

  // Session restore: reload goes straight to the app; the welcome screen never shows.
  // Record whether the welcome heading is EVER rendered during the reload.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.innerText.includes('Your routine, made simpler')) (window as unknown as { __sawWelcome: boolean }).__sawWelcome = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' }).or(page.getByRole('button', { name: /Back/ })).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sawWelcome?: boolean }).__sawWelcome ?? false)).toBe(false);

  // Sign out (everything is backed up) → welcome; signing in again restores the same journal.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your routine, made simpler' })).toBeVisible();
  await signIn(page, OWNER.email);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(provider).toEqual([]);
});

test('an authenticated but unapproved account is refused (no journal, no onboarding)', async ({ page }) => {
  const sb = new MockSupabase([OWNER, PENDING]);
  await sb.install(page);
  await signIn(page, PENDING.email);
  await expect(page.getByRole('heading', { name: 'This account isn’t active' })).toBeVisible();
  await shot(page, '22-not-member');
  await expect(page.getByText(/hasn’t been added to Rozana/)).toBeVisible();
  expect(sb.requests.filter((r) => r.path.includes('sync_push'))).toEqual([]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Your routine, made simpler' })).toBeVisible();
});

test('an address that is not invited gets the same neutral message (no account discovery)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('stranger@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/If this email is on the invite list/)).toBeVisible();
});

test('coach: real backend calls with the session token only; review sections; accepting a proposal updates targets', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiResponses.coach_question = { status: 'ok', operation: 'coach_question', model_id: 'gemini-3.8-flash', answer: { answer: 'You logged 1 workout this week.', evidence_refs: [], follow_up_questions: [], safety_flags: [] } };
  sb.aiResponses.weekly_review = {
    status: 'ok', operation: 'weekly_review',
    review: {
      id: 'rev-1', created_at: new Date().toISOString(), data_period: { from: '2026-10-03', to: '2026-10-09' },
      data_completeness: { days_with_meals: 1, days_marked_complete: 0, weight_points: 0, sessions: 0 },
      output: { observations: [{ text: 'You logged dal on 9 Oct.', evidence_refs: ['day:2026-10-09'] }], suggestions: [{ kind: 'habit', text: 'Log dinner too.', rationale: 'Partial days.', uncertainty: 'low' }], missing_information: ['No weigh-ins this week.'], questions: [], proposed_target_change: null, safety_flags: [] },
      proposal_id: null, model_id: 'gemini-3.8-flash', prompt_version: 'p',
    },
  };
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboard(page, { ai: true });
  await page.goto('/#/coach');
  await page.getByRole('button', { name: /Get this week’s review/ }).click();
  await expect(page.getByText('What your logs show')).toBeVisible();
  await expect(page.getByText('You logged dal on 9 Oct.')).toBeVisible();
  await expect(page.getByText('No weigh-ins this week.')).toBeVisible();
  await shot(page, '23-coach-review');
  const aiCall = sb.requests.find((r) => r.path === '/functions/v1/ai')!;
  expect(aiCall.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(JSON.stringify(aiCall)).not.toMatch(/AIza|GEMINI|x-goog-api-key/i);
  expect(aiCall.body).toMatchObject({ operation: 'weekly_review', operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });

  await page.getByRole('button', { name: 'How consistent was I this week?' }).click();
  await expect(page.getByText('You logged 1 workout this week.')).toBeVisible();

  // A stored proposal: accept → decision RPC and new targets; nothing changed before acceptance.
  sb.reviews = [{ id: 'rev-1', created_at: new Date().toISOString(), period_from: '2026-10-03', period_to: '2026-10-09', review: { data_completeness: { days_with_meals: 1, days_marked_complete: 0, weight_points: 0, sessions: 0 }, output: { observations: [], suggestions: [], missing_information: [], questions: [], proposed_target_change: null, safety_flags: [] } }, model_id: 'gemini-3.8-flash', prompt_version: 'p' }];
  sb.proposals = [{ id: 'prop-1', before_value: { energy_kcal: 2300, protein_g: 130 }, after_value: { energy_kcal: 2200, protein_g: 140, rationale: 'Steady weight.' }, status: 'proposed' }];
  await page.reload();
  await expect(page.getByText('Proposed target change')).toBeVisible();
  await page.getByText('Proposed target change').scrollIntoViewIfNeeded();
  await shot(page, '24-coach-proposal');
  await page.goto('/#/settings');
  await expect(page.getByLabel('Daily energy target (kcal)')).toHaveValue('2300');
  await page.goto('/#/coach');
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => sb.decided).toEqual([{ id: 'prop-1', decision: 'accepted' }]);
  await page.goto('/#/settings');
  await expect(page.getByLabel('Daily energy target (kcal)')).toHaveValue('2200');
});

test('coach shows a truthful setup state when the AI function is not configured', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboard(page, { ai: true });
  await page.goto('/#/coach');
  await page.getByRole('button', { name: /Get this week’s review/ }).click();
  await expect(page.getByText(/The coach isn’t switched on yet/)).toBeVisible();
  await shot(page, '25-coach-not-configured');
});
