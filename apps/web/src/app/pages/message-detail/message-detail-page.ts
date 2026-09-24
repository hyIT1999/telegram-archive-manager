import { Component, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-message-detail-page',
  imports: [EmptyState, MatButton, MatIcon, PageHeader, RouterLink],
  template: `
    <app-page-header eyebrow="Message" title="Message details" [subtitle]="'Archive ID ' + id()">
      <a pageActions matButton="outlined" routerLink="/messages">
        <mat-icon>arrow_back</mat-icon>
        All messages
      </a>
    </app-page-header>
    <app-empty-state
      class="surface-card"
      icon="article"
      note="Arrives in Phase 5"
      title="Message details are on their way"
      message="Viewing a message with its media, tags, album and Telegram info arrives in Phase 5."
    />
  `,
})
export class MessageDetailPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();
}
