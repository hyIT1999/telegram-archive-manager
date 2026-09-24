import type { IAuthKeysRepository } from '@mtcute/core';
import type { SecretBox } from '../crypto/secret-box.js';

/**
 * Wraps mtcute's auth key repository so the keys — which grant full access to the Telegram
 * account — are only ever stored encrypted. Each key is bound to its DC (and temp-key slot).
 */
export class EncryptedAuthKeysRepository implements IAuthKeysRepository {
  constructor(
    private readonly inner: IAuthKeysRepository,
    private readonly box: SecretBox,
  ) {}

  async set(dc: number, key: Uint8Array | null): Promise<void> {
    await this.inner.set(dc, key === null ? null : this.box.seal(key, permanentContext(dc)));
  }

  async get(dc: number): Promise<Uint8Array | null> {
    const sealed = await this.inner.get(dc);
    return sealed === null ? null : this.box.open(sealed, permanentContext(dc));
  }

  async setTemp(dc: number, idx: number, key: Uint8Array | null, expires: number): Promise<void> {
    await this.inner.setTemp(
      dc,
      idx,
      key === null ? null : this.box.seal(key, tempContext(dc, idx)),
      expires,
    );
  }

  async getTemp(dc: number, idx: number, now: number): Promise<Uint8Array | null> {
    const sealed = await this.inner.getTemp(dc, idx, now);
    return sealed === null ? null : this.box.open(sealed, tempContext(dc, idx));
  }

  async deleteByDc(dc: number): Promise<void> {
    await this.inner.deleteByDc(dc);
  }

  async deleteAll(): Promise<void> {
    await this.inner.deleteAll();
  }
}

function permanentContext(dc: number): string {
  return `mtcute:auth_key:${dc}`;
}

function tempContext(dc: number, idx: number): string {
  return `mtcute:temp_auth_key:${dc}:${idx}`;
}
