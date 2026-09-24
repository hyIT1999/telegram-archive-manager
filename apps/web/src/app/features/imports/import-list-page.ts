import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-import-list-page',
  imports: [EmptyState, MatButton, MatIcon, PageHeader, RouterLink],
  template: `
    <app-page-header
      eyebrow="Manage"
      title="Import Jobs"
      subtitle="Imports of Telegram history into the archive, with their progress."
    >
      <a pageActions matButton="filled" routerLink="/imports/new">
        <mat-icon>add</mat-icon>
        New import
      </a>
    </app-page-header>
    <app-empty-state
      class="surface-card"
      icon="download"
      note="Arrives in Phase 3"
      title="Import jobs are on their way"
      message="Importing channel history and tracking import jobs arrive in Phase 3. You can already connect Telegram and add chats to the archive with New import."
    >
      <a matButton="filled" routerLink="/imports/new">
        <mat-icon>add</mat-icon>
        New import
      </a>
    </app-empty-state>
  `,
})
export class ImportListPage {}
