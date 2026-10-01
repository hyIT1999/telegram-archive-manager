import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type {
  ChannelBackupDto,
  MessageBackupDto,
  RequestBackupRequest,
  RetryBackupsDto,
} from '../../shared/models';

export const BACKUP_ENDPOINTS = {
  channel: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/backup`,
  retry: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/backup/retry`,
  verify: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/backup/verify`,
  message: (messageId: string) => `/api/messages/${encodeURIComponent(messageId)}/backup`,
  messageBackups: (messageId: string) => `/api/messages/${encodeURIComponent(messageId)}/backups`,
} as const;

export interface BackupPolling {
  /** Re-read a backup this often while messages upload (or Verify runs). */
  readonly activeMs: number;
  /** …and this often otherwise (backups may start any time). */
  readonly idleMs: number;
}

/** Polling while live updates cannot arrive, and while Verify runs. */
export const BACKUP_POLLING = new InjectionToken<BackupPolling>('BACKUP_POLLING', {
  providedIn: 'root',
  factory: () => ({ activeMs: 2_000, idleMs: 10_000 }),
});

/** Actions report their failures next to the button that started them. */
function inlineErrors(): { context: HttpContext } {
  return { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };
}

/** Telegram backups: of a channel (progress, retries, Verify) and of single messages. */
@Injectable({ providedIn: 'root' })
export class BackupsApi {
  private readonly http = inject(HttpClient);

  /** Where the channel's backup stands (`GET /api/channels/:id/backup`). */
  channel(channelId: string): Observable<ChannelBackupDto> {
    return this.http.get<ChannelBackupDto>(BACKUP_ENDPOINTS.channel(channelId));
  }

  /** Puts every failed message of the channel back in line. */
  retryFailed(channelId: string): Observable<RetryBackupsDto> {
    return this.http.post<RetryBackupsDto>(BACKUP_ENDPOINTS.retry(channelId), {}, inlineErrors());
  }

  /** Starts checking every copy of the channel in its backup chat; results arrive live. */
  verify(channelId: string): Observable<ChannelBackupDto> {
    return this.http.post<ChannelBackupDto>(BACKUP_ENDPOINTS.verify(channelId), {}, inlineErrors());
  }

  /**
   * "Back up now" (or, with `force`, "Back up again") for a message and the rest of its album,
   * whatever the channel's switch says.
   */
  request(
    messageId: string,
    request: Partial<RequestBackupRequest> = {},
  ): Observable<MessageBackupDto> {
    return this.http.post<MessageBackupDto>(
      BACKUP_ENDPOINTS.message(messageId),
      request,
      inlineErrors(),
    );
  }

  /** The copies of one message in backup chats. */
  messageBackups(messageId: string): Observable<MessageBackupDto[]> {
    return this.http.get<MessageBackupDto[]>(BACKUP_ENDPOINTS.messageBackups(messageId));
  }
}
