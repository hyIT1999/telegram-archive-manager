import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import type { MessageEntityDto } from '../../shared/models';
import { type TextRun, formatText } from './text-format';

/**
 * A message's text with its Telegram formatting (bold, links, code, quotes, spoilers…). Built from
 * runs, never from HTML, so nothing in a message can inject markup.
 */
@Component({
  selector: 'app-message-text',
  template: `
    @for (block of blocks(); track $index) {
      @switch (block.kind) {
        @case ('pre') {
          <pre class="pre" [attr.data-language]="block.language"><code>{{ block.text }}</code></pre>
        }
        @case ('quote') {
          <blockquote class="quote">
            <ng-container
              *ngTemplateOutlet="runsTemplate; context: { runs: block.runs, block: $index }"
            />
          </blockquote>
        }
        @default {
          <p class="text">
            <ng-container
              *ngTemplateOutlet="runsTemplate; context: { runs: block.runs, block: $index }"
            />
          </p>
        }
      }
    }

    <ng-template #runsTemplate let-runs="runs" let-block="block">
      @for (run of asRuns(runs); track $index) {
        @if (run.href) {
          <a
            [href]="run.href"
            [class]="run.classes"
            target="_blank"
            rel="noopener noreferrer nofollow"
            >{{ run.text }}</a
          >
        } @else if (run.spoiler && !revealed().has(block + ':' + $index)) {
          <span
            [class]="run.classes"
            role="button"
            tabindex="0"
            title="Show the hidden text"
            (click)="reveal(block + ':' + $index)"
            (keydown.enter)="reveal(block + ':' + $index)"
            >{{ run.text }}</span
          >
        } @else {
          <span [class]="run.classes" [class.shown]="run.spoiler">{{ run.text }}</span>
        }
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      display: grid;
      gap: 12px;
      font: var(--mat-sys-body-large);
      overflow-wrap: anywhere;
    }

    .text,
    .quote {
      margin: 0;
      white-space: pre-wrap;
    }

    .quote {
      padding: 4px 0 4px 12px;
      border-left: 3px solid var(--mat-sys-primary);
      color: var(--mat-sys-on-surface-variant);
    }

    .pre {
      margin: 0;
      padding: 12px 16px;
      overflow-x: auto;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container-high);
      font:
        0.9em/1.5 ui-monospace,
        'Cascadia Code',
        Consolas,
        monospace;
    }

    .b {
      font-weight: 600;
    }

    .i {
      font-style: italic;
    }

    .u {
      text-decoration: underline;
    }

    .s {
      text-decoration: line-through;
    }

    .u.s {
      text-decoration: underline line-through;
    }

    .code {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--mat-sys-surface-container-high);
      font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
      font-size: 0.9em;
    }

    .tag {
      color: var(--mat-sys-primary);
    }

    .spoiler:not(.shown) {
      border-radius: 4px;
      background: var(--mat-sys-on-surface-variant);
      color: transparent;
      cursor: pointer;
    }
  `,
})
export class MessageText {
  readonly text = input<string | null>(null);
  readonly entities = input<readonly MessageEntityDto[]>([]);

  protected readonly blocks = computed(() => formatText(this.text(), this.entities()));
  protected readonly revealed = signal<ReadonlySet<string>>(new Set());

  protected reveal(key: string): void {
    this.revealed.update((keys) => new Set(keys).add(key));
  }

  /** Types the template context (ng-template variables are `any`). */
  protected asRuns(runs: unknown): readonly TextRun[] {
    return runs as readonly TextRun[];
  }
}
