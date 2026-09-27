import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Minimum length of a web password (CLI, bootstrap and the account page). */
export const MIN_PASSWORD_LENGTH = 12;

/** Policy for new web passwords: creating a user, resetting or changing a password. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(1024);

/** POST /api/auth/password: the signed-in user changes their own password. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export interface AuthUserDto {
  id: string;
  email: string;
  lastLoginAt: string | null;
}

/** A signed-in browser of the current user (GET /api/auth/sessions). */
export interface SessionDto {
  id: string;
  /** The session of the browser asking. */
  current: boolean;
  createdAt: string;
  /** Updated at most every few minutes while the session is used. */
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RevokeSessionsResultDto {
  /** How many sessions were signed out. */
  revoked: number;
}
