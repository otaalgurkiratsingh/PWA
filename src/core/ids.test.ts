import { afterEach, describe, expect, it, vi } from 'vitest';
import { Id } from '@shared/contracts';
import { newId } from './ids';

afterEach(() => vi.unstubAllGlobals());

describe('newId', () => {
  it('produces valid unique v4 UUIDs even without crypto.randomUUID (insecure context)', () => {
    vi.stubGlobal('isSecureContext', false);
    const ids = Array.from({ length: 500 }, newId);
    for (const id of ids) expect(Id.safeParse(id).success).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
