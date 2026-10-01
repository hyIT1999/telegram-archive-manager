import type { TelegramAccount, TelegramDialog } from '@tam/database';
import {
  TelegramAuthState,
  type TelegramDialogDto,
  type TelegramStatusDto,
  type WorkerHeartbeat,
} from '@tam/shared';

function isPending(state: TelegramAuthState): boolean {
  return state === TelegramAuthState.CODE_SENT || state === TelegramAuthState.PASSWORD_REQUIRED;
}

/**
 * The login state as the worker persisted it, combined with the worker's liveness. A pending login
 * whose deadline passed is shown as logged out (the worker discards it on the next step).
 */
export function toTelegramStatusDto(
  account: TelegramAccount | null,
  heartbeat: WorkerHeartbeat | null,
  now: Date = new Date(),
): TelegramStatusDto {
  const stored = account?.authState ?? TelegramAuthState.LOGGED_OUT;
  const deadline = account?.codeExpiresAt ?? null;
  const expired = isPending(stored) && (deadline === null || deadline.getTime() <= now.getTime());
  const state = expired ? TelegramAuthState.LOGGED_OUT : stored;
  const pending = isPending(state);
  const ready = state === TelegramAuthState.READY;

  return {
    worker: heartbeat ? 'online' : 'offline',
    connection: heartbeat?.telegram?.state ?? null,
    connectionDetail: heartbeat?.telegram?.detail ?? null,
    state,
    user:
      ready && account && account.telegramUserId !== null
        ? {
            id: account.telegramUserId.toString(),
            username: account.username,
            displayName: account.displayName ?? account.username ?? 'Telegram user',
          }
        : null,
    phoneMasked: pending || ready ? (account?.phoneMasked ?? null) : null,
    codeType: pending ? (account?.codeType ?? null) : null,
    nextCodeType: pending ? (account?.nextCodeType ?? null) : null,
    codeResendAt: pending ? (account?.codeResendAt?.toISOString() ?? null) : null,
    lastError: account?.lastError ?? null,
    dialogsRefreshedAt: account?.dialogsRefreshedAt?.toISOString() ?? null,
  };
}

export function toTelegramDialogDto(
  dialog: TelegramDialog,
  archivedChannelId: string | null,
  backupLocationId: string | null = null,
): TelegramDialogDto {
  return {
    telegramChatId: dialog.telegramChatId.toString(),
    title: dialog.title,
    username: dialog.username,
    type: dialog.type,
    isProtected: dialog.isProtected,
    isForum: dialog.isForum,
    memberCount: dialog.memberCount,
    archivedChannelId,
    canPost: dialog.canPost,
    canManageTopics: dialog.canManageTopics,
    backupLocationId,
    lastSeenAt: dialog.lastSeenAt.toISOString(),
  };
}
