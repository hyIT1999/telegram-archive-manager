import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Focuses the host element when a single-key shortcut ("/" by default) is pressed anywhere on
 * the page, unless the user is already typing in a field.
 *
 * Usage: `<input appFocusShortcut />` or `<input appFocusShortcut="s" />`.
 */
@Directive({
  selector: '[appFocusShortcut]',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
    '[attr.aria-keyshortcuts]': 'key()',
  },
})
export class FocusShortcut {
  readonly key = input('/', {
    alias: 'appFocusShortcut',
    transform: (value: string | undefined) => value || '/',
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (
      event.key !== this.key() ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.defaultPrevented ||
      isEditable(event.target)
    ) {
      return;
    }
    event.preventDefault();
    this.host.nativeElement.focus();
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
