import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const DEFAULT_ICONS: Record<NoticeTone, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  success: 'check_circle',
};

/**
 * Inline message box; projected content is the message. Errors are announced right away
 * (role=alert), everything else politely (role=status).
 */
@Component({
  selector: 'app-notice',
  imports: [MatIcon],
  host: {
    '[attr.role]': "tone() === 'error' ? 'alert' : 'status'",
    '[attr.data-tone]': 'tone()',
  },
  template: `
    <mat-icon class="icon" aria-hidden="true">{{ iconName() }}</mat-icon>
    <div class="body">
      @if (title()) {
        <p class="title">{{ title() }}</p>
      }
      <div class="text"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }

    :host([data-tone='warning']) {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    :host([data-tone='error']) {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    :host([data-tone='success']) {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .icon {
      flex: none;
    }

    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding-top: 1px;
    }

    .title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .text {
      font: var(--mat-sys-body-medium);
      overflow-wrap: anywhere;
    }
  `,
})
export class Notice {
  readonly tone = input<NoticeTone>('info');
  readonly title = input<string>();
  /** Material Symbols name; defaults to one matching the tone. */
  readonly icon = input<string>();

  protected readonly iconName = computed(() => this.icon() ?? DEFAULT_ICONS[this.tone()]);
}
