import { expect, test, type Page } from '@playwright/test';
import { MockSupabase, v2, type MockUser } from './mockSupabase';

/** With SHOTS=1, also save review screenshots of auth/coach states to docs/screenshots. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `docs/screenshots/390-${name}.png` });
};

/** Auth harness build (fake Supabase URL; all backend calls answered by MockSupabase). */
const OWNER: MockUser = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', membership: 'active' };
const WIFE: MockUser = { id: '33333333-3333-4333-8333-333333333333', email: 'second@example.com', membership: 'active' };
const PENDING: MockUser = { id: '22222222-2222-4222-8222-222222222222', email: 'pending@example.com', membership: 'none' };

async function signIn(page: Page, email: string, code = '123456') {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const next = (page: Page) => page.getByRole('button', { name: 'Save and continue' }).click();

/** Steps 1–8 of onboarding; leaves the person on "Review and plan". */
async function answer(page: Page, opts: { ai?: boolean; foods?: boolean; photos?: (page: Page) => Promise<void> } = {}) {
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByLabel('What should we call you?').fill('Gurkirat');
  await page.getByRole('checkbox', { name: /18 or older/ }).click();
  await next(page);
  // New onboarding starts as the trainer interview; these tests use the form path.
  await page.getByRole('button', { name: 'Prefer a form?' }).click();
  await expect(page.getByRole('heading', { name: 'Your goal' })).toBeVisible();
  await page.getByRole('button', { name: /Get stronger/ }).click();
  await page.getByRole('button', { name: /Be consistent/ }).click();
  await next(page);
  for (const d of ['Mon', 'Wed', 'Fri']) await page.getByRole('group', { name: 'Days you can train' }).getByRole('button', { name: d }).click();
  await next(page);
  await page.getByRole('button', { name: /New to training/ }).click();
  await next(page);
  await page.getByRole('group', { name: 'Where you train' }).getByRole('button', { name: 'Gym' }).click();
  await page.getByRole('group', { name: 'Equipment' }).getByRole('button', { name: 'Dumbbells' }).click();
  await page.getByRole('radio', { name: 'I read it and nothing applied to me' }).click();
  await next(page);
  await expect(page.getByRole('heading', { name: 'Your usual foods' })).toBeVisible();
  if (opts.foods !== false) {
    for (const f of ['Whole-wheat roti', 'Dal tadka', 'Milk chai', 'Boiled eggs', 'Plain dahi']) await page.locator('.food-pick', { hasText: f }).click();
    await expect(page.getByText('5 chosen')).toBeVisible();
  }
  await next(page);
  await expect(page.getByRole('heading', { name: 'Optional progress photos' })).toBeVisible();
  if (opts.photos) {
    await opts.photos(page);
    await next(page);
  } else await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Your privacy' })).toBeVisible();
  await page.getByRole('button', { name: /Back up to my private cloud/ }).click();
  if (opts.ai) await page.getByRole('switch', { name: /AI help/ }).click();
  await next(page);
  await expect(page.getByRole('heading', { name: 'Review and plan' })).toBeVisible();
}

async function onboardSimple(page: Page, opts: { ai?: boolean } = {}) {
  await answer(page, opts);
  await page.getByRole('button', { name: /Start from a simple 2-day plan/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
}

async function idbAll(page: Page, owner: string, store: string) {
  return page.evaluate(async ([db, s]) => new Promise<unknown[]>((resolve, reject) => {
    const req = indexedDB.open(`rozana-journal-${db}`);
    req.onsuccess = () => {
      const g = req.result.transaction(s!, 'readonly').objectStore(s!).getAll();
      g.onsuccess = () => { resolve(g.result); req.result.close(); };
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  }), [owner, store]);
}

/** A real photo file made in the browser (the app crops and re-encodes it on the device). */
async function photoFile(page: Page, color: string) {
  const dataUrl = await page.evaluate((c) => {
    const cv = document.createElement('canvas');
    cv.width = 320;
    cv.height = 420;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 320, 420);
    ctx.fillStyle = '#fff';
    ctx.fillRect(120, 60, 80, 300);
    return cv.toDataURL('image/png');
  }, color);
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

async function addPhoto(page: Page, slot: 'Front' | 'Inspiration', color: string) {
  const card = page.locator('.photo-slot', { hasText: slot });
  await card.getByRole('button', { name: /Add|Replace/ }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(await photoFile(page, color));
  await page.getByRole('button', { name: 'Use this photo' }).click();
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
  await shot(page, '21-onboarding');
  await onboardSimple(page);

  // Usual foods came from the food list: one personal meal each, catalogue art, nutrition not set.
  await page.goto('/#/food');
  await expect(page.getByRole('button', { name: /^Dal tadka, 1 bowl/ })).toBeVisible();
  await expect(page.locator('svg[data-art="whole-wheat-roti"]').first()).toBeVisible();
  const presets = (await idbAll(page, OWNER.id, 'presets')) as { catalogue_id: string; items: { grams_per_unit: number | null }[] }[];
  expect(presets.map((p) => p.catalogue_id).sort()).toEqual(['boiled-eggs', 'dal-tadka', 'milk-chai', 'plain-dahi', 'whole-wheat-roti']);
  expect(presets.every((p) => p.items[0]!.grams_per_unit === null)).toBe(true);
  await expect(page.getByRole('button', { name: /Boiled eggs, 1 egg/ })).toBeVisible();
  await page.goto('/#/workout');
  await expect(page.getByText('Full body A').first()).toBeVisible();

  // Backup happened through sync_push with this user as owner, and consent was recorded.
  await expect.poll(() => sb.docs.size, { timeout: 10_000 }).toBeGreaterThan(3);
  for (const [k, d] of sb.docs) {
    expect(k.startsWith(OWNER.id)).toBe(true);
    expect((d.body as { owner_id: string }).owner_id).toBe(OWNER.id);
  }
  expect(sb.consent).toEqual(expect.arrayContaining([expect.objectContaining({ consent_type: 'cloud_backup', granted: true })]));
  expect(sb.profileOf(OWNER.id)).toMatchObject({ training: { sessions_per_week: 3, days_available: [1, 3, 5], screening: 'no_concerns' }, onboarded_at: expect.any(String) });
  await page.goto('/#/settings');
  await expect(page.getByText(/Backed up/).first()).toBeVisible({ timeout: 10_000 });

  // Session restore: reload goes straight to the app; the welcome screen never shows.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.innerText.includes('Eat well. Train smart.')) (window as unknown as { __sawWelcome: boolean }).__sawWelcome = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sawWelcome?: boolean }).__sawWelcome ?? false)).toBe(false);

  // Sign out (everything is backed up) → welcome; signing in again restores the same journal.
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Eat well. Train smart./ })).toBeVisible();
  await signIn(page, OWNER.email);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(provider).toEqual([]);
});

test('onboarding resumes where it was after a reload (recoverable draft)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await page.getByLabel('What should we call you?').fill('Gurkirat');
  await page.getByRole('checkbox', { name: /18 or older/ }).click();
  await next(page);
  await page.getByRole('button', { name: 'Prefer a form?' }).click();
  await page.getByRole('button', { name: /Build muscle/ }).click();
  await next(page);
  await page.getByRole('group', { name: 'Days you can train' }).getByRole('button', { name: 'Tue' }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Days you can train' }).getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /Build muscle/ })).toHaveAttribute('aria-pressed', 'true');
});

test('new user: usual foods → skip photos → generate → review the draft → accept; history is a new plan version', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.planReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, { ai: true });
  await shot(page, '30-onboarding-review');
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Three-day starter')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Back squat · 3 × 8–12 · rest 90s · start with a comfortable, controlled weight/)).toBeVisible();
  await expect(page.getByText(/Nothing is active until you accept/)).toBeVisible();
  await shot(page, '31-plan-draft');

  // The request: session token only, current profile version, no photos, consent recorded first.
  const call = sb.aiCalls('onboarding_plan')[0]!;
  expect(call.body).toMatchObject({ operation: 'onboarding_plan', profile_version: 1, source: 'onboarding', photo_ids: [], inline_photos: [] });
  expect(JSON.stringify(call)).not.toMatch(/AIza|x-goog-api-key/i);
  expect(sb.latestConsent(OWNER.id, 'ai_processing')).toBe(true);
  // Nothing activated yet.
  expect(await idbAll(page, OWNER.id, 'programs')).toEqual([]);

  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  await expect(page.getByText('Lower body').first()).toBeVisible();
  expect(sb.decided).toEqual([expect.objectContaining({ decision: 'accepted' })]);
  const programs = (await idbAll(page, OWNER.id, 'programs')) as { version: number; days: { name: string; weekday: number | null }[] }[];
  expect(programs).toHaveLength(1);
  expect(programs[0]!.days.map((d) => [d.name, d.weekday])).toEqual([['Lower body', 1], ['Upper body', 3], ['Full body', 5]]);
});

test('Edit opens the draft in the plan editor; saving it is the approval; Regenerate replaces the draft', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.planReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, { ai: true });
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Three-day starter')).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect.poll(() => sb.drafts.map((d) => d.status)).toEqual(['superseded', 'draft']);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit plan' })).toBeAttached();
  await expect(page.getByText('Lower body').first()).toBeVisible();
  await page.getByRole('button', { name: /Save/ }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.count()) await confirm.first().click();
  await expect.poll(() => sb.decided.map((d) => d.decision)).toEqual(['accepted']);
  const programs = (await idbAll(page, OWNER.id, 'programs')) as unknown[];
  expect(programs).toHaveLength(1);
});

test('photos: stored privately with permission, AI-image transfer declined → plan from answers only; delete removes the file', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.planReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, {
    ai: true,
    photos: async (p) => {
      await expect(p.getByText('Wear whatever feels comfortable. Photos are not needed to create your plan.')).toBeVisible();
      await expect(p.getByText('An inspiration photo helps describe your goal; it does not predict your results.')).toBeVisible();
      await p.getByRole('switch', { name: /Keep my photos in private storage/ }).click();
      await addPhoto(p, 'Front', '#c97');
      await expect(p.locator('.photo-slot', { hasText: 'Front' }).getByText('Saved privately')).toBeVisible();
      await addPhoto(p, 'Inspiration', '#79c');
      await expect(p.locator('.photo-slot', { hasText: 'Inspiration' }).getByText('Saved privately')).toBeVisible();
      await p.getByLabel(/What do you like about your goal/).fill('Strong shoulders and more energy');
      await shot(p, '32-photos');
    },
  });
  // Stored only under this person's folder with random names; permission recorded before upload.
  expect(sb.photos).toHaveLength(2);
  for (const ph of sb.photos) expect(ph.object_path).toMatch(new RegExp(`^${OWNER.id}/[0-9a-f-]{36}\\.jpg$`));
  const uploadIdx = sb.requests.findIndex((r) => r.path.startsWith('/storage/v1/object/progress-photos/'));
  const consentIdx = sb.requests.findIndex((r) => r.path === '/rest/v1/consent_events' && JSON.stringify(r.body).includes('photo_storage'));
  expect(consentIdx).toBeGreaterThanOrEqual(0);
  expect(consentIdx).toBeLessThan(uploadIdx);
  expect(sb.latestConsent(OWNER.id, 'ai_images')).toBe(false);

  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Three-day starter')).toBeVisible();
  expect(sb.aiCalls('onboarding_plan')[0]!.body).toMatchObject({ photo_ids: [], inline_photos: [] });
  expect(sb.profileOf(OWNER.id)).toMatchObject({ training: { inspiration_note: 'Strong shoulders and more energy' } });
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();

  // Delete the front photo from Settings → file and record gone.
  await page.goto('/#/photos');
  await page.getByRole('button', { name: 'Delete Front photo' }).click();
  await expect.poll(() => sb.photos.length).toBe(1);
  expect([...sb.objects.keys()].length).toBe(1);
});

test('AI-image permission on: only the person’s own stored photos are referenced; unsaved photos go once, never stored', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.planReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, {
    ai: true,
    photos: async (p) => {
      // Storage OFF, AI images ON: the photo stays on this screen only.
      await p.getByRole('switch', { name: /Let AI Coach see the photos/ }).click();
      await addPhoto(p, 'Front', '#a85');
      await expect(p.locator('.photo-slot', { hasText: 'Front' }).getByText('This screen only')).toBeVisible();
    },
  });
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Three-day starter')).toBeVisible();
  const body = sb.aiCalls('onboarding_plan')[0]!.body as { photo_ids: string[]; inline_photos: { slot: string; image_base64: string }[] };
  expect(body.photo_ids).toEqual([]);
  expect(body.inline_photos).toHaveLength(1);
  expect(body.inline_photos[0]!.slot).toBe('front');
  expect(body.inline_photos[0]!.image_base64.startsWith('/9j/')).toBe(true); // re-encoded JPEG (no PNG/EXIF original)
  expect(sb.photos).toEqual([]);
  expect(sb.objects.size).toBe(0);
});

test('provider unavailable: truthful, recoverable state; answers kept; manual plan still works', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = () => ({ status: 'error', error: 'provider_error', message: 'The coach could not answer right now. Logging still works.' });
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, { ai: true });
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByRole('alert')).toContainText('The coach could not answer right now');
  await expect(page.getByRole('alert')).toContainText('Your answers are saved');
  await shot(page, '33-plan-provider-error');
  expect(await idbAll(page, OWNER.id, 'programs')).toEqual([]);
  await page.getByRole('button', { name: 'Build my own plan' }).click();
  await expect(page.getByRole('heading', { name: 'Edit plan' })).toBeAttached();
});

test('an authenticated but unapproved account is refused (no journal, no onboarding)', async ({ page }) => {
  const sb = new MockSupabase([OWNER, PENDING]);
  await sb.install(page);
  await signIn(page, PENDING.email);
  await expect(page.getByRole('heading', { name: 'This account isn’t active' })).toBeVisible();
  await shot(page, '22-not-member');
  await expect(page.getByText(/hasn’t been added to TrainLuma/)).toBeVisible();
  expect(sb.requests.filter((r) => r.path.includes('sync_push'))).toEqual([]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /Eat well. Train smart./ })).toBeVisible();
});

test('an address that is not invited gets the same neutral message (no account discovery)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('stranger@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/If this email is on the invite list/)).toBeVisible();
});

test('AI Coach chat: send, plain-text rendering, stored thread, retry with the same id, no duplicate sends, memory and plan proposals need approval, delete', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  let failNext = false;
  sb.aiHandler = (op, b, caller, s) => {
    if (op === 'onboarding_plan') return s.planReply(caller, b);
    if (op !== 'coach_question') return { status: 'error', error: 'not_configured', message: 'x' };
    if (failNext) {
      failNext = false;
      return { status: 'error', error: 'provider_error', message: 'The coach could not answer right now. Logging still works. Your message is kept, so you can try again.' };
    }
    const msg = String(b.message);
    if (/30 minutes/.test(msg)) {
      return s.chatReply(caller, b, v2({
        assistant_message: 'Keep squats and rows today: 2 sets each with 60 s rest. <img src=x onerror="window.__xss=1"> That fits in about 30 minutes.',
        suggestions: [{ kind: 'training', text: 'Use 2 working sets on busy days.', rationale: 'Fits 30 minutes.', requires_approval: true }],
        candidate_memories: [{ key: 'busy_days', value: 'Has about 30 minutes on weekdays', requires_confirmation: true }],
        questions: [{ id: 'q1', text: 'Which day is usually busiest?', options: [] }],
      }));
    }
    return s.chatReply(caller, b, v2({ assistant_message: `You asked: ${msg.slice(0, 40)}. Your logs show one workout this week.` }));
  };
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page, { ai: true });

  await page.goto('/#/today');
  await page.getByRole('button', { name: 'Chat with Luma', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Luma' })).toBeVisible();
  await expect(page.getByText(/not a doctor, physiotherapist, registered dietitian or human trainer/)).toBeVisible();
  await shot(page, '34-chat-empty');

  // Starter question → reply rendered as plain text (no HTML executed or inserted).
  await page.getByRole('button', { name: 'Can you fit today’s workout into 30 minutes?' }).click();
  await expect(page.locator('.bubble.coach').filter({ hasText: 'Keep squats and rows today' })).toBeVisible();
  await expect(page.locator('.chat-log img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('.bubble.coach').filter({ hasText: 'Keep squats' })).toContainText('<img src=x');
  await expect(page.getByText(/Based on your records from/)).toBeVisible();
  await shot(page, '35-chat-reply');
  const threadId = sb.threads[0]!.id;
  await expect(page).toHaveURL(new RegExp(`#/chat/${threadId}$`));

  // Candidate memory needs an explicit Save; nothing was remembered before.
  expect(sb.memory).toEqual([]);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sb.memory.map((m) => m.fact)).toEqual(['Has about 30 minutes on weekdays']);

  // A follow-up question chip fills the composer (never sends by itself).
  await page.getByRole('button', { name: 'Which day is usually busiest?' }).click();
  await expect(page.getByLabel('Message AI Coach')).toHaveValue('Which day is usually busiest?');
  await page.getByLabel('Message AI Coach').fill('');

  // Plan change from chat: only a draft to review; nothing activates.
  const programsBefore = await idbAll(page, OWNER.id, 'programs');
  await page.getByRole('button', { name: 'Draft an updated plan to review' }).click();
  await expect(page.getByRole('heading', { name: 'Plan draft' })).toBeVisible();
  expect(sb.aiCalls('onboarding_plan').at(-1)!.body).toMatchObject({ source: 'chat', instruction: 'Can you fit today’s workout into 30 minutes?' });
  expect(await idbAll(page, OWNER.id, 'programs')).toEqual(programsBefore);
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.goBack();

  // Failure keeps the message; Retry reuses the same request id; double-click sends once.
  failNext = true;
  await page.getByLabel('Message AI Coach').fill('How was my week?');
  await page.getByRole('button', { name: 'Send' }).dblclick();
  await expect(page.getByRole('alert')).toContainText('Your message is kept');
  const attempts = sb.aiCalls('coach_question');
  const firstFailed = attempts.at(-1)!.body as { operation_id: string };
  expect(attempts.filter((r) => (r.body as { message: string }).message === 'How was my week?')).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/You asked: How was my week\?/)).toBeVisible();
  expect((sb.aiCalls('coach_question').at(-1)!.body as { operation_id: string }).operation_id).toBe(firstFailed.operation_id);

  // Reload restores the conversation from the private store.
  await page.reload();
  await expect(page.locator('.bubble.coach').filter({ hasText: 'Keep squats' })).toBeVisible();
  await expect(page.locator('.bubble.me').filter({ hasText: 'How was my week?' })).toBeVisible();

  // Delete chat → gone from the account, memory kept.
  await page.getByRole('button', { name: 'Delete chat' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => sb.threads.length).toBe(0);
  expect(sb.messages).toEqual([]);
  expect(sb.memory).toHaveLength(1);
  await page.goto('/#/coach');
  await expect(page.getByText(/No chats yet/)).toBeVisible();
  await expect(page.getByText('Has about 30 minutes on weekdays')).toBeVisible();
});

test('chat limits and connectivity: quota reached disables sending; offline shows a notice and sends nothing', async ({ page, context }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => s.chatReply(caller, b, v2({ assistant_message: 'Back online, here is your answer.' }));
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page, { ai: true });
  await page.goto('/#/chat/new');
  await context.setOffline(true);
  await expect(page.getByText(/You’re offline\. The coach needs a connection/)).toBeVisible();
  await page.getByLabel('Message AI Coach').fill('Are you there?');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await shot(page, '36-chat-offline');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Back online, here is your answer.')).toBeVisible();
  expect(sb.aiCalls('coach_question')).toHaveLength(1);

  sb.usage.questions_today = 20;
  await page.reload();
  await expect(page.getByLabel('Message AI Coach')).toBeDisabled();
  await expect(page.getByText(/0 of 20 messages left today/)).toBeVisible();
});

test('two people on one phone: B never sees A’s chats, drafts, photos or meals, before or after sign-out', async ({ page }) => {
  const sb = new MockSupabase([OWNER, WIFE]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.planReply(caller, b) : s.chatReply(caller, b, v2({ assistant_message: `Private answer for ${caller.email}` })));
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, {
    ai: true,
    photos: async (p) => {
      await p.getByRole('switch', { name: /Keep my photos in private storage/ }).click();
      await addPhoto(p, 'Front', '#b76');
      await expect(p.locator('.photo-slot', { hasText: 'Front' }).getByText('Saved privately')).toBeVisible();
    },
  });
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Three-day starter')).toBeVisible();
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  await page.goto('/#/chat/new');
  await page.getByLabel('Message AI Coach').fill('A private question');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(`Private answer for ${OWNER.email}`)).toBeVisible();

  // Sign out (keep this phone's copy), then the second person signs in on the same browser.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, WIFE.email);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible(); // her own onboarding, nothing prefilled
  await expect(page.getByLabel('What should we call you?')).toHaveValue('');
  await onboardSimple(page, { ai: true });
  await page.goto('/#/coach');
  await expect(page.getByText(/No chats yet/)).toBeVisible();
  await expect(page.getByText('A private question')).toHaveCount(0);
  await expect(page.getByText('Three-day starter')).toHaveCount(0);
  await page.goto('/#/photos');
  await expect(page.locator('.photo-slot img')).toHaveCount(0);
  await expect(page.locator('.photo-slot', { hasText: 'Front' }).getByText('Optional')).toBeVisible();
  await page.goto(`/#/chat/${sb.threads[0]!.id}`); // a guessed id of A's thread
  await expect(page.getByText(/deleted or has expired/)).toBeVisible();
  await expect(page.getByText('A private question')).toHaveCount(0);
  await page.goto('/#/food');
  await expect(page.getByRole('button', { name: /Dal tadka/ }).first()).toBeVisible(); // her own choice
  // Every request after her sign-in carried her identity only.
  const after = sb.requests.slice(sb.requests.findIndex((r) => r.path === '/auth/v1/verify' && (r.body as { email: string }).email === WIFE.email) + 1);
  expect(after.every((r) => r.caller === null || r.caller === WIFE.id)).toBe(true);
});

test('weekly review (schema 2.0) and an older review still readable; accepting an old proposal updates targets', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiResponses.weekly_review = {
    status: 'ok', operation: 'weekly_review',
    review: {
      id: 'rev-1', created_at: new Date().toISOString(), data_period: { from: '2026-10-03', to: '2026-10-09' },
      data_completeness: { days_with_meals: 1, days_marked_complete: 0, weight_points: 0, sessions: 0 },
      output: v2({ status: 'review_ready', assistant_message: 'A quiet week with one logged day.', observations: [{ text: 'You logged dal on 9 Oct.', evidence_refs: ['day:2026-10-09'] }], suggestions: [{ kind: 'routine', text: 'Log dinner too.', rationale: 'Partial days.', requires_approval: true }], limitations: ['No weigh-ins this week.'] }),
      proposal_id: null, model_id: 'gemini-3.8-flash', prompt_version: 'coach-2.0+test',
    },
  };
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page, { ai: true });
  await page.goto('/#/settings');
  await page.getByLabel('Daily energy target (kcal)').fill('2300');
  await page.getByLabel('Daily protein target (g)').fill('130');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await page.goto('/#/coach');
  await page.getByRole('button', { name: /Get this week’s review/ }).click();
  await expect(page.getByText('What your logs show')).toBeVisible();
  await expect(page.getByText('You logged dal on 9 Oct.')).toBeVisible();
  await expect(page.getByText('No weigh-ins this week.')).toBeVisible();
  await shot(page, '23-coach-review');
  const aiCall = sb.aiCalls('weekly_review')[0]!;
  expect(aiCall.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(JSON.stringify(aiCall)).not.toMatch(/AIza|GEMINI|x-goog-api-key/i);

  // A stored version-1 review with a target proposal renders through the compatibility adapter.
  sb.reviews = [{ id: 'rev-0', created_at: new Date().toISOString(), period_from: '2026-09-26', period_to: '2026-10-02', review: { data_completeness: { days_with_meals: 3, days_marked_complete: 1, weight_points: 2, sessions: 2 }, output: { observations: [{ text: 'Two workouts last week.', evidence_refs: ['session:x'] }], suggestions: [], missing_information: ['Steps not logged.'], questions: [], proposed_target_change: null, safety_flags: [] } }, model_id: 'gemini-3.8-flash', prompt_version: 'rozana-coach-2026-10-09.1' }];
  sb.proposals = [{ id: 'prop-1', before_value: { energy_kcal: 2300, protein_g: 130 }, after_value: { energy_kcal: 2200, protein_g: 140, rationale: 'Steady weight.' }, status: 'proposed' }];
  await page.reload();
  await expect(page.getByText('Two workouts last week.')).toBeVisible();
  await expect(page.getByText(/older review format/)).toBeVisible();
  await expect(page.getByText('Proposed target change')).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => sb.decided).toEqual([{ id: 'prop-1', decision: 'accepted' }]);
  await page.goto('/#/settings');
  await expect(page.getByLabel('Daily energy target (kcal)')).toHaveValue('2200');
});

test('coach shows a truthful setup state when the AI function is not configured', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page, { ai: true });
  await page.goto('/#/chat/new');
  await page.getByLabel('Message AI Coach').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/The coach isn’t switched on yet/)).toBeVisible();
  await shot(page, '25-coach-not-configured');
});

test('with backup off, the coach explains it needs backup instead of answering from nothing', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await answer(page, { ai: true });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Keep it on this phone only/ }).click();
  await next(page);
  await expect(page.getByRole('button', { name: /Generate my draft plan/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.goto('/#/chat/new');
  await expect(page.getByText('Back up your journal first')).toBeVisible();
  expect(sb.aiCalls()).toEqual([]);
});

test('reminders panel: preferences saved to the person’s own row and reloaded', async ({ page }) => {
  const sb = new MockSupabase([OWNER, WIFE]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page);
  await page.goto('/#/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText(/still being set up by the owner/)).toBeVisible(); // this build has no VAPID key
  // v2: three kinds only; the gym time is learned unless the person sets one.
  await expect(page.getByText(/Never more than 2 a day, never between 10pm and 7am/)).toBeVisible();
  await expect(page.getByRole('switch', { name: /Routine nudge/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Milestone or insight ready/ })).toBeChecked();
  await expect(page.getByText(/Daily motivation/)).toHaveCount(0);
  await page.getByRole('radio', { name: 'I’ll set a time' }).click();
  await page.getByLabel('Gym time', { exact: true }).fill('19:30');
  await page.getByRole('combobox').selectOption('30');
  await expect(page.getByText('You’ll get it at 19:00 on the days you picked.')).toBeVisible();
  await page.getByLabel('Gym time', { exact: true }).fill('07:10');
  await expect(page.getByText(/inside quiet hours/)).toBeVisible();
  await page.getByLabel('Gym time', { exact: true }).fill('19:30');
  await page.getByRole('switch', { name: /Routine nudge/ }).click();
  await page.getByRole('switch', { name: /Hide details on the lock screen/ }).click();
  await expect(page.getByText(/only a fixed-time gym reminder can be sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByRole('status').getByText('Reminders saved.')).toBeVisible();
  const saved = sb.notifyPrefs.get(OWNER.id)!;
  expect(saved).toMatchObject({ user_id: OWNER.id, gym_mode: 'fixed', gym_time: '19:30', lead_minutes: 30, hide_details: true, routine_enabled: false, insight_enabled: true, motivation_enabled: false });
  await page.reload();
  await expect(page.getByLabel('Gym time', { exact: true })).toHaveValue('19:30');
  await expect(page.getByRole('switch', { name: /Routine nudge/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(sb.notifyPrefs.size).toBe(1);
});

test('notifications: a kind dismissed 3 times stops for good (recorded by the service worker, sent by the app)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page);
  // What the service worker writes when a notification is closed without a tap.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('trainluma-sw', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('notification-events', { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => {
        const tx = req.result.transaction('notification-events', 'readwrite');
        for (let i = 0; i < 3; i++) tx.objectStore('notification-events').add({ kind: 'routine', what: 'dismissed', at: new Date().toISOString() });
        tx.objectStore('notification-events').add({ kind: 'insight', what: 'opened', at: new Date().toISOString() });
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.goto('/#/notifications');
  await page.reload();
  await expect.poll(() => sb.dismissals.get(`${OWNER.id}:routine`) ?? 0).toBe(3);
  await page.reload();
  await expect(page.getByText(/Stopped because you dismissed it 3 times/)).toBeVisible();
  // Sent once: the queue on the phone is empty afterwards.
  await page.reload();
  expect(sb.dismissals.get(`${OWNER.id}:routine`)).toBe(3);
  expect(sb.requests.filter((r) => r.path === '/rest/v1/rpc/notification_dismissed').length).toBe(3);
});

test('circles: join with a code → kind board (no last place) → share a new best only on a tap → leave', async ({ page }) => {
  const sb = new MockSupabase([OWNER, WIFE]);
  sb.circles.push({ id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Morning crew', join_code: 'KTX234' });
  sb.circleMembers.push(
    { circle_id: 'c0ffee00-0000-4000-8000-000000000001', user_id: WIFE.id, display_name: 'Simran', avatar: 'bloom', share_prs: true },
    { circle_id: 'c0ffee00-0000-4000-8000-000000000001', user_id: 'friend-z', display_name: 'Zora', avatar: 'panda', share_prs: true },
  );
  sb.activeDays.set(WIFE.id, 6);
  sb.activeDays.set('friend-z', 0);
  sb.activeDays.set(OWNER.id, 3);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page);
  await page.goto('/#/circles/KTX234'); // a shared circle link opens the join sheet with the code
  await expect(page.getByRole('heading', { name: 'Circles' })).toBeVisible();
  await expect(page.getByLabel('Code from your friend')).toHaveValue('KTX234');
  await expect(page.getByLabel('Your name in the circle')).toHaveValue('Gurkirat');
  await page.getByRole('button', { name: 'Join circle' }).click();
  const circle = page.getByRole('region', { name: 'Morning crew' });
  await expect(circle.getByText('Most consistent this week 🌟')).toBeVisible();
  await expect(circle.locator('.cb-top')).toContainText('Simran');
  // Everyone else alphabetical (Gurkirat before Zora), never ranked; no numbers like "#3" or "last".
  const others = circle.getByRole('list', { name: 'Everyone else, alphabetical' });
  await expect(others.locator('.cb-row')).toHaveText([/Gurkirat \(you\)/, /Zora/]);
  await expect(circle).not.toContainText(/#\d|\brank|came last|bottom/i);
  expect(sb.circleMembers.find((m) => m.user_id === OWNER.id)).toMatchObject({ display_name: 'Gurkirat' });

  // Invite: an editable message, sent only through the share sheet on a tap.
  await page.evaluate(() => {
    (window as unknown as { shared: string[] }).shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: ShareData) => { (window as unknown as { shared: string[] }).shared.push(d.text ?? ''); } });
  });
  await circle.getByRole('button', { name: 'Invite' }).click();
  const msg = page.getByLabel(/Your message/);
  await expect(msg).toHaveValue(/Code: KTX234/);
  expect(await page.evaluate(() => (window as unknown as { shared: string[] }).shared.length)).toBe(0);
  await msg.fill('Join us! KTX234');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: string[] }).shared)).toEqual(['Join us! KTX234']);
  await page.keyboard.press('Escape');

  // A post from the circle shows with the friend's name; nothing about food or weight.
  sb.circlePosts.push({ id: 'p-1', circle_id: 'c0ffee00-0000-4000-8000-000000000001', user_id: WIFE.id, kind: 'milestone', text: '30 days in a row 🔥', created_at: new Date().toISOString() });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Morning crew' }).getByText('30 days in a row 🔥')).toBeVisible();

  // Start my own circle: the board waits for 3 members.
  await page.getByRole('button', { name: 'Start a circle' }).click();
  await page.getByLabel('Circle name').fill('Family');
  await page.getByRole('button', { name: 'Create circle' }).click();
  await expect(page.getByRole('region', { name: 'Family' }).getByText(/starts once 2 more friends join/)).toBeVisible();

  // Leave the first circle.
  await page.getByRole('region', { name: 'Morning crew' }).getByRole('button', { name: 'Leave circle' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Morning crew' })).toHaveCount(0);
  expect(sb.circleMembers.some((m) => m.user_id === OWNER.id && m.circle_id === 'c0ffee00-0000-4000-8000-000000000001')).toBe(false);
});

test('invite: give a month, get a month — own code, editable share, redeem rules, months saved (no billing)', async ({ page }) => {
  const sb = new MockSupabase([OWNER, WIFE]);
  sb.referralCodes.set(WIFE.id, 'SI-4321');
  await sb.install(page);
  // An invite link opened before signing in is remembered.
  await page.goto('/#/invite/si-4321');
  await signIn(page, OWNER.email);
  await onboardSimple(page);
  await page.goto('/#/today');
  await expect(page.getByRole('region', { name: 'Friend’s invite' }).getByText(/Use their code SI-4321/)).toBeVisible();
  await page.getByRole('button', { name: 'Claim my month' }).click();
  await expect(page.getByRole('heading', { name: 'Invite friends' })).toBeVisible();
  await expect(page.getByText('Give a month, get a month')).toBeVisible();
  await expect(page.getByLabel(/Your code GU-\d{4}/)).toBeVisible();
  const mine = sb.referralCodes.get(OWNER.id)!;

  // My own code is refused kindly.
  await page.getByRole('textbox', { name: 'Friend’s code' }).fill(mine);
  await page.getByRole('button', { name: 'Use code' }).click();
  await expect(page.getByText(/That’s your own code/)).toBeVisible();
  // The friend's code works once, with a device hash (never the raw id).
  await page.getByRole('textbox', { name: 'Friend’s code' }).fill('si 4321');
  await page.getByRole('button', { name: 'Use code' }).click();
  await expect(page.getByText(/Your friend gave you Plus free for your first 2 months/)).toBeVisible();
  expect(sb.redemptions).toHaveLength(1);
  expect(sb.redemptions[0]!.device).toMatch(/^[a-f0-9]{64}$/);
  expect(sb.credits).toEqual([{ user_id: OWNER.id, reason: 'invitee_bonus', status: 'queued' }, { user_id: WIFE.id, reason: 'inviter_reward', status: 'pending' }]);
  await expect(page.getByText(/Plus isn’t on sale yet, so nothing is charged/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Friend’s code' }).fill('SI-4321');
  await page.getByRole('button', { name: 'Use code' }).click();
  await expect(page.getByText(/already used a friend’s code/)).toBeVisible();
  expect(sb.redemptions).toHaveLength(1);

  // Sharing my code: pre-written but editable, and nothing is sent without a tap.
  await page.evaluate(() => {
    (window as unknown as { shared: string[] }).shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: ShareData) => { (window as unknown as { shared: string[] }).shared.push(d.text ?? ''); } });
  });
  await page.getByRole('button', { name: 'Share with a friend' }).click();
  await expect(page.getByLabel(/Your message/)).toHaveValue(new RegExp(`${mine}.*#/invite/${mine}`));
  await page.getByLabel(/Your message/).fill(`Try this! ${mine}`);
  expect(await page.evaluate(() => (window as unknown as { shared: string[] }).shared.length)).toBe(0);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: string[] }).shared)).toEqual([`Try this! ${mine}`]);
});

test('a real account keeps logged meals: backed up, survives reload, and comes back after "remove this phone’s copy"', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page, OWNER.email);
  await onboardSimple(page);
  await page.goto('/#/food');
  await page.getByRole('button', { name: 'Add food' }).click();
  await page.getByRole('button', { name: /Choose food/ }).click();
  await page.getByLabel('Search foods').fill('rajmah');
  await page.getByRole('button', { name: /^Rajma curry, 216 kcal/ }).click();
  await page.getByRole('dialog', { name: 'Rajma curry' }).getByRole('button', { name: /^Log / }).click();
  await expect(page.getByRole('status').getByText(/Added Rajma curry/)).toBeVisible();
  // Backed up to the person's own rows.
  await expect.poll(() => [...sb.docs.keys()].some((k) => k.startsWith(`${OWNER.id}:meal_entries:`)), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Edit Rajma curry/ }).first()).toBeVisible();
  // Sign out and delete this phone's copy, then sign in again: the meal is restored from backup.
  await page.goto('/#/settings');
  await expect(page.getByText(/Backed up/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('button', { name: 'Sign out and remove this phone’s copy' }).click();
  await expect(page.getByRole('heading', { name: /Eat well. Train smart./ })).toBeVisible();
  // The phone's copy is really gone (checked without opening it, which would re-create it).
  expect(await page.evaluate(async (id) => (await indexedDB.databases()).some((d) => d.name === `rozana-journal-${id}`), OWNER.id)).toBe(false);
  await signIn(page, OWNER.email);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.goto('/#/food');
  await expect(page.getByRole('button', { name: /Edit Rajma curry/ }).first()).toBeVisible({ timeout: 15_000 });
});
