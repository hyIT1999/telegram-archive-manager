import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-not-found-page',
  imports: [EmptyState, MatButton, MatIcon, RouterLink],
  template: `
    <h1 class="sr-only">Page not found</h1>
    <app-empty-state
      class="surface-card"
      icon="explore_off"
      title="This page is not in the archive"
      message="The address may be mistyped, or the page has moved."
    >
      <a matButton="filled" routerLink="/dashboard">
        <mat-icon>space_dashboard</mat-icon>
        Back to the dashboard
      </a>
    </app-empty-state>
  `,
})
export class NotFoundPage {}
