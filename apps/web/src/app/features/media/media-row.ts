import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HighlightedText } from '../../shared/components/highlighted-text/highlighted-text';
import type { MessageSummaryDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { FavoriteButton } from '../favorites/favorite-button';
import { messageTitle, titleMatches } from '../messages/message-labels';
import { TagChip } from '../tags/tag-chip';
import { MediaDownloadControl } from './media-download-control';
import { durationLabel, fileKind } from './media-labels';

/** Tags a row shows; the rest are on the message page. */
const ROW_TAGS = 3;

/**
 * A document or audio file in a list: what it is, how big, when, its tags, a heart to favorite
 * it, and download or save.
 */
@Component({
  selector: 'app-media-row',
  imports: [
    BytesPipe,
    DatePipe,
    FavoriteButton,
    HighlightedText,
    MatIcon,
    MediaDownloadControl,
    RouterLink,
    TagChip,
  ],
  template: `
    @let message = item();
    @let file = message.media;
    <span class="icon" aria-hidden="true">
      <mat-icon>{{ kind().icon }}</mat-icon>
    </span>
    <div class="text">
      <a class="title" [routerLink]="['/messages', message.id]"
        ><app-highlighted-text [text]="title()" [ranges]="titleRanges()"
      /></a>
      <span class="meta">
        {{ kind().label }}
        @if (file?.size) {
          · {{ file?.size | bytes }}
        }
        @if (length(); as text) {
          · {{ text }}
        }
        · {{ message.postedAt | date: 'mediumDate' }}
        @if (showChannel()) {
          · {{ message.channel.title }}
        }
        @if (showTopic()) {
          @if (message.topic; as topic) {
            · {{ topic.title }}
          }
        }
      </span>
      @if (message.tags.length > 0) {
        <ul class="tags" aria-label="Tags">
          @for (tag of shownTags(); track tag.id) {
            <li><app-tag-chip [tag]="tag" /></li>
          }
          @if (hiddenTags() > 0) {
            <li class="more">+{{ hiddenTags() }}</li>
          }
        </ul>
      }
    </div>
    <app-favorite-button [messageId]="message.id" [favorite]="message.isFavorite" />
    @if (file) {
      <app-media-download-control
        [media]="file"
        [channelId]="message.channel.id"
        [compact]="true"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      padding: 10px 12px;
    }

    .icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .text {
      display: grid;
      flex: 1;
      gap: 2px;
      min-width: 0;
    }

    .title {
      overflow: hidden;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-small);
      text-decoration: none;
      text-overflow: ellipsis;
      white-space: nowrap;

      &:hover {
        text-decoration: underline;
      }
    }

    .meta {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 2px 0 0;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        min-width: 0;
      }
    }

    .more {
      align-items: center;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class MediaRow {
  readonly item = input.required<MessageSummaryDto>();
  readonly showChannel = input(true);
  /** Off on a topic's own page, where every file is in that topic. */
  readonly showTopic = input(true);

  protected readonly title = computed(() => messageTitle(this.item()));
  protected readonly titleRanges = computed(() => titleMatches(this.item()));
  protected readonly shownTags = computed(() => this.item().tags.slice(0, ROW_TAGS));
  protected readonly hiddenTags = computed(() => Math.max(0, this.item().tags.length - ROW_TAGS));
  protected readonly kind = computed(() => {
    const file = this.item().media;
    return fileKind(file?.mimeType, file?.fileName);
  });
  protected readonly length = computed(() => durationLabel(this.item().media?.duration));
}
