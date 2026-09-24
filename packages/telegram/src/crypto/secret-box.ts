import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * AES-256-GCM authenticated encryption for secrets at rest: the Telegram auth key, the pending
 * login's phone number and phone_code_hash. Layout: version (1 byte) | iv (12) | tag (16) | data.
 *
 * Every value is bound to a `context` string (used as additional authenticated data), so a
 * ciphertext copied into another field or another DC's row fails to decrypt instead of being
 * silently accepted.
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** `key` is TELEGRAM_SESSION_KEY: 32 random bytes, base64-encoded. */
  static fromBase64(key: string): SecretBox {
    const bytes = Buffer.from(key, 'base64');
    if (bytes.length !== KEY_BYTES) {
      throw new SecretBoxError(`The session key must be ${KEY_BYTES} bytes (base64-encoded)`);
    }
    return new SecretBox(bytes);
  }

  seal(plaintext: Uint8Array, context: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.of(FORMAT_VERSION), iv, cipher.getAuthTag(), data]);
  }

  open(sealed: Uint8Array, context: string): Buffer {
    const bytes = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    if (bytes.length < HEADER_BYTES || bytes[0] !== FORMAT_VERSION) {
      throw new SecretBoxError('Unsupported or corrupted encrypted value');
    }
    const iv = bytes.subarray(1, 1 + IV_BYTES);
    const tag = bytes.subarray(1 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]);
    } catch {
      throw new SecretBoxError(
        'Cannot decrypt a stored secret: TELEGRAM_SESSION_KEY changed or the data was tampered with',
      );
    }
  }

  sealString(value: string, context: string): Uint8Array<ArrayBuffer> {
    return this.seal(Buffer.from(value, 'utf8'), context);
  }

  openString(sealed: Uint8Array, context: string): string {
    return this.open(sealed, context).toString('utf8');
  }
}
