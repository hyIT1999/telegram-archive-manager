import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type {
  AddMessageTagRequest,
  CreateTagRequest,
  MessageTagsDto,
  TagDto,
  TagListDto,
  UpdateTagRequest,
} from '../../shared/models';

export const TAG_ENDPOINTS = {
  list: '/api/tags',
  tag: (id: string) => `/api/tags/${encodeURIComponent(id)}`,
  messageTags: (messageId: string) => `/api/messages/${encodeURIComponent(messageId)}/tags`,
  messageTag: (messageId: string, tagId: string) =>
    `/api/messages/${encodeURIComponent(messageId)}/tags/${encodeURIComponent(tagId)}`,
} as const;

/** Changes are made from dialogs and editors, which say themselves what went wrong. */
const INLINE = { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };

@Injectable({ providedIn: 'root' })
export class TagsApi {
  private readonly http = inject(HttpClient);

  /** Every tag, with how many messages carry it. */
  list(): Observable<TagListDto> {
    return this.http.get<TagListDto>(TAG_ENDPOINTS.list);
  }

  /** 409 TAG_NAME_TAKEN when the name is in use (without regard to case). */
  create(request: CreateTagRequest): Observable<TagDto> {
    return this.http.post<TagDto>(TAG_ENDPOINTS.list, request, INLINE);
  }

  update(id: string, request: UpdateTagRequest): Observable<TagDto> {
    return this.http.patch<TagDto>(TAG_ENDPOINTS.tag(id), request, INLINE);
  }

  /** The tag is taken off every message that carried it. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(TAG_ENDPOINTS.tag(id), INLINE);
  }

  /** Tags a message with an existing tag, or with a name (a new name creates the tag). */
  tagMessage(messageId: string, request: AddMessageTagRequest): Observable<MessageTagsDto> {
    return this.http.post<MessageTagsDto>(TAG_ENDPOINTS.messageTags(messageId), request, INLINE);
  }

  untagMessage(messageId: string, tagId: string): Observable<MessageTagsDto> {
    return this.http.delete<MessageTagsDto>(TAG_ENDPOINTS.messageTag(messageId, tagId), INLINE);
  }
}
