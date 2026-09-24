import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox, SecretBoxError, isSecretKey } from '../src/index.js';

const key = randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips bytes and strings', () => {
    const box = SecretBox.fromBase64(key);
    const secret = randomBytes(256);
    expect(box.open(box.seal(secret, 'ctx'), 'ctx').equals(secret)).toBe(true);
    expect(box.openString(box.sealString('+84912345678', 'phone'), 'phone')).toBe('+84912345678');
  });

  it('never stores the plaintext and uses a fresh IV every time', () => {
    const box = SecretBox.fromBase64(key);
    const plaintext = Buffer.from('phone_code_hash_value');
    const first = Buffer.from(box.seal(plaintext, 'ctx'));
    const second = Buffer.from(box.seal(plaintext, 'ctx'));
    expect(first.includes(plaintext)).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it('binds each value to its context', () => {
    const box = SecretBox.fromBase64(key);
    const sealed = box.seal(Buffer.from('auth key'), 'mtcute:auth_key:2');
    expect(() => box.open(sealed, 'mtcute:auth_key:4')).toThrow(SecretBoxError);
  });

  it('rejects a different key and tampered data', () => {
    const sealed = SecretBox.fromBase64(key).seal(Buffer.from('secret'), 'ctx');
    const otherBox = SecretBox.fromBase64(randomBytes(32).toString('base64'));
    expect(() => otherBox.open(sealed, 'ctx')).toThrow(/key changed/);

    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
    expect(() => SecretBox.fromBase64(key).open(tampered, 'ctx')).toThrow(SecretBoxError);
    expect(() => SecretBox.fromBase64(key).open(Buffer.from([9, 9, 9]), 'ctx')).toThrow(SecretBoxError);
  });

  it('requires a 32-byte key', () => {
    expect(() => SecretBox.fromBase64(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('isSecretKey', () => {
  it('accepts only the canonical base64 of 32 bytes', () => {
    expect(isSecretKey(key)).toBe(true);
    expect(isSecretKey(randomBytes(16).toString('base64'))).toBe(false);
    expect(isSecretKey(key.replace(/=+$/, ''))).toBe(false);
    expect(isSecretKey('not base64 at all')).toBe(false);
  });
});
