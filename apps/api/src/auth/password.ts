import { randomBytes } from 'node:crypto';
import { argon2id, hash, needsRehash, verify } from 'argon2';

/**
 * argon2id with the second recommended parameter set of RFC 9106 §4
 * (64 MiB memory, 3 passes, 4 lanes). Shared by the login flow and the create-user CLI.
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

/** Resolves to false for a wrong password; rejects only for a malformed stored hash. */
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

/** True when the stored hash was created with weaker/older parameters than PASSWORD_HASH_OPTIONS. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  const { memoryCost, timeCost, parallelism } = PASSWORD_HASH_OPTIONS;
  return needsRehash(passwordHash, { memoryCost, timeCost, parallelism });
}

/**
 * Hash of a random secret. Login verifies against it when the email is unknown, so that
 * unknown and known emails take the same time and cannot be told apart.
 */
export function createDummyPasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString('base64url'));
}
