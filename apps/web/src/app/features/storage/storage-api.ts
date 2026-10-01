import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type {
  ConnectGoogleDriveRequest,
  CreateLocalLocationRequest,
  CreateTelegramLocationRequest,
  GoogleDriveConnectDto,
  GoogleDrivePollDto,
  LocalFolderListDto,
  StorageCheckDto,
  StorageLocationDto,
  StorageLocationListDto,
  UpdateStorageLocationRequest,
} from '../../shared/models';

export const STORAGE_ENDPOINTS = {
  locations: '/api/storage/locations',
  folders: '/api/storage/local/folders',
  googleConnect: '/api/storage/google/connect',
  telegram: '/api/storage/telegram',
} as const;

/** Actions report their failures where they were started (dialog, location card). */
function inlineErrors(): { context: HttpContext } {
  return { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };
}

/**
 * Storage locations: folders on the server and Google Drive folders, where media downloads, and
 * Telegram chats that receive backups.
 */
@Injectable({ providedIn: 'root' })
export class StorageApi {
  private readonly http = inject(HttpClient);

  list(): Observable<StorageLocationListDto> {
    return this.http.get<StorageLocationListDto>(STORAGE_ENDPOINTS.locations);
  }

  /** Subfolders of `path` (inside the allowed roots), or the roots themselves. */
  folders(path?: string | null): Observable<LocalFolderListDto> {
    const params = path ? new HttpParams().set('path', path) : undefined;
    return this.http.get<LocalFolderListDto>(STORAGE_ENDPOINTS.folders, {
      ...(params ? { params } : {}),
      ...inlineErrors(),
    });
  }

  createLocal(request: CreateLocalLocationRequest): Observable<StorageLocationDto> {
    return this.http.post<StorageLocationDto>(STORAGE_ENDPOINTS.locations, request, inlineErrors());
  }

  /** Adds a Telegram chat of the account as a backup chat, once the worker checked it. */
  createTelegram(request: CreateTelegramLocationRequest): Observable<StorageLocationDto> {
    return this.http.post<StorageLocationDto>(STORAGE_ENDPOINTS.telegram, request, inlineErrors());
  }

  update(id: string, request: UpdateStorageLocationRequest): Observable<StorageLocationDto> {
    return this.http.patch<StorageLocationDto>(
      `${STORAGE_ENDPOINTS.locations}/${encodeURIComponent(id)}`,
      request,
      inlineErrors(),
    );
  }

  /**
   * Writes, reads back and removes a small file; reports the free space. A Telegram chat is read
   * again from Telegram instead.
   */
  check(id: string): Observable<StorageCheckDto> {
    return this.http.post<StorageCheckDto>(
      `${STORAGE_ENDPOINTS.locations}/${encodeURIComponent(id)}/check`,
      null,
      inlineErrors(),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(
      `${STORAGE_ENDPOINTS.locations}/${encodeURIComponent(id)}`,
      inlineErrors(),
    );
  }

  /** Starts a Google sign-in with a code for google.com/device. */
  connectGoogle(request: ConnectGoogleDriveRequest): Observable<GoogleDriveConnectDto> {
    return this.http.post<GoogleDriveConnectDto>(STORAGE_ENDPOINTS.googleConnect, request, inlineErrors());
  }

  pollGoogle(flowId: string): Observable<GoogleDrivePollDto> {
    return this.http.post<GoogleDrivePollDto>(
      `${STORAGE_ENDPOINTS.googleConnect}/${encodeURIComponent(flowId)}/poll`,
      null,
      inlineErrors(),
    );
  }
}
