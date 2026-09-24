import { hash } from 'argon2';
import { describe, expect, it } from 'vitest';
import {
  createDummyPasswordHash,
  hashPassword,
  PASSWORD_HASH_OPTIONS,
  passwordNeedsRehash,
  verifyPassword,
} from '../../src/auth/password.js';

describe('password hashing', () => {
  it('produces argon2id hashes with the configured parameters and a random salt', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(stored, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(stored, 'Correct horse battery staple')).resolves.toBe(false);
    await expect(verifyPassword(stored, '')).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    const current = await hashPassword('secret passphrase');
    const weaker = await hash('secret passphrase', {
      ...PASSWORD_HASH_OPTIONS,
      memoryCost: 19_456,
      timeCost: 2,
    });
    expect(passwordNeedsRehash(current)).toBe(false);
    expect(passwordNeedsRehash(weaker)).toBe(true);
  });

  it('builds a dummy hash that no user password matches', async () => {
    const dummy = await createDummyPasswordHash();
    expect(dummy).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(dummy, 'correct horse battery staple')).resolves.toBe(false);
  });
});
