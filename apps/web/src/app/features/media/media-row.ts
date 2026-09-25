import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { MessageSummaryDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { messageTitle } from '../messages/message-labels';
import { MediaDownloadControl } from './media-download-control';
import { durationLabel, fileKind } from './media-labels';

/** A document or audio file in a list: what it is, how big, when, and download or save. */
@Component({
  selector: 'app-media-row',
  imports: [BytesPipe, DatePipe, MatIcon, MediaDownloadControl, RouterLink],
  template: `
    @let message = item();
    @let file = message.media;
    <span class="icon" aria-hidden="true">
      <mat-icon>{{ kind().icon }}</mat-icon>
    </span>
    <div class="text">
      <a class="title" [routerLink]="['/messages', message.id]">{{ title() }}</a>
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
    </div>
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
  `,
})
export class MediaRow {
  readonly item = input.required<MessageSummaryDto>();
  readonly showChannel = input(true);
  /** Off on a topic's own page, where every file is in that topic. */
  readonly showTopic = input(true);

  protected readonly title = computed(() => messageTitle(this.item()));
  protected readonly kind = computed(() => {
    const file = this.item().media;
    return fileKind(file?.mimeType, file?.fileName);
  });
  protected readonly length = computed(() => durationLabel(this.item().media?.duration));
}
