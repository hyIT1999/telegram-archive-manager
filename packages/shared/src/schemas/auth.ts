import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Policy for creating web users (CLI / bootstrap). */
export const newPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(1024);

export interface AuthUserDto {
  id: string;
  email: string;
  lastLoginAt: string | null;
}
