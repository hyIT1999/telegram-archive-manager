import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FocusShortcut } from './focus-shortcut';
import { InView } from './in-view';

@Component({
  imports: [FocusShortcut],
  template: `
    <input class="search" appFocusShortcut />
    <input class="other" [appFocusShortcut]="otherKey()" />
    <textarea class="notes"></textarea>
  `,
})
class ShortcutHost {
  readonly otherKey = signal('s');
}

@Component({
  imports: [InView],
  template: `<div class="sentinel" inViewMargin="100px" (appInView)="seen = seen + 1"></div>`,
})
class InViewHost {
  seen = 0;
}

/** Records the observers the directive creates, and lets a test say an element came into view. */
class FakeIntersectionObserver {
  static created: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.created.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  report(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('FocusShortcut', () => {
  function press(
    key: string,
    init: KeyboardEventInit = {},
    target: EventTarget = document.body,
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('focuses its field on "/" (or its own key), and announces the shortcut', async () => {
    const fixture = TestBed.createComponent(ShortcutHost);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const search = page.querySelector<HTMLInputElement>('.search');
    const other = page.querySelector<HTMLInputElement>('.other');
    expect(search?.getAttribute('aria-keyshortcuts')).toBe('/');
    expect(other?.getAttribute('aria-keyshortcuts')).toBe('s');

    const slash = press('/');
    expect(document.activeElement).toBe(search);
    expect(slash.defaultPrevented).toBe(true);
    search?.blur();
    press('s');
    expect(document.activeElement).toBe(other);
  });

  it('leaves the key alone while typing, with modifiers, or when something else handled it', async () => {
    const fixture = TestBed.createComponent(ShortcutHost);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const search = page.querySelector<HTMLInputElement>('.search');
    const notes = page.querySelector<HTMLTextAreaElement>('.notes');

    notes?.focus();
    expect(press('/', {}, notes as HTMLTextAreaElement).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(notes);
    notes?.blur();

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      press('/', modifier);
      expect(document.activeElement).not.toBe(search);
    }
    const handled = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(document.activeElement).not.toBe(search);
  });
});

describe('InView', () => {
  const original = globalThis.IntersectionObserver;

  beforeEach(() => {
    FakeIntersectionObserver.created = [];
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  it('says when the element comes near the viewport, and stops watching when destroyed', async () => {
    const fixture = TestBed.createComponent(InViewHost);
    await fixture.whenStable();
    const [observer] = FakeIntersectionObserver.created;
    expect(observer?.options).toEqual({ rootMargin: '100px' });
    expect(observer?.observed).toEqual([fixture.nativeElement.querySelector('.sentinel')]);

    observer?.report(false);
    expect(fixture.componentInstance.seen).toBe(0);
    observer?.report(true);
    observer?.report(true);
    expect(fixture.componentInstance.seen).toBe(2);

    fixture.destroy();
    expect(observer?.disconnected).toBe(true);
  });

  it('does nothing where IntersectionObserver does not exist', async () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const fixture = TestBed.createComponent(InViewHost);
    await fixture.whenStable();
    expect(FakeIntersectionObserver.created).toEqual([]);
    expect(fixture.componentInstance.seen).toBe(0);
  });
});
