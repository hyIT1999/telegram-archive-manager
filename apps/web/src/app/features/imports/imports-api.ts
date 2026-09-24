import { HttpClient, HttpContext, HttpParams, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { ImportJobDto, ImportRequest, JobStatus, Page } from '../../shared/models';

export type ImportJobAction = 'pause' | 'resume' | 'cancel';

export const IMPORT_ENDPOINTS = {
  jobs: '/api/import-jobs',
  job: (id: string) => `/api/import-jobs/${encodeURIComponent(id)}`,
  action: (id: string, action: ImportJobAction) =>
    `/api/import-jobs/${encodeURIComponent(id)}/${action}`,
  start: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/import`,
} as const;

export interface ImportJobListParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly channelId?: string;
  readonly status?: readonly JobStatus[];
}

export interface StartedImport {
  readonly job: ImportJobDto;
  /** False when the same import was already unfinished (the request is idempotent). */
  readonly created: boolean;
}

/** Actions report their failures next to the button that started them. */
function inlineErrors(): { context: HttpContext } {
  return { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };
}

/** The api's import endpoints: starting imports and following, pausing or cancelling jobs. */
@Injectable({ providedIn: 'root' })
export class ImportsApi {
  private readonly http = inject(HttpClient);

  /** Starts importing a channel's history (`POST /api/channels/:id/import`). */
  start(channelId: string, request: ImportRequest): Observable<StartedImport> {
    return this.http
      .post<ImportJobDto>(IMPORT_ENDPOINTS.start(channelId), request, {
        observe: 'response',
        ...inlineErrors(),
      })
      .pipe(
        map((response) => {
          if (!response.body) {
            throw new Error('The server answered without the import job');
          }
          return { job: response.body, created: response.status === HttpStatusCode.Accepted };
        }),
      );
  }

  /** Newest first, keyset-paginated by `nextCursor`. */
  list(params: ImportJobListParams = {}): Observable<Page<ImportJobDto>> {
    let httpParams = new HttpParams();
    if (params.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit);
    }
    if (params.cursor) {
      httpParams = httpParams.set('cursor', params.cursor);
    }
    if (params.channelId) {
      httpParams = httpParams.set('channelId', params.channelId);
    }
    if (params.status?.length) {
      httpParams = httpParams.set('status', params.status.join(','));
    }
    return this.http.get<Page<ImportJobDto>>(IMPORT_ENDPOINTS.jobs, { params: httpParams });
  }

  get(id: string): Observable<ImportJobDto> {
    return this.http.get<ImportJobDto>(IMPORT_ENDPOINTS.job(id));
  }

  /** Pauses, resumes or cancels a job; answers with the job as it stands afterwards. */
  act(id: string, action: ImportJobAction): Observable<ImportJobDto> {
    return this.http.post<ImportJobDto>(IMPORT_ENDPOINTS.action(id, action), null, inlineErrors());
  }
}
