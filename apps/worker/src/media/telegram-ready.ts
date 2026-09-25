import type { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import type { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import type { TelegramApiProvider } from '../telegram/telegram.tokens.js';

/**
 * Whether background work may call Telegram now: connected, logged in, and not asked to wait.
 * Checked before starting anything, so waiting costs no tries and no requests.
 */
export async function telegramReady(
  telegram: TelegramApiProvider,
  auth: TelegramAuthService,
  cooldown: TelegramCooldown,
): Promise<boolean> {
  if (cooldown.remainingMs() > 0) {
    return false;
  }
  try {
    void telegram.api;
  } catch {
    return false;
  }
  return auth.isReady();
}
