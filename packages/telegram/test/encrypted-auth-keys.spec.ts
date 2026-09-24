import { randomBytes } from 'node:crypto';
import type { IAuthKeysRepository } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import { EncryptedAuthKeysRepository, SecretBox } from '../src/index.js';

/** In-memory stand-in for mtcute's PostgresAuthKeysRepository. */
class MemoryAuthKeys implements IAuthKeysRepository {
  readonly permanent = new Map<number, Uint8Array>();
  readonly temporary = new Map<string, { key: Uint8Array; expires: number }>();

  set(dc: number, key: Uint8Array | null): void {
    if (key === null) this.permanent.delete(dc);
    else this.permanent.set(dc, key);
  }
  get(dc: number): Uint8Array | null {
    return this.permanent.get(dc) ?? null;
  }
  setTemp(dc: number, idx: number, key: Uint8Array | null, expires: number): void {
    if (key === null) this.temporary.delete(`${dc}:${idx}`);
    else this.temporary.set(`${dc}:${idx}`, { key, expires });
  }
  getTemp(dc: number, idx: number, now: number): Uint8Array | null {
    const entry = this.temporary.get(`${dc}:${idx}`);
    return entry && now < entry.expires ? entry.key : null;
  }
  deleteByDc(dc: number): void {
    this.permanent.delete(dc);
  }
  deleteAll(): void {
    this.permanent.clear();
    this.temporary.clear();
  }
}

function setup() {
  const inner = new MemoryAuthKeys();
  const repo = new EncryptedAuthKeysRepository(inner, SecretBox.fromBase64(randomBytes(32).toString('base64')));
  return { inner, repo };
}

describe('EncryptedAuthKeysRepository', () => {
  it('stores only ciphertext and returns the original key', async () => {
    const { inner, repo } = setup();
    const authKey = randomBytes(256);
    await repo.set(2, authKey);

    const stored = inner.get(2);
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!).includes(authKey.subarray(0, 32))).toBe(false);
    expect(Buffer.from((await repo.get(2))!).equals(authKey)).toBe(true);
  });

  it('does not accept a key copied to another DC', async () => {
    const { inner, repo } = setup();
    await repo.set(2, randomBytes(256));
    inner.set(4, inner.get(2));
    await expect(repo.get(4)).rejects.toThrow();
  });

  it('encrypts temporary keys and forwards deletions', async () => {
    const { inner, repo } = setup();
    const tempKey = randomBytes(256);
    await repo.setTemp(1, 0, tempKey, 2_000);
    expect(Buffer.from((await repo.getTemp(1, 0, 1_000))!).equals(tempKey)).toBe(true);
    expect(await repo.getTemp(1, 0, 3_000)).toBeNull();

    await repo.set(1, randomBytes(256));
    await repo.set(1, null);
    expect(inner.get(1)).toBeNull();
    await repo.set(3, randomBytes(256));
    await repo.deleteAll();
    expect(inner.permanent.size + inner.temporary.size).toBe(0);
  });
});
