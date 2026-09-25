import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { MessageSummaryDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { MEDIA_ENDPOINTS } from '../media/media-api';
import { durationLabel } from '../media/media-labels';
import type { FeedEntry } from './feed-groups';
import { mediaStatusLabel, messageTitle, typeIcon, typeLabel } from './message-labels';

/** Previews shown for an album; the rest is summed up as "+N". */
const ALBUM_PREVIEWS = 6;

/**
 * A message in a feed: channel, topic and date, then its text, file or album. Everything links to
 * the message page (and the channel and topic to theirs).
 */
@Component({
  selector: 'app-message-card',
  imports: [BytesPipe, DatePipe, MatIcon, RouterLink],
  templateUrl: './message-card.html',
  styleUrl: './message-card.scss',
})
export class MessageCard {
  readonly entry = input.required<FeedEntry>();
  readonly showChannel = input(true);
  /** Off on a topic's own page, where every message is in that topic. */
  readonly showTopic = input(true);

  protected readonly items = computed<readonly MessageSummaryDto[]>(() => {
    const entry = this.entry();
    return entry.kind === 'album' ? entry.items : [entry.item];
  });
  protected readonly first = computed(() => this.items()[0] as MessageSummaryDto);
  protected readonly album = computed(() => this.entry().kind === 'album');
  protected readonly previews = computed(() => this.items().slice(0, ALBUM_PREVIEWS));
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.items().length - ALBUM_PREVIEWS),
  );
  /** An album's caption sits on one of its messages, usually the first. */
  protected readonly excerpt = computed(
    () => this.items().find((item) => item.excerpt !== null)?.excerpt ?? null,
  );
  /** Text messages show their text; messages with a file are named after it. */
  protected readonly title = computed(() => {
    const first = this.first();
    return first.media ? messageTitle(first) : null;
  });

  protected thumbnail(item: MessageSummaryDto): string | null {
    return item.media?.hasThumbnail ? MEDIA_ENDPOINTS.thumbnail(item.media.id) : null;
  }

  protected icon(item: MessageSummaryDto): string {
    return typeIcon(item.type);
  }

  protected label(item: MessageSummaryDto): string {
    return typeLabel(item.type);
  }

  protected length(item: MessageSummaryDto): string | null {
    return durationLabel(item.media?.duration);
  }

  protected status(item: MessageSummaryDto): string | null {
    return item.media ? mediaStatusLabel(item.media) : null;
  }
}
