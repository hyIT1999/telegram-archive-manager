import { Component, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-import-job-page',
  imports: [EmptyState, MatButton, MatIcon, PageHeader, RouterLink],
  template: `
    <app-page-header eyebrow="Import job" title="Import progress" [subtitle]="'Job ' + id()">
      <a pageActions matButton="outlined" routerLink="/imports">
        <mat-icon>arrow_back</mat-icon>
        Import Jobs
      </a>
    </app-page-header>
    <app-empty-state
      class="surface-card"
      icon="monitoring"
      note="Arrives in Phases 3 and 7"
      title="Import progress is on its way"
      message="Job details arrive in Phase 3; live progress with pause, resume and cancel in Phase 7."
    />
  `,
})
export class ImportJobPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();
}
