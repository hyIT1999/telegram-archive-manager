import { Injectable } from '@nestjs/common';
import { TelegramConnectionState, type WorkerHeartbeat } from '@tam/shared';

export type TelegramStatus = NonNullable<WorkerHeartbeat['telegram']>;

/**
 * What this worker reports about itself in its heartbeat. The api reads it to explain why
 * Telegram actions are unavailable (not configured, another worker owns the session, …).
 */
@Injectable()
export class WorkerStatusService {
  private telegramStatus: TelegramStatus = {
    state: TelegramConnectionState.CONNECTING,
    detail: null,
  };

  telegram(): TelegramStatus {
    return this.telegramStatus;
  }

  setTelegram(state: TelegramConnectionState, detail: string | null = null): void {
    this.telegramStatus = { state, detail };
  }
}
