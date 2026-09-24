import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-import-wizard-page',
  imports: [EmptyState, MatButton, MatIcon, PageHeader, RouterLink],
  template: `
    <app-page-header
      eyebrow="Manage"
      title="New import"
      subtitle="Connect Telegram, pick a chat, choose how much history to keep, then start."
    >
      <a pageActions matButton="outlined" routerLink="/imports">
        <mat-icon>arrow_back</mat-icon>
        Import Jobs
      </a>
    </app-page-header>
    <app-empty-state
      class="surface-card"
      icon="move_to_inbox"
      note="Arrives in Phases 2–3"
      title="The import wizard is on its way"
      message="Signing in to Telegram and choosing a chat arrive in Phase 2; import modes and starting the import in Phase 3."
    />
  `,
})
export class ImportWizardPage {}
