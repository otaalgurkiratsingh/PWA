/** Map auth errors to calm, specific messages. Raw provider/env errors are never shown. */
export function authMessage(e: unknown): string {
  const err = e as { status?: number; message?: string; code?: string; name?: string } | null;
  const msg = (err?.message ?? '').toLowerCase();
  const code = (err?.code ?? '').toLowerCase();
  if (!navigator.onLine || err?.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network')) {
    return 'No connection. Check your internet and try again.';
  }
  if (err?.status === 429 || code.includes('rate') || msg.includes('rate limit') || msg.includes('security purposes')) {
    return 'Too many attempts. Please wait a minute, then try again.';
  }
  if (msg.includes('signups not allowed') || msg.includes('signup') || code.includes('signup') || code === 'otp_disabled' || err?.status === 422) {
    // Same wording whether or not the address exists, so the screen doesn't reveal who is invited.
    return 'If this email is on the invite list, a code is on its way. Rozana is invite-only — ask the owner to add you.';
  }
  if (code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid') || code.includes('otp')) {
    return 'That code didn’t work or has expired. Check it, or send a new one.';
  }
  return 'Something went wrong. Please try again.';
}
