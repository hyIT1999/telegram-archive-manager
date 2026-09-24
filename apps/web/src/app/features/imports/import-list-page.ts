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
      note="Arrives in Phases 2–3"
      title="Importing is on its way"
      message="Connecting your Telegram account arrives in Phase 2; importing channels and tracking import jobs in Phase 3."
    />
  `,
})
export class ImportListPage {}
