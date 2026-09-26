import { Component, computed, input } from '@angular/core';
import type { TextRange } from '../../models';
import { highlightParts } from '../../text/highlight';

/**
 * A text with the words a search found in it marked (plain text elsewhere). Every part sits in an
 * element, so the template's line breaks never add spaces to the text.
 */
@Component({
  selector: 'app-highlighted-text',
  template: `@for (part of parts(); track $index) {
    @if (part.marked) {
      <mark>{{ part.text }}</mark>
    } @else {
      <span>{{ part.text }}</span>
    }
  }`,
  styles: `
    mark {
      border-radius: 2px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
  `,
})
export class HighlightedText {
  readonly text = input.required<string>();
  /** [offset, length] pairs, as the search API sends them. */
  readonly ranges = input<readonly TextRange[] | null | undefined>(null);

  protected readonly parts = computed(() => highlightParts(this.text(), this.ranges()));
}
