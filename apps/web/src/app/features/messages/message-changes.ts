import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import type { MessageSummaryDto, TagRefDto } from '../../shared/models';
import { FeedStateCache } from './feed-cache';

/** A change to apply to messages; a message it does not concern comes back as the same object. */
export type MessageUpdate = <T extends MessageSummaryDto>(message: T) => T;

/** The message became a favorite, or stopped being one. */
export function favoriteChanged(id: string, isFavorite: boolean): MessageUpdate {
  return (message) => (message.id === id ? { ...message, isFavorite } : message);
}

/** The message was tagged or untagged. */
export function tagsChanged(id: string, tags: readonly TagRefDto[]): MessageUpdate {
  return (message) => (message.id === id ? { ...message, tags: [...tags] } : message);
}

/** A tag was renamed or recolored: every message carrying it shows the new look. */
export function tagEdited(tag: TagRefDto): MessageUpdate {
  return (message) =>
    message.tags.some((carried) => carried.id === tag.id)
      ? { ...message, tags: message.tags.map((carried) => (carried.id === tag.id ? tag : carried)) }
      : message;
}

/** A tag was deleted: no message carries it any more. */
export function tagDeleted(tagId: string): MessageUpdate {
  return (message) =>
    message.tags.some((carried) => carried.id === tagId)
      ? { ...message, tags: message.tags.filter((carried) => carried.id !== tagId) }
      : message;
}

/**
 * Tells every list and page showing messages that favorites or tags changed, and updates the
 * lists kept for Back, so that no screen shows the old state.
 */
@Injectable({ providedIn: 'root' })
export class MessageChanges {
  private readonly cache = inject(FeedStateCache);
  private readonly subject = new Subject<MessageUpdate>();

  readonly updates = this.subject.asObservable();

  publish(update: MessageUpdate): void {
    this.cache.patch(update);
    this.subject.next(update);
  }
}
