import { describe, expect, it } from 'vitest';
import { authMessage } from './messages';

describe('auth messages', () => {
  it('maps Supabase errors to calm, specific messages without revealing invitations', () => {
    expect(authMessage({ status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' })).toMatch(/If this email is on the invite list/);
    expect(authMessage({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' })).toMatch(/didn’t work or has expired/);
    expect(authMessage({ status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' })).toMatch(/Too many attempts/);
    expect(authMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toMatch(/No connection/);
    expect(authMessage({ status: 500, message: 'database error: relation x' })).toBe('Something went wrong. Please try again.');
  });
});
