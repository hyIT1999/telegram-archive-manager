import { DatePipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { MessageSummaryDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { messageTitle, typeIcon } from '../messages/message-labels';
import { MEDIA_ENDPOINTS } from './media-api';
import { durationLabel } from './media-labels';

/**
 * A video or image in a gallery: Telegram's preview, length, whether it is downloaded, and a link
 * to its message. With `opens`, a plain click opens a viewer instead (modified clicks still follow
 * the link, e.g. into a new tab).
 */
@Component({
  selector: 'app-media-tile',
  imports: [BytesPipe, DatePipe, MatIcon, RouterLink],
  template: `
    @let message = item();
    @let file = message.media;
    <a class="tile" [routerLink]="['/messages', message.id]" (click)="clicked($event)">
      <span class="frame" [class.square]="square()">
        @if (file?.hasThumbnail && !thumbnailFailed()) {
          <img
            [src]="thumbnail()"
            alt=""
            loading="lazy"
            decoding="async"
            (error)="thumbnailFailed.set(true)"
          />
        } @else {
          <mat-icon class="placeholder" aria-hidden="true">{{ icon() }}</mat-icon>
        }
        @if (length(); as text) {
          <span class="badge length">{{ text }}</span>
        }
        @if (file?.downloadStatus === 'DOWNLOADED') {
          <span class="badge saved" title="Downloaded">
            <mat-icon aria-hidden="true">download_done</mat-icon>
            <span class="sr-only">Downloaded</span>
          </span>
        } @else if (file?.downloadStatus === 'DOWNLOADING') {
          <span class="badge saved">{{ file?.downloadProgress }}%</span>
        }
      </span>
      <span class="title">{{ title() }}</span>
      <span class="meta">
        {{ message.postedAt | date: 'mediumDate' }}
        @if (file?.size) {
          · {{ file?.size | bytes }}
        }
        @if (showChannel()) {
          · {{ message.channel.title }}
        }
      </span>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .tile {
      display: grid;
      gap: 6px;
      color: inherit;
      text-decoration: none;
      border-radius: var(--mat-sys-corner-medium);

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 4px;
      }

      &:hover .frame img {
        transform: scale(1.03);
      }
    }

    .frame {
      position: relative;
      display: grid;
      place-items: center;
      overflow: hidden;
      aspect-ratio: 16 / 9;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);

      &.square {
        aspect-ratio: 1;
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 200ms ease;
      }
    }

    .placeholder {
      width: 40px;
      height: 40px;
      font-size: 40px;
      color: var(--mat-sys-on-surface-variant);
    }

    .badge {
      position: absolute;
      display: flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: var(--mat-sys-corner-small);
      background: rgb(0 0 0 / 72%);
      color: #fff;
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
    }

    .length {
      right: 6px;
      bottom: 6px;
    }

    .saved {
      top: 6px;
      right: 6px;
    }

    .title {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      font: var(--mat-sys-title-small);
      overflow-wrap: anywhere;
    }

    .meta {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    @media (prefers-reduced-motion: reduce) {
      .frame img {
        transition: none;
      }
    }
  `,
})
export class MediaTile {
  readonly item = input.required<MessageSummaryDto>();
  readonly showChannel = input(true);
  /** Square previews (images) instead of 16:9 (videos). */
  readonly square = input(false);
  /** A plain click emits `open` instead of following the link. */
  readonly opens = input(false);
  readonly open = output<void>();

  protected readonly thumbnailFailed = signal(false);
  protected readonly title = computed(() => messageTitle(this.item()));
  protected readonly icon = computed(() => typeIcon(this.item().type));
  protected readonly length = computed(() => durationLabel(this.item().media?.duration));
  protected readonly thumbnail = computed(() => {
    const file = this.item().media;
    return file ? MEDIA_ENDPOINTS.thumbnail(file.id) : '';
  });

  protected clicked(event: MouseEvent): void {
    const modified =
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0;
    if (this.opens() && !modified) {
      event.preventDefault();
      this.open.emit();
    }
  }
}
