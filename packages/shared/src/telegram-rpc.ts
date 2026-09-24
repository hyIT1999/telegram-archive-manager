import { z } from 'zod';

/**
 * Request/reply RPC between the api and the worker that owns the Telegram connection.
 *
 * It runs over Redis pub/sub rather than a BullMQ queue on purpose: login steps carry the login
 * code and the 2FA password, and published messages are never persisted (a queued job would land
 * in Redis' append-only file). PUBLISH also reports how many subscribers received a request, so
 * the api learns immediately when no worker holds the Telegram connection, and a stale request can
 * never run later.
 */
export const TELEGRAM_RPC_CHANNELS = {
  /** Only the worker holding the Telegram owner lease subscribes here. */
  request: 'tam:tg:rpc:request',
  /** Each api process listens on `${replyPrefix}${instanceId}`. */
  replyPrefix: 'tam:tg:rpc:reply:',
} as const;

export const telegramRpcCallSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('auth.phone'), phoneNumber: z.string().min(1).max(32) }),
  z.object({ method: z.literal('auth.code'), code: z.string().min(1).max(64) }),
  z.object({ method: z.literal('auth.resend') }),
  z.object({ method: z.literal('auth.password'), password: z.string().min(1).max(256) }),
  z.object({ method: z.literal('auth.logout') }),
  z.object({ method: z.literal('dialogs.refresh') }),
]);
export type TelegramRpcCall = z.infer<typeof telegramRpcCallSchema>;
export type TelegramRpcMethod = TelegramRpcCall['method'];

export const telegramRpcRequestSchema = z.object({
  id: z.uuid(),
  replyTo: z.string().startsWith(TELEGRAM_RPC_CHANNELS.replyPrefix),
  /** Epoch ms after which the caller has given up; the worker skips expired requests. */
  deadline: z.number().int().positive(),
  call: telegramRpcCallSchema,
});
export type TelegramRpcRequest = z.infer<typeof telegramRpcRequestSchema>;

export const telegramRpcErrorSchema = z.object({
  /** A TelegramErrorCode or ApiErrorCode. */
  code: z.string().min(1),
  message: z.string(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});
export type TelegramRpcError = z.infer<typeof telegramRpcErrorSchema>;

/**
 * Success carries no payload: the worker persists every state change first, and the api then
 * reads the single source of truth (PostgreSQL).
 */
export const telegramRpcReplySchema = z.union([
  z.object({ id: z.uuid(), ok: z.literal(true) }),
  z.object({ id: z.uuid(), ok: z.literal(false), error: telegramRpcErrorSchema }),
]);
export type TelegramRpcReply = z.infer<typeof telegramRpcReplySchema>;
