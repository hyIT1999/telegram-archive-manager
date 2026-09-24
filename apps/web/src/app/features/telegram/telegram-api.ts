import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type {
  TelegramAuthenticateRequest,
  TelegramDialogListDto,
  TelegramStatusDto,
} from '../../shared/models';

export const TELEGRAM_ENDPOINTS = {
  status: '/api/telegram/status',
  authenticate: '/api/telegram/authenticate',
  logout: '/api/telegram/logout',
  chats: '/api/telegram/chats',
  refreshChats: '/api/telegram/chats/refresh',
} as const;

/** Actions report their failures next to the button or form that started them. */
function inlineErrors(): { context: HttpContext } {
  return { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };
}

/**
 * The api's Telegram endpoints. Every action is carried out by the worker that owns the Telegram
 * connection; the answers are the state it stored afterwards.
 */
@Injectable({ providedIn: 'root' })
export class TelegramApi {
  private readonly http = inject(HttpClient);

  /** Worker connection and login state. */
  status(): Observable<TelegramStatusDto> {
    return this.http.get<TelegramStatusDto>(TELEGRAM_ENDPOINTS.status);
  }

  /** One login step (phone, code, 2FA password or resend); answers with the new state. */
  authenticate(request: TelegramAuthenticateRequest): Observable<TelegramStatusDto> {
    return this.http.post<TelegramStatusDto>(
      TELEGRAM_ENDPOINTS.authenticate,
      request,
      inlineErrors(),
    );
  }

  /** Logs out of Telegram, or cancels a login in progress. */
  logout(): Observable<TelegramStatusDto> {
    return this.http.post<TelegramStatusDto>(TELEGRAM_ENDPOINTS.logout, null, inlineErrors());
  }

  /** The cached list of channels and groups the account can access. */
  chats(): Observable<TelegramDialogListDto> {
    return this.http.get<TelegramDialogListDto>(TELEGRAM_ENDPOINTS.chats);
  }

  /** Asks the worker to re-read the chat list; answers with the list, flagged as refreshing. */
  refreshChats(): Observable<TelegramDialogListDto> {
    return this.http.post<TelegramDialogListDto>(
      TELEGRAM_ENDPOINTS.refreshChats,
      null,
      inlineErrors(),
    );
  }
}
